use crate::state::persistence::save_state;
use crate::state::{AppState, EditorFileInfo, Tab};
use base64::Engine;
use std::io::Read;
use std::sync::Arc;
use tauri::{command, State, Window};

fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
    }
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}/{}", home.to_string_lossy(), &path[2..]);
        }
    }
    path.to_string()
}

#[derive(serde::Serialize)]
pub struct ReadFileResult {
    pub content: String,
    pub size: u64,
}

#[command]
pub async fn read_file(path: String) -> Result<ReadFileResult, String> {
    let path = expand_tilde(&path);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Cannot access file: {}", e))?;

    if metadata.is_dir() {
        return Err("IS_DIRECTORY".to_string());
    }

    let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
    if metadata.len() > 2 * 1024 * 1024 {
        return Err(format!("FILE_TOO_LARGE:{:.1}", size_mb));
    }

    let mut file = std::fs::File::open(&path).map_err(|e| format!("Cannot open file: {}", e))?;

    // Check for binary content (null bytes in first 8KB)
    let mut header = vec![0u8; 8192.min(metadata.len() as usize)];
    let n = file
        .read(&mut header)
        .map_err(|e| format!("Cannot read file: {}", e))?;
    if header[..n].contains(&0) {
        return Err("Binary files are not supported".to_string());
    }

    // Read entire file
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    Ok(ReadFileResult {
        size: metadata.len(),
        content,
    })
}

#[command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let path = expand_tilde(&path);
    // Atomic write: temp file + rename
    let temp_path = format!("{}.aiterm-tmp", path);
    std::fs::write(&temp_path, &content).map_err(|e| format!("Cannot write file: {}", e))?;
    std::fs::rename(&temp_path, &path).map_err(|e| {
        // Clean up temp file on rename failure
        let _ = std::fs::remove_file(&temp_path);
        format!("Cannot save file: {}", e)
    })?;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct ReadFileBase64Result {
    pub data: String,
    pub size: u64,
}

#[command]
pub async fn read_file_base64(path: String) -> Result<ReadFileBase64Result, String> {
    let path = expand_tilde(&path);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Cannot access file: {}", e))?;

    if metadata.is_dir() {
        return Err("IS_DIRECTORY".to_string());
    }

    if metadata.len() > 20 * 1024 * 1024 {
        let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
        return Err(format!("FILE_TOO_LARGE:{:.1}", size_mb));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(ReadFileBase64Result {
        size: metadata.len(),
        data,
    })
}

#[command]
pub async fn scp_read_file_base64(
    ssh_command: String,
    remote_path: String,
) -> Result<ReadFileBase64Result, String> {
    let user_host = extract_user_host(&ssh_command)?;

    // Download via SCP
    let temp_dir = std::env::temp_dir();
    let temp_name = format!("aiterm-scp-{}", uuid::Uuid::new_v4());
    let local_path = temp_dir.join(&temp_name);

    let output = std::process::Command::new("scp")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg(format!("{}:{}", user_host, remote_path))
        .arg(local_path.to_str().unwrap())
        .output()
        .map_err(|e| format!("Failed to run scp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SCP download failed: {}", stderr.trim()));
    }

    let metadata = std::fs::metadata(&local_path).map_err(|e| format!("Cannot stat file: {}", e))?;
    if metadata.len() > 20 * 1024 * 1024 {
        let _ = std::fs::remove_file(&local_path);
        let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
        return Err(format!("FILE_TOO_LARGE:{:.1}", size_mb));
    }

    let bytes = std::fs::read(&local_path).map_err(|e| format!("Cannot read file: {}", e))?;
    let _ = std::fs::remove_file(&local_path);
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(ReadFileBase64Result {
        size: metadata.len(),
        data,
    })
}

