mod commands;
mod pty;
mod state;

use state::{load_state, AppState};
use state::persistence::migrate_app_data;
use std::sync::Arc;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
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
    }

    tauri::Builder::default()
        .plugin(build_log_plugin().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all())
            .build())
        .manage(app_state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("aiTerm (Dev)");
                }
            }

            // Custom app menu: replace default Quit (which calls exit(0) on macOS,
            // bypassing onCloseRequested) with a custom item that triggers window.close().
            let quit_item = MenuItem::with_id(app, "quit", "Quit aiTerm", true, Some("CmdOrCtrl+Q"))?;

            let app_menu = SubmenuBuilder::new(app, "aiTerm")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .item(&quit_item)
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
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &window_menu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                if event.id().as_ref() == "quit" {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.close();
                    }
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
            commands::workspace::reorder_tabs,
            commands::workspace::exit_app,
            commands::workspace::sync_state,
            commands::workspace::get_preferences,
            commands::workspace::set_preferences,
            commands::workspace::copy_tab_history,
            commands::workspace::set_tab_restore_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
