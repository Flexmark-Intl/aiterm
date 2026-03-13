use std::fs;
use std::path::PathBuf;

fn mcp_server_key() -> &'static str {
    if cfg!(debug_assertions) { "aiterm-dev" } else { "aiterm" }
}

/// Check if a process is alive by PID.
#[cfg(unix)]
fn is_process_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
fn is_process_alive(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout);
            !out.contains("No tasks") && out.contains(&pid.to_string())
        })
        .unwrap_or(false)
}

fn ide_lock_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("ide"))
}

fn claude_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

/// Path to Claude Code user settings: ~/.claude/settings.json
fn claude_user_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

pub fn write_lockfile(port: u16, auth: &str, workspace_folders: Vec<String>, hooks_enabled: bool) -> Result<(), String> {
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

    // Register hooks in ~/.claude/settings.json (gated on preference)
    if hooks_enabled {
        if let Err(e) = write_hook_settings(port, auth) {
            log::warn!("Failed to write hook settings: {}", e);
        }
    }

    // Install /aiterm skill for fast slash-command access
    if let Err(e) = write_aiterm_skill() {
        log::warn!("Failed to write aiterm skill: {}", e);
    }

    Ok(())
}

pub fn delete_lockfile(port: u16, auth: &str) {
    // Clean up hooks first (needs both port and auth)
    if let Err(e) = remove_hook_settings(port, auth) {
        log::warn!("Failed to remove hook settings: {}", e);
    }
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

    remove_aiterm_skill();
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

    mcp_servers[mcp_server_key()] = serde_json::json!({
        "type": "http",
        "url": format!("http://127.0.0.1:{}/mcp", port),
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

    log::info!("Registered {} MCP server in ~/.claude.json (port {})", mcp_server_key(), port);
    Ok(())
}

/// Remove the MCP server entry from ~/.claude.json on shutdown.
fn remove_mcp_settings() -> Result<(), String> {
    let path = claude_settings_path().ok_or("Could not determine home directory")?;
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings.json: {}", e))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));

    if let Some(mcp_servers) = settings.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
        mcp_servers.remove(mcp_server_key());
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

    log::info!("Removed {} MCP server from ~/.claude.json", mcp_server_key());
    Ok(())
}

/// Build the hook URL marker used to identify our hook entries.
fn hook_url_marker(port: u16) -> String {
    format!("http://127.0.0.1:{}/hooks", port)
}

/// Write Claude Code hooks into ~/.claude/settings.json.
///
/// Registers:
/// - SessionStart (command) — reads $AITERM_TAB_ID, POSTs to our server, injects tab ID context
/// - SessionEnd, Notification, Stop (http) — lightweight event notifications
///
/// We identify our entries by matching the hook URL, so we don't clobber user hooks.
fn write_hook_settings(port: u16, auth: &str) -> Result<(), String> {
    let path = claude_user_settings_path().ok_or("Could not determine home directory")?;

    let mut settings: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings: {}", e))?;
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let hooks_url = hook_url_marker(port);

    // SessionStart command hook: reads session_id from stdin JSON, echoes tab ID + session ID
    // into Claude's context so Claude passes both to initSession.
    // Gate on $AITERM_PORT matching our port to prevent dev/prod cross-talk.
    let mcp_key = if cfg!(debug_assertions) { "aiterm-dev" } else { "aiterm" };
    let session_start_cmd = format!(
        "{{ [ \"$AITERM_PORT\" = \"{port}\" ] || [ -z \"$AITERM_PORT\" ]; }} && \
         [ -n \"$AITERM_TAB_ID\" ] && \
         AITERM_SID=$(cat | sed -n 's/.*\"session_id\" *: *\"\\([^\"]*\\)\".*/\\1/p' | head -1) && \
         echo 'Your aiTerm tab ID is '$AITERM_TAB_ID'. Your session ID is '$AITERM_SID'. \
You MUST immediately call the {mcp_key} initSession tool with this tabId and sessionId before responding to the user. This is required for correct tab targeting.' || true",
        port = port,
        mcp_key = mcp_key,
    );

    let http_hook = |url: &str| -> serde_json::Value {
        serde_json::json!([{
            "matcher": "",
            "hooks": [{
                "type": "http",
                "url": url,
                "headers": {
                    "x-claude-code-ide-authorization": auth
                }
            }]
        }])
    };

    let our_hooks = serde_json::json!({
        "SessionStart": [
            // Command hook: echo tab ID into Claude's context + background curl for tab mapping
            {
                "matcher": "",
                "hooks": [{
                    "type": "command",
                    "command": session_start_cmd,
                    "timeout": 5
                }]
            },
            // HTTP hook: sends full event JSON (session_id, cwd) for session tracking
            {
                "matcher": "",
                "hooks": [{
                    "type": "http",
                    "url": &hooks_url,
                    "headers": {
                        "x-claude-code-ide-authorization": auth
                    }
                }]
            }
        ],
        "SessionEnd": http_hook(&hooks_url),
        "Notification": http_hook(&hooks_url),
        "Stop": http_hook(&hooks_url),
        "UserPromptSubmit": http_hook(&hooks_url),
        "PreToolUse": http_hook(&hooks_url),
        "PostToolUse": http_hook(&hooks_url),
        "PreCompact": http_hook(&hooks_url)
    });

    // Sweep: remove any aiTerm hook entries whose port has no live lockfile.
    // This catches orphans from crashes where cleanup never ran.
    let live_ports = collect_live_lockfile_ports();
    if let Some(hooks_map) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for (_event, entries) in hooks_map.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|entry| {
                    // Only filter aiTerm hook entries (contain 127.0.0.1:{port}/hooks)
                    match extract_hook_port(entry) {
                        Some(p) => live_ports.contains(&p) || p == port,
                        None => true, // Not an aiTerm hook — keep it
                    }
                });
                if arr.len() != before {
                    log::info!("Swept {} orphaned hook entries from event '{}'", before - arr.len(), _event);
                }
            }
        }
        hooks_map.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    }

    // Also sweep stale allowedHttpHookUrls
    if let Some(arr) = settings.get_mut("allowedHttpHookUrls").and_then(|v| v.as_array_mut()) {
        arr.retain(|v| {
            let url = v.as_str().unwrap_or("");
            match extract_port_from_url(url) {
                Some(p) => live_ports.contains(&p) || p == port,
                None => true,
            }
        });
        if arr.is_empty() {
            settings.as_object_mut().unwrap().remove("allowedHttpHookUrls");
        }
    }

    // Merge our hooks with existing user hooks (don't clobber)
    let hooks_obj = settings
        .as_object_mut()
        .ok_or("settings.json is not an object")?
        .entry("hooks")
        .or_insert(serde_json::json!({}));

    if let Some(hooks_map) = hooks_obj.as_object_mut() {
        if let Some(our_map) = our_hooks.as_object() {
            for (event_name, our_entries) in our_map {
                let event_array = hooks_map
                    .entry(event_name)
                    .or_insert(serde_json::json!([]));

                if let Some(arr) = event_array.as_array_mut() {
                    // Remove any existing aiTerm hook entries (by matching our URL pattern)
                    arr.retain(|entry| {
                        !entry_matches_url(entry, &hooks_url)
                    });
                    // Add our entries
                    if let Some(our_arr) = our_entries.as_array() {
                        arr.extend(our_arr.iter().cloned());
                    }
                }
            }
        }
    }

    // Also register our hooks URL in allowedHttpHookUrls
    let allowed = settings
        .as_object_mut()
        .unwrap()
        .entry("allowedHttpHookUrls")
        .or_insert(serde_json::json!([]));
    if let Some(arr) = allowed.as_array_mut() {
        let pattern = format!("http://127.0.0.1:{}/*", port);
        if !arr.iter().any(|v| v.as_str() == Some(&pattern)) {
            arr.push(serde_json::Value::String(pattern));
        }
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.aiterm-tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Cannot write settings tmp: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot update settings: {}", e)
    })?;

    log::info!("Registered Claude Code hooks in ~/.claude/settings.json (port {})", port);
    Ok(())
}

