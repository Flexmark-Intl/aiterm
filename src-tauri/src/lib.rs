mod commands;
mod pty;
mod state;

use state::{load_state, AppState};
use state::persistence::migrate_app_data;
use std::sync::Arc;

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all())
            .build())
        .manage(app_state)
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
            commands::workspace::set_split_ratio,
            commands::workspace::set_tab_scrollback,
            commands::workspace::debug_log,
            commands::workspace::sync_state,
            commands::workspace::get_preferences,
            commands::workspace::set_preferences,
            commands::workspace::copy_tab_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
