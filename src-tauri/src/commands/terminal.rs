use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::pty;
use crate::state::AppState;

#[tauri::command]
pub fn spawn_terminal(
    app_handle: AppHandle,
    state: State<'_, Arc<AppState>>,
    pty_id: String,
    tab_id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    pty::spawn_pty(&app_handle, &*state, &pty_id, &tab_id, cols, rows, cwd)
}

#[tauri::command]
pub fn get_pty_info(
    state: State<'_, Arc<AppState>>,
    pty_id: String,
) -> Result<pty::PtyInfo, String> {
    pty::get_pty_info(&*state, &pty_id)
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, Arc<AppState>>,
    pty_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    pty::write_pty(&*state, &pty_id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, Arc<AppState>>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty::resize_pty(&*state, &pty_id, cols, rows)
}

#[tauri::command]
pub fn kill_terminal(state: State<'_, Arc<AppState>>, pty_id: String) -> Result<(), String> {
    pty::kill_pty(&*state, &pty_id)
}