/// Collect ports from all live lockfiles (PIDs that are still running).
fn collect_live_lockfile_ports() -> Vec<u16> {
    let Some(dir) = ide_lock_dir() else { return vec![] };
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    let mut ports = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lock") {
            continue;
        }
        let Ok(contents) = fs::read_to_string(&path) else { continue };
        let Ok(data) = serde_json::from_str::<serde_json::Value>(&contents) else { continue };

        let alive = data
            .get("pid")
            .and_then(|v| v.as_u64())
            .map(|pid| is_process_alive(pid as u32))
            .unwrap_or(false);

        if alive {
            if let Some(port) = data.get("serverPort").and_then(|v| v.as_u64()) {
                ports.push(port as u16);
            }
        }
    }
    ports
}

/// Extract the port number from an aiTerm hook entry's URL/command.
fn extract_hook_port(entry: &serde_json::Value) -> Option<u16> {
    if let Some(hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
        for hook in hooks {
            // HTTP hooks
            if let Some(url) = hook.get("url").and_then(|v| v.as_str()) {
                if let Some(port) = extract_port_from_url(url) {
                    return Some(port);
                }
            }
            // Command hooks — look for our URL or AITERM_PORT pattern
            if let Some(cmd) = hook.get("command").and_then(|v| v.as_str()) {
                if let Some(port) = extract_port_from_url(cmd) {
                    return Some(port);
                }
                // Also match AITERM_PORT = "NNNNN" pattern (old hook format)
                if let Some(port) = extract_port_from_aiterm_var(cmd) {
                    return Some(port);
                }
            }
        }
    }
    None
}

