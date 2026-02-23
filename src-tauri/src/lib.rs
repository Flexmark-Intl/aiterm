mod claude_code;
mod commands;
mod pty;
mod state;

pub const APP_DISPLAY_NAME: &str = if cfg!(debug_assertions) { "aiTermDev" } else { "aiTerm" };
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

use state::{load_state, AppState, WindowData, Workspace};
use state::persistence::migrate_app_data;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::webview::WebviewWindowBuilder;
use tauri_plugin_log::{Target, TargetKind, RotationStrategy, TimezoneStrategy};
use log::LevelFilter;

fn build_log_plugin() -> tauri_plugin_log::Builder {
    let is_dev = cfg!(debug_assertions);
    let file_name = if is_dev { "aiterm-dev" } else { "aiterm" };
    let level = if is_dev { LevelFilter::Debug } else { LevelFilter::Info };

    let mut targets = vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::LogDir { file_name: Some(file_name.into()) }),
    ];

    if is_dev {
        targets.push(Target::new(TargetKind::Webview));
    }

    tauri_plugin_log::Builder::new()
        .targets(targets)
        .level(level)
        .level_for("tao", LevelFilter::Warn)
        .level_for("hyper", LevelFilter::Warn)
        .rotation_strategy(RotationStrategy::KeepAll)
        .max_file_size(5_000_000)
        .timezone_strategy(TimezoneStrategy::UseLocal)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::default());

    // Load persisted state and run migration
    {
        let mut data = app_state.app_data.write();
        *data = load_state();
        migrate_app_data(&mut data);

        // Ensure at least one window exists (fresh install)
        if data.windows.is_empty() {
            let mut win = WindowData::new("main".to_string());
            let ws = Workspace::new("Default".to_string());
            win.active_workspace_id = Some(ws.id.clone());
            win.workspaces.push(ws);
            data.windows.push(win);
        }

        // Ensure the first window has label "main" (Tauri creates this from tauri.conf.json)
        if let Some(first) = data.windows.first_mut() {
            if first.label != "main" {
                first.label = "main".to_string();
            }
        }
    }

    let builder = tauri::Builder::default()
        .plugin(build_log_plugin().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin({
            let mut ws = tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all())
                // Only track the "main" window — dynamically created windows
                // (UUID labels) are managed by our own state system. The plugin
                // can cause WebView2 init issues on Windows for unknown labels.
                .with_filter(|label| label == "main");
            if cfg!(debug_assertions) {
                ws = ws.with_filename("window-state-dev.json");
            }
            ws.build()
        });

    #[cfg(all(feature = "mcp-bridge", debug_assertions))]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .manage(app_state.clone())
        .setup(move |app| {
            // Window title is set dynamically from the frontend (workspace name)

            // Restore additional windows beyond "main"
            let extra_windows: Vec<String> = {
                let data = app_state.app_data.read();
                data.windows.iter()
                    .skip(1) // skip "main" — already created by Tauri
                    .map(|w| w.label.clone())
                    .collect()
            };

            for label in extra_windows {
                let url = if cfg!(debug_assertions) {
                    tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap())
                } else {
                    tauri::WebviewUrl::App("index.html".into())
                };
                // Title is set dynamically from the frontend (workspace name)
                let title = if cfg!(debug_assertions) { "aiTerm (Dev)" } else { "aiTerm" };

                let mut builder = WebviewWindowBuilder::new(app, &label, url)
                    .title(title)
                    .inner_size(1200.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .resizable(true)
                    .fullscreen(false);

                #[cfg(target_os = "macos")]
                {
                    builder = builder
                        .hidden_title(true)
                        .title_bar_style(tauri::TitleBarStyle::Overlay);
                }

                if let Err(e) = builder.build()
                {
                    log::error!("Failed to restore window '{}': {}", label, e);
                }
            }

            // Custom app menu
            let quit_item = MenuItem::with_id(app, "quit", "Quit aiTerm", true, Some("CmdOrCtrl+Q"))?;
            let preferences_item = MenuItem::with_id(app, "preferences", "Preferences…", true, Some("CmdOrCtrl+,"))?;
            let reload_all_item = MenuItem::with_id(app, "reload_all", "Reload All Windows", true, None::<&str>)?;
            let new_window_item = MenuItem::with_id(app, "new_window", "New Window", true, Some("CmdOrCtrl+N"))?;
            let duplicate_window_item = MenuItem::with_id(app, "duplicate_window", "Duplicate Window", true, Some("CmdOrCtrl+Shift+N"))?;
            let reload_tab_item = MenuItem::with_id(app, "reload_tab", "Reload Current Tab", true, None::<&str>)?;
            let reload_window_item = MenuItem::with_id(app, "reload_window", "Reload Current Window", true, None::<&str>)?;

            let app_menu = SubmenuBuilder::new(app, "aiTerm")
                .about(None)
                .separator()
                .item(&preferences_item)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&new_window_item)
                .item(&duplicate_window_item)
                .separator()
                .item(&reload_tab_item)
                .item(&reload_all_item)
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .close_window()
                .separator()
                .item(&reload_window_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
                .build()?;

            app.set_menu(menu)?;

            // Start Claude Code IDE WebSocket server
            {
                let server_state = app_state.clone();
                let server_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    claude_code::server::start_server(server_handle, server_state).await;
                });
            }

            app.on_menu_event(|app_handle, event| {
                match event.id().as_ref() {
                    "quit" => {
                        // Emit event so each window can save scrollback before exit.
                        // Don't close windows directly — that triggers closeWindow()
                        // which removes window data from state.
                        let _ = app_handle.emit("quit-requested", ());
                    }
                    "preferences" => {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = commands::window::open_preferences_window(win, app_handle.clone());
                        }
                    }
                    "reload_tab" => {
                        // Emit event so the focused window can reload the active tab's PTY
                        for (_, win) in app_handle.webview_windows() {
                            if win.is_focused().unwrap_or(false) {
                                let _ = win.emit("reload-tab", ());
                                break;
                            }
                        }
                    }
                    "reload_all" => {
                        for (_, win) in app_handle.webview_windows() {
                            let _ = tauri::WebviewWindow::eval(&win, "window.location.reload()");
                        }
                    }
                    "reload_window" => {
                        // Reload the focused window (find it by checking is_focused)
                        for (_, win) in app_handle.webview_windows() {
                            if win.is_focused().unwrap_or(false) {
                                let _ = tauri::WebviewWindow::eval(&win, "window.location.reload()");
                                break;
                            }
                        }
                    }
                    "new_window" | "duplicate_window" => {
                        // These are handled by frontend keyboard shortcuts.
                        // The menu accelerators trigger the keydown event which
                        // the frontend handles.
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::terminal::spawn_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::kill_terminal,
            commands::terminal::get_pty_info,
            commands::terminal::read_clipboard_file_paths,
            commands::terminal::detect_windows_shells,
            commands::workspace::get_app_data,
            commands::workspace::create_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::split_pane,
            commands::workspace::delete_pane,
            commands::workspace::rename_pane,
            commands::workspace::create_tab,
            commands::workspace::delete_tab,
            commands::workspace::rename_tab,
            commands::workspace::set_active_workspace,
            commands::workspace::set_active_pane,
            commands::workspace::set_active_tab,
            commands::workspace::set_tab_pty_id,
            commands::workspace::set_sidebar_width,
            commands::workspace::set_sidebar_collapsed,
            commands::workspace::set_split_ratio,
            commands::workspace::set_tab_scrollback,
            commands::workspace::set_tab_notes,
            commands::workspace::set_tab_notes_open,
            commands::workspace::set_tab_notes_mode,
            commands::workspace::reorder_tabs,
            commands::workspace::reorder_workspaces,
            commands::workspace::duplicate_workspace,
            commands::workspace::exit_app,
            commands::workspace::sync_state,
            commands::workspace::get_preferences,
            commands::workspace::set_preferences,
            commands::workspace::copy_tab_history,
            commands::workspace::set_tab_restore_context,
            commands::workspace::set_tab_last_cwd,
            commands::workspace::set_tab_auto_resume_context,
            commands::workspace::set_tab_trigger_variables,
            commands::workspace::get_all_workspaces,
            commands::workspace::list_system_sounds,
            commands::workspace::play_system_sound,
            commands::workspace::add_workspace_note,
            commands::workspace::update_workspace_note,
            commands::workspace::delete_workspace_note,
            commands::window::get_window_data,
            commands::window::create_window,
            commands::window::duplicate_window,
            commands::window::close_window,
            commands::window::reset_window,
            commands::window::get_window_count,
            commands::window::open_preferences_window,
            commands::editor::read_file,
            commands::editor::read_file_base64,
            commands::editor::write_file,
            commands::editor::scp_read_file,
            commands::editor::scp_read_file_base64,
            commands::editor::scp_write_file,
            commands::editor::create_editor_tab,
            commands::claude_code::claude_code_respond,
            commands::claude_code::claude_code_notify_selection,
            commands::workspace::create_diff_tab,
            commands::workspace::archive_tab,
            commands::workspace::restore_archived_tab,
            commands::workspace::delete_archived_tab,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
