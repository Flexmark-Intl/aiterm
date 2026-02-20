use std::sync::Arc;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;

/// Called by the frontend to send a tool response back to Claude CLI.
#[tauri::command]
pub fn claude_code_respond(
    state: State<'_, Arc<AppState>>,
    request_id: String,
    result: Value,
) -> Result<(), String> {
    let mut pending = state.claude_code_pending.write();
    if let Some(tx) = pending.remove(&request_id) {
        let _ = tx.send(result);
        Ok(())
    } else {
        Err(format!("No pending request with id: {}", request_id))
    }
}

/// Called by the frontend to forward a notification (e.g. selection change) to Claude CLI.
#[tauri::command]
pub fn claude_code_notify_selection(
    state: State<'_, Arc<AppState>>,
    payload: Value,
) -> Result<(), String> {
    let guard = state.claude_code_notify_tx.lock();
    if let Some(tx) = guard.as_ref() {
        let json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        tx.send(json).map_err(|e| e.to_string())
    } else {
        // No client connected, silently ignore
        Ok(())
    }
}