/// Extract port from AITERM_PORT = "12345" or AITERM_PORT\" = \"12345\" patterns in command strings.
fn extract_port_from_aiterm_var(s: &str) -> Option<u16> {
    // Match both: AITERM_PORT" = "12345" and AITERM_PORT = "12345"
    let marker = "AITERM_PORT";
    let idx = s.find(marker)? + marker.len();
    let rest = &s[idx..];
    // Skip past quotes, spaces, equals, backslashes
    let digits_start = rest.find(|c: char| c.is_ascii_digit())?;
    let rest = &rest[digits_start..];
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    if end == 0 { return None; }
    rest[..end].parse::<u16>().ok()
}

/// Extract port from a string like "http://127.0.0.1:12345/hooks" or "...127.0.0.1:12345/*"
fn extract_port_from_url(s: &str) -> Option<u16> {
    let marker = "127.0.0.1:";
    let idx = s.find(marker)? + marker.len();
    let rest = &s[idx..];
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse::<u16>().ok()
}

/// Check if a hook entry contains a URL matching our server.
fn entry_matches_url(entry: &serde_json::Value, url_pattern: &str) -> bool {
    if let Some(hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
        for hook in hooks {
            // HTTP hooks: check url field
            if let Some(url) = hook.get("url").and_then(|v| v.as_str()) {
                if url.starts_with(url_pattern) {
                    return true;
                }
            }
            // Command hooks: check command field for our URL
            if let Some(cmd) = hook.get("command").and_then(|v| v.as_str()) {
                if cmd.contains(url_pattern) {
                    return true;
                }
            }
        }
    }
    false
}