#[command]
pub async fn scp_read_file(
    ssh_command: String,
    remote_path: String,
) -> Result<ReadFileResult, String> {
    let user_host = extract_user_host(&ssh_command)?;

    // Pre-check via SSH: file type, size, and binary detection in one command
    // stat -c on Linux, stat -f on macOS — use a portable approach
    let check_cmd = format!(
        "f={}; t=$(stat -c %F \"$f\" 2>/dev/null || stat -f %HT \"$f\" 2>/dev/null); s=$(stat -c %s \"$f\" 2>/dev/null || stat -f %z \"$f\" 2>/dev/null); b=$(head -c 8192 \"$f\" | tr -d '\\0' | wc -c); h=$(head -c 8192 \"$f\" | wc -c); echo \"$t|$s|$b|$h\"",
        shell_quote(&remote_path)
    );

    let check_output = std::process::Command::new("ssh")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg(&user_host)
        .arg(&check_cmd)
        .output()
        .map_err(|e| format!("Failed to run ssh: {}", e))?;

    if !check_output.status.success() {
        let stderr = String::from_utf8_lossy(&check_output.stderr);
        return Err(format!("Cannot access remote file: {}", stderr.trim()));
    }

    let info = String::from_utf8_lossy(&check_output.stdout).trim().to_string();
    let parts: Vec<&str> = info.split('|').collect();
    if parts.len() >= 4 {
        let file_type = parts[0].to_lowercase();
        // Check for directory
        if file_type.contains("directory") || file_type.contains("dir") {
            return Err("IS_DIRECTORY".to_string());
        }
        // Check file size
        if let Ok(size) = parts[1].trim().parse::<u64>() {
            if size > 2 * 1024 * 1024 {
                let size_mb = size as f64 / (1024.0 * 1024.0);
                return Err(format!("FILE_TOO_LARGE:{:.1}", size_mb));
            }
        }
        // Check for binary: compare byte count with and without null bytes stripped
        let stripped: u64 = parts[2].trim().parse().unwrap_or(0);
        let original: u64 = parts[3].trim().parse().unwrap_or(0);
        if original > 0 && stripped < original {
            return Err("Binary files are not supported".to_string());
        }
    }

    // Pre-checks passed — download via SCP
    let temp_dir = std::env::temp_dir();
    let temp_name = format!("aiterm-scp-{}", uuid::Uuid::new_v4());
    let local_path = temp_dir.join(&temp_name);

    let output = std::process::Command::new("scp")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg(format!("{}:{}", user_host, remote_path))
        .arg(local_path.to_str().unwrap())
        .output()
        .map_err(|e| format!("Failed to run scp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SCP download failed: {}", stderr.trim()));
    }

    let content = std::fs::read_to_string(&local_path)
        .map_err(|e| format!("Cannot read downloaded file: {}", e))?;
    let size = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);

    let _ = std::fs::remove_file(&local_path);

    Ok(ReadFileResult { content, size })
}

#[command]
pub async fn scp_write_file(
    ssh_command: String,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    let user_host = extract_user_host(&ssh_command)?;

    // Write content to temp file
    let temp_dir = std::env::temp_dir();
    let temp_name = format!("aiterm-scp-{}", uuid::Uuid::new_v4());
    let local_path = temp_dir.join(&temp_name);

    std::fs::write(&local_path, &content).map_err(|e| format!("Cannot write temp file: {}", e))?;

    // Run scp to upload
    let output = std::process::Command::new("scp")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=10")
        .arg(local_path.to_str().unwrap())
        .arg(format!("{}:{}", user_host, remote_path))
        .output()
        .map_err(|e| format!("Failed to run scp: {}", e))?;

    // Clean up temp file
    let _ = std::fs::remove_file(&local_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SCP upload failed: {}", stderr.trim()));
    }

    Ok(())
}

#[command]
pub async fn create_editor_tab(
    state: State<'_, Arc<AppState>>,
    window: Window,
    workspace_id: String,
    pane_id: String,
    name: String,
    file_info: EditorFileInfo,
    after_tab_id: Option<String>,
) -> Result<Tab, String> {
    let mut app_data = state.app_data.write();
    let win_label = window.label().to_string();

    let win = app_data
        .window_mut(&win_label)
        .ok_or("Window not found")?;
    let ws = win
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;
    let pane = ws
        .panes
        .iter_mut()
        .find(|p| p.id == pane_id)
        .ok_or("Pane not found")?;

    let mut file_info = file_info;
    file_info.file_path = expand_tilde(&file_info.file_path);
    let tab = Tab::new_editor(name, file_info);
    let tab_id = tab.id.clone();

    // Insert after the specified tab, or append to end
    let insert_idx = after_tab_id
        .and_then(|id| pane.tabs.iter().position(|t| t.id == id))
        .map(|idx| idx + 1)
        .unwrap_or(pane.tabs.len());
    pane.tabs.insert(insert_idx, tab.clone());
    pane.active_tab_id = Some(tab_id);

    let _ = save_state(&app_data);

    Ok(tab)
}

/// Shell-quote a string for safe use in remote commands.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Extract user@host from an SSH command string.
/// Handles formats like "ssh user@host", "ssh -o Foo=bar user@host", etc.
fn extract_user_host(ssh_command: &str) -> Result<String, String> {
    let parts: Vec<&str> = ssh_command.split_whitespace().collect();

    // Find the user@host part (first argument that contains @ and isn't a flag value)
    let mut skip_next = false;
    for part in &parts {
        if skip_next {
            skip_next = false;
            continue;
        }
        if *part == "ssh" {
            continue;
        }
        // Flags that take a value
        if [
            "-o", "-i", "-p", "-l", "-F", "-J", "-L", "-R", "-D", "-W", "-S", "-b", "-c", "-E",
            "-m", "-O", "-Q", "-w", "-B", "-e",
        ]
        .contains(part)
        {
            skip_next = true;
            continue;
        }
        // Single-letter flags (no value)
        if part.starts_with('-') && !part.contains('=') {
            continue;
        }
        // This should be user@host or just host
        return Ok(part.to_string());
    }

    Err("Cannot extract host from SSH command".to_string())
}
