mod commands;
mod pty;
mod state;

use state::{load_state, AppState};
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = Arc::new(AppState::default());

    // Load persisted state
    {
        let mut data = app_state.app_data.write();
        *data = load_state();
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
            commands::workspace::get_app_data,
            commands::workspace::save_app_data,
            commands::workspace::create_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::rename_workspace,
            commands::workspace::create_window,
            commands::workspace::delete_window,
            commands::workspace::rename_window,
            commands::workspace::create_tab,
            commands::workspace::delete_tab,
            commands::workspace::rename_tab,
            commands::workspace::set_active_workspace,
            commands::workspace::set_active_window,
            commands::workspace::set_active_tab,
            commands::workspace::set_tab_pty_id,
            commands::workspace::set_layout,
            commands::workspace::set_sidebar_width,
            commands::workspace::set_window_sizes,
            commands::workspace::set_tab_scrollback,
            commands::workspace::debug_log,
            commands::workspace::sync_state,
            commands::workspace::get_preferences,
            commands::workspace::set_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