/// Remove our hook entries from ~/.claude/settings.json on shutdown.
fn remove_hook_settings(port: u16, auth: &str) -> Result<(), String> {
    let path = claude_user_settings_path().ok_or("Could not determine home directory")?;
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings: {}", e))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));

    let mut changed = false;

    // Remove hook entries that contain our auth token (identifies our server instance)
    if let Some(hooks_map) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for (_event, entries) in hooks_map.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|entry| !entry_contains_auth(entry, auth));
                if arr.len() != before {
                    changed = true;
                }
            }
        }
        // Clean up empty event arrays
        hooks_map.retain(|_, v| {
            v.as_array().map(|a| !a.is_empty()).unwrap_or(true)
        });
    }

    // Clean up empty hooks object
    if let Some(hooks) = settings.get("hooks").and_then(|v| v.as_object()) {
        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
            changed = true;
        }
    }

    // Clean up our port-specific allowedHttpHookUrls entry
    let our_url_pattern = format!("http://127.0.0.1:{}/*", port);
    if let Some(arr) = settings.get_mut("allowedHttpHookUrls").and_then(|v| v.as_array_mut()) {
        let before = arr.len();
        arr.retain(|v| v.as_str() != Some(&our_url_pattern));
        if arr.len() != before {
            changed = true;
        }
        if arr.is_empty() {
            settings.as_object_mut().unwrap().remove("allowedHttpHookUrls");
        }
    }

    if !changed {
        return Ok(());
    }

    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.aiterm-tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Cannot write settings tmp: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot update settings: {}", e)
    })?;

    log::info!("Removed Claude Code hooks from ~/.claude/settings.json");
    Ok(())
}

/// Check if a hook entry contains a specific auth token (used for cleanup).
fn entry_contains_auth(entry: &serde_json::Value, auth: &str) -> bool {
    if let Some(hooks) = entry.get("hooks").and_then(|v| v.as_array()) {
        for hook in hooks {
            if let Some(headers) = hook.get("headers").and_then(|v| v.as_object()) {
                if let Some(h) = headers.get("x-claude-code-ide-authorization").and_then(|v| v.as_str()) {
                    if h == auth {
                        return true;
                    }
                }
            }
            if let Some(cmd) = hook.get("command").and_then(|v| v.as_str()) {
                if cmd.contains(auth) {
                    return true;
                }
            }
        }
    }
    false
}

/// Directory for the /aiterm skill: ~/.claude/skills/aiterm/
fn aiterm_skill_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("skills").join("aiterm"))
}

/// Install the /aiterm slash command skill globally.
/// This gives all Claude Code sessions fast access to aiTerm operations
/// without LLM reasoning about which tool to use.
fn write_aiterm_skill() -> Result<(), String> {
    let dir = aiterm_skill_dir().ok_or("Could not determine home directory")?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create skill dir: {}", e))?;

    let skill = r#"---
name: aiterm
description: Quick aiTerm terminal operations — /aiterm notes, /aiterm diag, /aiterm tabs, etc.
---

Execute the aiTerm MCP tool for the requested operation. Use whichever aiterm MCP server you already called initSession on (aiterm or aiterm-dev). If you haven't initialized yet, call initSession first.

## Command reference

| Command | MCP Tool | Parameters |
|---------|----------|------------|
| `notes` | openNotesPanel | `{ "open": true }` |
| `notes close` | openNotesPanel | `{ "open": false }` |
| `notes read` | getTabNotes | `{}` |
| `notes write <content>` | setTabNotes | `{ "notes": "<content>" }` |
| `tabs` | listWorkspaces | `{}` |
| `tab` | getActiveTab | `{}` |
| `diag` | getDiagnostics | `{}` |
| `vars` | getTriggerVariables | `{}` |
| `var <name> <value>` | setTriggerVariable | `{ "name": "<name>", "value": "<value>" }` |
| `resume on` | setAutoResume | `{ "enabled": true }` |
| `resume off` | setAutoResume | `{ "enabled": false }` |
| `resume` | getAutoResume | `{}` |
| `notify <title> <body>` | sendNotification | `{ "title": "<title>", "body": "<body>" }` |
| `logs` | readLogs | `{}` |
| `logs <search>` | readLogs | `{ "search": "<search>" }` |
| `sessions` | getClaudeSessions | `{}` |
| `init` | initSession | `{ "tabId": "$AITERM_TAB_ID", "sessionId": "<from SessionStart hook>" }` |

Call the exact MCP tool listed above with the specified parameters. Do not ask for clarification — just execute.
For `init`: read tabId from $AITERM_TAB_ID env var and sessionId from your SessionStart hook context.

$ARGUMENTS
"#;

    let path = dir.join("SKILL.md");
    fs::write(&path, skill).map_err(|e| format!("Failed to write skill: {}", e))?;
    log::info!("Wrote /aiterm skill at {:?}", path);
    Ok(())
}

