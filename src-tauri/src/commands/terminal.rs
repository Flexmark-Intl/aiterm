use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::pty;
use crate::state::AppState;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

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

#[tauri::command]
pub fn detect_windows_shells() -> Vec<ShellInfo> {
    #[cfg(windows)]
    {
        detect_windows_shells_impl()
    }
    #[cfg(not(windows))]
    {
        vec![]
    }
}

#[cfg(windows)]
fn detect_windows_shells_impl() -> Vec<ShellInfo> {
    use std::process::Command;

    let mut shells = Vec::new();

    // cmd.exe — always available
    let cmd_path = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    shells.push(ShellInfo {
        id: "cmd".to_string(),
        name: "Command Prompt".to_string(),
        path: cmd_path,
    });

    // powershell.exe — always available on modern Windows
    shells.push(ShellInfo {
        id: "powershell".to_string(),
        name: "Windows PowerShell".to_string(),
        path: "powershell.exe".to_string(),
    });

    // pwsh.exe — PowerShell 7+ (optional install)
    if let Ok(output) = Command::new("where").arg("pwsh").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("pwsh.exe")
                .trim()
                .to_string();
            shells.push(ShellInfo {
                id: "pwsh".to_string(),
                name: "PowerShell 7".to_string(),
                path,
            });
        }
    }

    // Git Bash — check common install paths
    let git_bash_paths = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];
    for p in &git_bash_paths {
        if std::path::Path::new(p).exists() {
            shells.push(ShellInfo {
                id: "gitbash".to_string(),
                name: "Git Bash".to_string(),
                path: p.to_string(),
            });
            break;
        }
    }

    // WSL
    if let Ok(output) = Command::new("where").arg("wsl").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("wsl.exe")
                .trim()
                .to_string();
            shells.push(ShellInfo {
                id: "wsl".to_string(),
                name: "WSL".to_string(),
                path,
            });
        }
    }

    shells
}
