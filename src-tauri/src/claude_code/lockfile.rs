use std::fs;
use std::path::PathBuf;

const MCP_SERVER_KEY: &str = "aiterm";

fn ide_lock_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("ide"))
}

fn claude_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

pub fn write_lockfile(port: u16, auth: &str, workspace_folders: Vec<String>) -> Result<(), String> {
    let dir = ide_lock_dir().ok_or("Could not determine home directory")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create lock dir: {}", e))?;

    let lock_path = dir.join(format!("{}.lock", port));
    let content = serde_json::json!({
        "pid": std::process::id(),
        "workspaceFolders": workspace_folders,
        "ideName": crate::APP_DISPLAY_NAME,
        "ideVersion": crate::APP_VERSION,
        "transport": "ws",
        "authToken": auth,
        "serverPort": port,
    });

    let json = serde_json::to_string_pretty(&content).map_err(|e| e.to_string())?;
    fs::write(&lock_path, json).map_err(|e| format!("Failed to write lock file: {}", e))?;
    log::info!("Wrote Claude Code lock file at {:?}", lock_path);

    // Also register as a named MCP server so Claude exposes our full tool list
    if let Err(e) = write_mcp_settings(port, auth) {
        log::warn!("Failed to write MCP settings: {}", e);
    }

    Ok(())
}

pub fn delete_lockfile(port: u16) {
    if let Some(dir) = ide_lock_dir() {
        let lock_path = dir.join(format!("{}.lock", port));
        if let Err(e) = fs::remove_file(&lock_path) {
            log::warn!("Failed to delete lock file {:?}: {}", lock_path, e);
        } else {
            log::info!("Deleted Claude Code lock file {:?}", lock_path);
        }
    }

    if let Err(e) = remove_mcp_settings() {
        log::warn!("Failed to remove MCP settings: {}", e);
    }
}

/// Write an `mcpServers.aiterm` entry into ~/.claude.json so Claude
/// Code CLI exposes our full tool list (not filtered by IDE name).
fn write_mcp_settings(port: u16, auth: &str) -> Result<(), String> {
    let path = claude_settings_path().ok_or("Could not determine home directory")?;

    let mut settings: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings.json: {}", e))?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let mcp_servers = settings
        .as_object_mut()
        .ok_or("settings.json is not an object")?
        .entry("mcpServers")
        .or_insert(serde_json::json!({}));

    mcp_servers[MCP_SERVER_KEY] = serde_json::json!({
        "type": "sse",
        "url": format!("http://127.0.0.1:{}/sse", port),
        "headers": {
            "x-claude-code-ide-authorization": auth
        }
    });

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    // Atomic write
    let tmp = path.with_extension("json.aiterm-tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Cannot write settings tmp: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot update settings.json: {}", e)
    })?;

    log::info!("Registered aiterm MCP server in ~/.claude.json (port {})", port);
    Ok(())
}

/// Remove the `mcpServers.aiterm` entry from ~/.claude.json on shutdown.
fn remove_mcp_settings() -> Result<(), String> {
    let path = claude_settings_path().ok_or("Could not determine home directory")?;
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings.json: {}", e))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));

    if let Some(mcp_servers) = settings.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        mcp_servers.remove(MCP_SERVER_KEY);
        // Remove the mcpServers key entirely if now empty
        if mcp_servers.is_empty() {
            settings.as_object_mut().unwrap().remove("mcpServers");
        }
    } else {
        return Ok(()); // Nothing to remove
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.aiterm-tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Cannot write settings tmp: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot update settings.json: {}", e)
    })?;

    log::info!("Removed aiterm MCP server from ~/.claude.json");
    Ok(())
}

pub fn cleanup_stale_lockfiles() {
    let Some(dir) = ide_lock_dir() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lock") {
            continue;
        }

        let Ok(contents) = fs::read_to_string(&path) else { continue };
        let Ok(data) = serde_json::from_str::<serde_json::Value>(&contents) else {
            // Invalid JSON — remove it
            let _ = fs::remove_file(&path);
            continue;
        };

        if let Some(pid) = data.get("pid").and_then(|v| v.as_u64()) {
            let alive = unsafe { libc::kill(pid as i32, 0) == 0 };
            if !alive {
                log::info!("Removing stale lock file {:?} (pid {} dead)", path, pid);
                let _ = fs::remove_file(&path);
            }
        }
    }
}
