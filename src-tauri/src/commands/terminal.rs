use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::pty;
use crate::state::AppState;

/// Read file paths from the system clipboard (macOS NSPasteboard).
/// Returns an empty vec if the clipboard doesn't contain file URLs.
#[tauri::command]
pub fn read_clipboard_file_paths() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        read_file_paths_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        vec![]
    }
}

#[cfg(target_os = "macos")]
fn read_file_paths_macos() -> Vec<String> {
    use std::process::Command;

    // Use JXA (JavaScript for Automation) to read file URLs from NSPasteboard.
    // Iterates pasteboardItems and reads the public.file-url type from each.
    let script = concat!(
        "ObjC.import('AppKit');",
        "var pb=$.NSPasteboard.generalPasteboard;",
        "var items=pb.pasteboardItems;",
        "var p=[];",
        "for(var i=0;i<items.count;i++){",
        "var u=items.objectAtIndex(i).stringForType('public.file-url');",
        "if(u){p.push($.NSURL.URLWithString(u).path.js)}}",
        "p.join('\\n')"
    );

    let Ok(output) = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
    else {
        return vec![];
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        vec![]
    } else {
        stdout.lines().map(String::from).collect()
    }
}

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