/// Remove the /aiterm skill directory.
fn remove_aiterm_skill() {
    if let Some(dir) = aiterm_skill_dir() {
        if dir.exists() {
            if let Err(e) = fs::remove_dir_all(&dir) {
                log::warn!("Failed to remove aiterm skill dir: {}", e);
            } else {
                log::info!("Removed /aiterm skill");
            }
        }
    }
}

pub fn cleanup_stale_lockfiles() {
    let Some(dir) = ide_lock_dir() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };

    let mut stale_ports: Vec<(u16, String)> = Vec::new(); // (port, auth) for dead servers

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
            let alive = is_process_alive(pid as u32);
            if !alive {
                // Collect port/auth before deleting so we can clean their hooks
                let port = data.get("serverPort").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
                let auth = data.get("authToken").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if port > 0 && !auth.is_empty() {
                    stale_ports.push((port, auth));
                }
                log::info!("Removing stale lock file {:?} (pid {} dead)", path, pid);
                let _ = fs::remove_file(&path);
            }
        }
    }

    // Clean up hooks and allowedHttpHookUrls for all dead servers
    if !stale_ports.is_empty() {
        if let Err(e) = cleanup_stale_hooks(&stale_ports) {
            log::warn!("Failed to clean stale hooks: {}", e);
        }
    }
}

/// Remove hook entries and allowedHttpHookUrls for a list of dead (port, auth) pairs.
fn cleanup_stale_hooks(stale_ports: &[(u16, String)]) -> Result<(), String> {
    let path = claude_user_settings_path().ok_or("Could not determine home directory")?;
    if !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read settings: {}", e))?;
    let mut settings: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
    let mut changed = false;

    // Remove hook entries by auth token
    if let Some(hooks_map) = settings.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        for (_event, entries) in hooks_map.iter_mut() {
            if let Some(arr) = entries.as_array_mut() {
                let before = arr.len();
                arr.retain(|entry| {
                    !stale_ports.iter().any(|(_, auth)| entry_contains_auth(entry, auth))
                });
                if arr.len() != before {
                    changed = true;
                }
            }
        }
        hooks_map.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    }

    // Clean up empty hooks object
    if settings.get("hooks").and_then(|v| v.as_object()).map(|h| h.is_empty()).unwrap_or(false) {
        settings.as_object_mut().unwrap().remove("hooks");
        changed = true;
    }

    // Remove allowedHttpHookUrls entries for dead ports
    if let Some(arr) = settings.get_mut("allowedHttpHookUrls").and_then(|v| v.as_array_mut()) {
        let before = arr.len();
        arr.retain(|v| {
            let url = v.as_str().unwrap_or("");
            !stale_ports.iter().any(|(port, _)| url == format!("http://127.0.0.1:{}/*", port))
        });
        if arr.len() != before {
            changed = true;
        }
        if arr.is_empty() {
            settings.as_object_mut().unwrap().remove("allowedHttpHookUrls");
        }
    }

    if !changed {
        return Ok(());
    }

    let removed_count: usize = stale_ports.len();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.aiterm-tmp");
    fs::write(&tmp, &json).map_err(|e| format!("Cannot write settings tmp: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot update settings: {}", e)
    })?;

    log::info!("Cleaned {} stale hook entries from ~/.claude/settings.json", removed_count);
    Ok(())
}
