use crate::state::persistence::save_state;
use crate::state::{AppState, EditorFileInfo, FileWatcherHandle, RemoteFileWatch, Tab};
use base64::Engine;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use tauri::{command, Emitter, State, Window};

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
    let remote_path = expand_remote_tilde(&user_host, &remote_path);

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
    let remote_path = expand_remote_tilde(&user_host, &remote_path);

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
    let remote_path = expand_remote_tilde(&user_host, &remote_path);

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
pub async fn save_clipboard_image(data_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let temp_dir = std::env::temp_dir();
    let filename = format!("aiterm-clipboard-{}.jpg", uuid::Uuid::new_v4());
    let path = temp_dir.join(&filename);

    std::fs::write(&path, &bytes).map_err(|e| format!("Cannot write temp file: {}", e))?;
    log::info!("save_clipboard_image: wrote {} bytes to {:?}", bytes.len(), path);

    Ok(path.to_string_lossy().to_string())
}

#[command]
pub async fn scp_upload_files(
    ssh_command: String,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<(), String> {
    let remote_dir = remote_dir.trim().to_string();
    log::info!("scp_upload_files: ssh_command={:?}, local_paths={:?}, remote_dir={:?}", ssh_command, local_paths, remote_dir);

    let user_host = extract_user_host(&ssh_command)?;
    let remote_dir = expand_remote_tilde(&user_host, &remote_dir);
    log::info!("scp_upload_files: user_host={:?}, expanded_remote_dir={:?}", user_host, remote_dir);

    // Ensure remote directory exists
    let mkdir_output = std::process::Command::new("ssh")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg(&user_host)
        .arg(format!("mkdir -p {}", shell_quote(&remote_dir)))
        .output()
        .map_err(|e| format!("Failed to run ssh mkdir: {}", e))?;

    if !mkdir_output.status.success() {
        let stderr = String::from_utf8_lossy(&mkdir_output.stderr);
        log::warn!("scp_upload_files: mkdir -p failed (may already exist): {}", stderr.trim());
    }

    // Check if any path is a directory (needs -r flag)
    let needs_recursive = local_paths.iter().any(|p| {
        std::fs::metadata(p).map(|m| m.is_dir()).unwrap_or(false)
    });

    let mut cmd = std::process::Command::new("scp");
    if needs_recursive {
        cmd.arg("-r");
    }
    cmd.arg("-o").arg("BatchMode=yes")
       .arg("-o").arg("ConnectTimeout=30");

    for path in &local_paths {
        cmd.arg(path);
    }
    // Don't shell_quote the remote dir — scp parses the user@host:path format itself
    // and passes the path to the remote side. Quoting here would create literal quote chars.
    let dest = format!("{}:{}/", user_host, remote_dir);
    log::info!("scp_upload_files: dest={:?}, recursive={}", dest, needs_recursive);
    cmd.arg(&dest);

    let output = cmd.output()
        .map_err(|e| format!("Failed to run scp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::error!("scp_upload_files failed: stderr={}, stdout={}", stderr.trim(), stdout.trim());
        return Err(format!("SCP upload failed: {}", stderr.trim()));
    }

    log::info!("scp_upload_files: success, {} file(s) uploaded", local_paths.len());
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

/// Expand `~` and `~username` prefixes on a remote host via SSH.
/// SCP in SFTP mode doesn't support `~user` paths, so we resolve them first.
fn expand_remote_tilde(user_host: &str, path: &str) -> String {
    if !path.starts_with('~') {
        return path.to_string();
    }
    // Run `echo ~` or `echo ~username` on the remote to get the real path
    // Extract the tilde prefix (~ or ~username) before any /
    let (tilde_prefix, rest) = match path.find('/') {
        Some(i) => (&path[..i], &path[i..]),
        None => (path, ""),
    };
    let cmd = format!("echo {}", tilde_prefix);
    if let Ok(output) = std::process::Command::new("ssh")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg(user_host)
        .arg(&cmd)
        .output()
    {
        if output.status.success() {
            let expanded = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !expanded.is_empty() && expanded.starts_with('/') {
                return format!("{}{}", expanded, rest);
            }
        }
    }
    path.to_string()
}

#[command]
pub async fn watch_file(
    state: State<'_, Arc<AppState>>,
    window: Window,
    tab_id: String,
    path: String,
) -> Result<(), String> {
    let path = expand_tilde(&path);
    let file_path = Path::new(&path).to_path_buf();

    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    // Remove existing watcher for this tab if any
    state.file_watchers.write().remove(&tab_id);

    let event_tab_id = tab_id.clone();
    let debouncer = notify_debouncer_mini::new_debouncer(
        std::time::Duration::from_millis(500),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = res {
                let dominated_by_remove = events.iter().all(|e| {
                    matches!(e.kind, notify_debouncer_mini::DebouncedEventKind::Any)
                        && !e.path.exists()
                });
                if dominated_by_remove {
                    let _ = window.emit(&format!("file-deleted-{}", event_tab_id), ());
                    return;
                }
                let _ = window.emit(&format!("file-changed-{}", event_tab_id), ());
            }
        },
    )
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    let mut debouncer = debouncer;
    debouncer
        .watcher()
        .watch(&file_path, notify::RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {}", e))?;

    state.file_watchers.write().insert(
        tab_id,
        FileWatcherHandle {
            _debouncer: debouncer,
        },
    );

    Ok(())
}

#[command]
pub async fn unwatch_file(
    state: State<'_, Arc<AppState>>,
    tab_id: String,
) -> Result<(), String> {
    state.file_watchers.write().remove(&tab_id);
    Ok(())
}

#[command]
pub async fn get_file_mtime(path: String) -> Result<u64, String> {
    let path = expand_tilde(&path);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Cannot stat file: {}", e))?;
    let mtime = metadata
        .modified()
        .map_err(|e| format!("Cannot get mtime: {}", e))?;
    let epoch = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?;
    Ok(epoch.as_millis() as u64)
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

// ── Remote file watching (SSH stat polling) ──────────────────────────

/// Get modification time of a remote file via SSH stat.
/// Returns epoch seconds (not ms) since that's what `stat` gives us.
fn ssh_stat_mtime(user_host: &str, remote_path: &str) -> Result<u64, String> {
    let quoted = shell_quote(remote_path);
    // stat -c %Y = Linux (GNU coreutils), stat -f %m = macOS/BSD
    let cmd = format!(
        "stat -c %Y {} 2>/dev/null || stat -f %m {} 2>/dev/null",
        quoted, quoted
    );
    let output = std::process::Command::new("ssh")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=5")
        .arg(user_host)
        .arg(&cmd)
        .output()
        .map_err(|e| format!("Failed to run ssh: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SSH stat failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    stdout
        .parse::<u64>()
        .map_err(|_| format!("Cannot parse mtime from: {}", stdout))
}

/// One-shot remote file mtime check (used by frontend before/after saves).
#[command]
pub async fn get_remote_file_mtime(ssh_command: String, remote_path: String) -> Result<u64, String> {
    let user_host = extract_user_host(&ssh_command)?;
    let remote_path = expand_remote_tilde(&user_host, &remote_path);
    let mtime = ssh_stat_mtime(&user_host, &remote_path)?;
    // Return as seconds (frontend handles comparison consistently)
    Ok(mtime)
}

/// Register a remote file for periodic mtime polling.
#[command]
pub async fn watch_remote_file(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    tab_id: String,
    ssh_command: String,
    remote_path: String,
) -> Result<(), String> {
    let user_host = extract_user_host(&ssh_command)?;
    let remote_path = expand_remote_tilde(&user_host, &remote_path);

    {
        let mut watchers = state.remote_file_watchers.write();
        watchers.insert(tab_id, RemoteFileWatch {
            user_host,
            remote_path,
            last_mtime: None,
        });
    }

    // Start polling task if not already running
    if !state.remote_watcher_running.swap(true, std::sync::atomic::Ordering::SeqCst) {
        let state_clone = state.inner().clone();
        let app_clone = app.clone();
        tokio::spawn(remote_file_poll_loop(state_clone, app_clone));
    }

    Ok(())
}

/// Unregister a remote file watcher.
#[command]
pub async fn unwatch_remote_file(
    state: State<'_, Arc<AppState>>,
    tab_id: String,
) -> Result<(), String> {
    state.remote_file_watchers.write().remove(&tab_id);
    Ok(())
}

#[command]
pub async fn git_show_file(file_path: String, git_ref: String) -> Result<String, String> {
    let file_path = expand_tilde(&file_path);
    let dir = Path::new(&file_path)
        .parent()
        .ok_or("Invalid file path")?;

    // Get repo root
    let root_output = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if !root_output.status.success() {
        return Err("Not a git repository".to_string());
    }
    let repo_root = String::from_utf8_lossy(&root_output.stdout)
        .trim()
        .to_string();

    // Compute relative path
    let rel_path = Path::new(&file_path)
        .strip_prefix(&repo_root)
        .map_err(|_| "File is outside the git repository".to_string())?;

    // git show ref:path
    let output = std::process::Command::new("git")
        .arg("show")
        .arg(format!("{}:{}", git_ref, rel_path.to_string_lossy()))
        .current_dir(&repo_root)
        .output()
        .map_err(|e| format!("Failed to run git show: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git show failed: {}", stderr.trim()));
    }

    String::from_utf8(output.stdout)
        .map_err(|_| "File content is not valid UTF-8".to_string())
}

#[command]
pub async fn is_directory(path: String) -> Result<bool, String> {
    let path = expand_tilde(&path);
    Ok(std::path::Path::new(&path).is_dir())
}

#[command]
pub async fn ssh_is_directory(ssh_command: String, remote_path: String) -> Result<bool, String> {
    let user_host = extract_user_host(&ssh_command)?;
    let remote_path = expand_remote_tilde(&user_host, &remote_path);
    let quoted = shell_quote(&remote_path);

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new("ssh")
            .arg("-o").arg("BatchMode=yes")
            .arg("-o").arg("ConnectTimeout=5")
            .arg(&user_host)
            .arg(format!("test -d {}", quoted))
            .output()
    )
    .await
    .map_err(|_| "SSH timed out".to_string())?
    .map_err(|e| format!("SSH failed: {}", e))?;

    Ok(output.status.success())
}

#[command]
pub async fn list_files(
    path: String,
    max_files: Option<u32>,
    show_hidden: Option<bool>,
) -> Result<Vec<String>, String> {
    let path = expand_tilde(&path);
    let max = max_files.unwrap_or(10_000) as usize;
    let hidden = show_hidden.unwrap_or(false);
    let base = std::path::PathBuf::from(&path);

    if !base.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let walker = ignore::WalkBuilder::new(&base)
        .hidden(!hidden)
        .git_ignore(true)
        .git_global(true)
        .max_depth(Some(20))
        .build();

    let mut entries: Vec<(String, u64)> = Vec::new();
    for entry in walker {
        if entries.len() >= max {
            break;
        }
        if let Ok(entry) = entry {
            if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                if let Ok(rel) = entry.path().strip_prefix(&base) {
                    let mtime = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    entries.push((rel.to_string_lossy().to_string(), mtime));
                }
            }
        }
    }

    // Sort by mtime descending (most recently modified first)
    entries.sort_by(|a, b| b.1.cmp(&a.1));

    Ok(entries.into_iter().map(|(path, _)| path).collect())
}

#[command]
pub async fn ssh_list_files(
    ssh_command: String,
    remote_path: String,
    max_files: Option<u32>,
    show_hidden: Option<bool>,
) -> Result<Vec<String>, String> {
    let user_host = extract_user_host(&ssh_command)?;
    let remote_path = expand_remote_tilde(&user_host, &remote_path);
    let max = max_files.unwrap_or(5000);
    let hidden = show_hidden.unwrap_or(false);
    let quoted = shell_quote(&remote_path);

    // Build find command: exclude hidden dirs/files unless show_hidden is set
    // -maxdepth must come before other predicates (GNU find warns otherwise)
    let find_cmd = if hidden {
        "find . -maxdepth 10 -type f".to_string()
    } else {
        "find . -maxdepth 10 -path '*/.*' -prune -o -type f -print".to_string()
    };

    // git ls-files respects .gitignore; use find as fallback
    // Sort results by mtime (newest first) via ls -t
    let cmd = format!(
        "cd {} && {{ git ls-files -z 2>/dev/null | xargs -0 ls -1t 2>/dev/null || {} -printf '%T@\\t%P\\n' | sort -rn | cut -f2; }} | head -{}",
        quoted, find_cmd, max
    );

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio::process::Command::new("ssh")
            .arg("-o").arg("BatchMode=yes")
            .arg("-o").arg("ConnectTimeout=10")
            .arg(&user_host)
            .arg(&cmd)
            .output()
    )
    .await
    .map_err(|_| "SSH connection timed out (15s)".to_string())?
    .map_err(|e| format!("SSH failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SSH list files failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<String> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.strip_prefix("./").unwrap_or(line).to_string())
        .collect();

    Ok(files)
}

/// Background polling loop for remote file watchers.
/// Groups files by user@host, runs one batched stat per host every 3 seconds.
async fn remote_file_poll_loop(state: Arc<AppState>, app: tauri::AppHandle) {
    use std::collections::HashMap;

    // Track consecutive failures per host
    let mut host_failures: HashMap<String, u32> = HashMap::new();
    const MAX_FAILURES: u32 = 5;

    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;

        // Take a snapshot of current watchers
        let snapshot: Vec<(String, String, String, Option<u64>)> = {
            let watchers = state.remote_file_watchers.read();
            if watchers.is_empty() {
                // No watchers — stop the polling task
                state.remote_watcher_running.store(false, std::sync::atomic::Ordering::SeqCst);
                log::info!("Remote file watcher: no watchers remaining, stopping poll loop");
                return;
            }
            watchers.iter().map(|(tab_id, w)| {
                (tab_id.clone(), w.user_host.clone(), w.remote_path.clone(), w.last_mtime)
            }).collect()
        };

        // Group by user_host
        let mut by_host: HashMap<String, Vec<(String, String, Option<u64>)>> = HashMap::new();
        for (tab_id, user_host, remote_path, last_mtime) in snapshot {
            by_host.entry(user_host).or_default().push((tab_id, remote_path, last_mtime));
        }

        // Poll each host
        for (user_host, files) in &by_host {
            // Skip hosts that have failed too many times
            if host_failures.get(user_host).copied().unwrap_or(0) >= MAX_FAILURES {
                continue;
            }

            let result = poll_host_files(user_host, files).await;

            match result {
                Ok(mtimes) => {
                    host_failures.remove(user_host);

                    // Compare and emit events for changed files
                    let mut watchers = state.remote_file_watchers.write();
                    for (i, (tab_id, _path, _old_mtime)) in files.iter().enumerate() {
                        if let Some(&new_mtime) = mtimes.get(i) {
                            if let Some(watcher) = watchers.get_mut(tab_id) {
                                if new_mtime == 0 {
                                    // stat failed — file may have been deleted
                                    if watcher.last_mtime.is_some() {
                                        log::info!("Remote file deleted: {} (tab {})", watcher.remote_path, tab_id);
                                        let _ = app.emit(&format!("file-deleted-{}", tab_id), ());
                                    }
                                    continue;
                                }
                                let changed = watcher.last_mtime
                                    .map(|old| new_mtime != old)
                                    .unwrap_or(false);
                                watcher.last_mtime = Some(new_mtime);
                                if changed {
                                    log::info!("Remote file changed: {} (tab {})", watcher.remote_path, tab_id);
                                    let _ = app.emit(&format!("file-changed-{}", tab_id), ());
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let count = host_failures.entry(user_host.clone()).or_insert(0);
                    *count += 1;
                    if *count >= MAX_FAILURES {
                        log::warn!("Remote file watcher: giving up on {} after {} failures", user_host, MAX_FAILURES);
                    } else {
                        log::debug!("Remote file watcher: poll failed for {}: {}", user_host, e);
                    }
                }
            }
        }
    }
}

/// Poll mtime for multiple files on a single host in one SSH call.
/// Returns a vec of mtime values (one per file, 0 if stat failed for that file).
async fn poll_host_files(
    user_host: &str,
    files: &[(String, String, Option<u64>)],
) -> Result<Vec<u64>, String> {
    // Build a script that stats each file and prints one mtime per line
    let mut file_list = String::new();
    for (_, path, _) in files {
        if !file_list.is_empty() {
            file_list.push(' ');
        }
        file_list.push_str(&shell_quote(path));
    }

    let script = format!(
        "for f in {}; do stat -c %Y \"$f\" 2>/dev/null || stat -f %m \"$f\" 2>/dev/null || echo 0; done",
        file_list
    );

    let output = tokio::process::Command::new("ssh")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("ConnectTimeout=5")
        .arg(user_host)
        .arg(&script)
        .output()
        .await
        .map_err(|e| format!("SSH failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("SSH stat failed: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mtimes: Vec<u64> = stdout
        .lines()
        .map(|line| line.trim().parse::<u64>().unwrap_or(0))
        .collect();

    Ok(mtimes)
}
