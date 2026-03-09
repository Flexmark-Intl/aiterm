use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::Body,
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

use super::lockfile::{cleanup_stale_lockfiles, write_lockfile};
use super::protocol::{initialize_response, tool_list_response, JsonRpcRequest, JsonRpcResponse};
use crate::state::AppState;

const PING_INTERVAL: Duration = Duration::from_secs(30);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(120);
const SSE_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Per-SSE-session sender: receives raw JSON strings, which the SSE stream wraps as data events.
type SseSessions = Arc<parking_lot::RwLock<HashMap<String, mpsc::UnboundedSender<String>>>>;

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    state: Arc<AppState>,
    expected_auth: String,
    sse_sessions: SseSessions,
}

pub async fn start_server(app_handle: AppHandle, state: Arc<AppState>) {
    cleanup_stale_lockfiles();

    {
        let data = state.app_data.read();
        if !data.preferences.claude_code_ide {
            log::info!("Claude Code IDE integration disabled in preferences");
            return;
        }
    }

    let port_candidates: Vec<u16> = {
        let mut rng = rand::thread_rng();
        (0..100).map(|_| rng.gen_range(10000..65535u16)).collect()
    };

    let mut bound_listener = None;
    for port in &port_candidates {
        match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await {
            Ok(l) => {
                bound_listener = Some(l);
                break;
            }
            Err(_) => continue,
        }
    }

    let listener = match bound_listener {
        Some(l) => l,
        None => {
            log::error!("Failed to bind Claude Code server on any port");
            return;
        }
    };

    let port = listener.local_addr().unwrap().port();

    let auth: String = {
        let rng = rand::thread_rng();
        rng.sample_iter(&rand::distributions::Alphanumeric)
            .take(32)
            .map(char::from)
            .collect()
    };

    *state.claude_code_port.write() = Some(port);
    *state.claude_code_auth.write() = Some(auth.clone());

    let workspace_folders = collect_workspace_folders(&state);
    if let Err(e) = write_lockfile(port, &auth, workspace_folders) {
        log::warn!("Failed to write Claude Code lock file: {}", e);
    }

    log::info!("Claude Code IDE server listening on http://127.0.0.1:{}", port);

    // Graceful shutdown signal — sender stored in AppState, triggered on app exit
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);
    *state.claude_code_shutdown.lock() = Some(shutdown_tx);

    let sse_sessions: SseSessions = Arc::new(parking_lot::RwLock::new(HashMap::new()));

    let server_state = ServerState {
        app_handle,
        state,
        expected_auth: auth,
        sse_sessions,
    };

    let app = Router::new()
        // WebSocket — IDE integration (discovered via lock file)
        .route("/", get(ws_upgrade_handler))
        // Streamable HTTP — modern MCP transport (POST returns JSON or SSE)
        .route("/mcp", post(streamable_http_handler))
        // Legacy SSE — older MCP clients (GET /sse + POST /message)
        .route("/sse", get(sse_get_handler))
        .route("/message", post(sse_message_handler))
        .with_state(server_state);

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.wait_for(|v| *v).await;
            log::info!("Claude Code server shutting down");
        })
        .await
    {
        log::error!("Claude Code server error: {}", e);
    }
}

/// Find the window label that owns a given tab ID.
fn find_window_for_tab(state: &Arc<AppState>, tab_id: &str) -> Option<String> {
    let app_data = state.app_data.read();
    for win in &app_data.windows {
        for ws in &win.workspaces {
            for pane in &ws.panes {
                if pane.tabs.iter().any(|t| t.id == tab_id) {
                    return Some(win.label.clone());
                }
            }
        }
    }
    None
}

/// Resolve the best window label to emit a tool event to.
/// Checks windowId, then tabId in the tool arguments, then falls back to the first window.
fn resolve_target_window(state: &Arc<AppState>, arguments: &Value) -> Option<String> {
    let app_data = state.app_data.read();

    // If a windowId (UUID) is provided, find the window by ID
    if let Some(window_id) = arguments.get("windowId").and_then(|v| v.as_str()) {
        if let Some(win) = app_data.windows.iter().find(|w| w.id == window_id) {
            return Some(win.label.clone());
        }
    }

    // If a tabId is provided, find the owning window
    if let Some(tab_id) = arguments.get("tabId").and_then(|v| v.as_str()) {
        drop(app_data); // release read lock for find_window_for_tab
        if let Some(label) = find_window_for_tab(state, tab_id) {
            return Some(label);
        }
        return state.app_data.read().windows.first().map(|w| w.label.clone());
    }

    // Fall back to the first window (main)
    app_data.windows.first().map(|w| w.label.clone())
}

/// Preference metadata: description, type, category, default value.
/// Read-only preferences cannot be set via the setPreference tool.
struct PrefMeta {
    description: &'static str,
    ptype: &'static str,
    category: &'static str,
    read_only: bool,
}

fn preference_meta() -> Vec<(&'static str, PrefMeta)> {
    vec![
        ("ui_font_size", PrefMeta { description: "UI font size in pixels (non-terminal elements)", ptype: "number", category: "Appearance", read_only: false }),
        ("font_size", PrefMeta { description: "Terminal font size in pixels", ptype: "number", category: "Terminal", read_only: false }),
        ("font_family", PrefMeta { description: "Terminal font family", ptype: "string", category: "Terminal", read_only: false }),
        ("cursor_style", PrefMeta { description: "Terminal cursor shape (block, underline, bar)", ptype: "string", category: "Terminal", read_only: false }),
        ("cursor_blink", PrefMeta { description: "Whether the cursor blinks", ptype: "boolean", category: "Terminal", read_only: false }),
        ("scrollback_limit", PrefMeta { description: "Maximum scrollback lines per terminal", ptype: "number", category: "Terminal", read_only: false }),
        ("shell_title_integration", PrefMeta { description: "Allow shell to set tab titles via OSC escape sequences", ptype: "boolean", category: "Terminal", read_only: false }),
        ("shell_integration", PrefMeta { description: "Enable OSC 133 shell integration for command detection", ptype: "boolean", category: "Terminal", read_only: false }),
        ("file_link_action", PrefMeta { description: "How file links in the terminal are activated", ptype: "string", category: "Terminal", read_only: false }),
        ("windows_shell", PrefMeta { description: "Default shell on Windows", ptype: "string", category: "Terminal", read_only: false }),
        ("theme", PrefMeta { description: "Color theme ID (built-in or custom)", ptype: "string", category: "Appearance", read_only: false }),
        ("auto_save_interval", PrefMeta { description: "Auto-save interval in seconds (0 to disable)", ptype: "number", category: "General", read_only: false }),
        ("restore_session", PrefMeta { description: "Restore tabs and workspaces on app restart", ptype: "boolean", category: "General", read_only: false }),
        ("number_duplicated_tabs", PrefMeta { description: "Prefix duplicated tab names with numbers", ptype: "boolean", category: "Tabs", read_only: false }),
        ("tab_button_style", PrefMeta { description: "Tab close button visibility (hover, always)", ptype: "string", category: "Tabs", read_only: false }),
        ("clone_cwd", PrefMeta { description: "Copy working directory when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_scrollback", PrefMeta { description: "Copy scrollback buffer when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_ssh", PrefMeta { description: "Copy SSH session when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_history", PrefMeta { description: "Copy shell history when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_notes", PrefMeta { description: "Copy notes when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_auto_resume", PrefMeta { description: "Copy auto-resume config when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("clone_variables", PrefMeta { description: "Copy trigger variables when duplicating tabs", ptype: "boolean", category: "Tabs", read_only: false }),
        ("notification_mode", PrefMeta { description: "Notification delivery mode (auto, in_app, native, disabled)", ptype: "string", category: "Notifications", read_only: false }),
        ("notify_min_duration", PrefMeta { description: "Minimum command duration (seconds) before notifying on completion", ptype: "number", category: "Notifications", read_only: false }),
        ("notification_sound", PrefMeta { description: "Notification sound (default, system, none)", ptype: "string", category: "Notifications", read_only: false }),
        ("notification_volume", PrefMeta { description: "Notification volume percentage", ptype: "number", category: "Notifications", read_only: false }),
        ("toast_font_size", PrefMeta { description: "Toast notification font size", ptype: "number", category: "Notifications", read_only: false }),
        ("toast_width", PrefMeta { description: "Toast notification width in pixels", ptype: "number", category: "Notifications", read_only: false }),
        ("toast_duration", PrefMeta { description: "Toast auto-dismiss duration in seconds", ptype: "number", category: "Notifications", read_only: false }),
        ("notes_font_size", PrefMeta { description: "Notes panel font size", ptype: "number", category: "Notes", read_only: false }),
        ("notes_font_family", PrefMeta { description: "Notes panel font family", ptype: "string", category: "Notes", read_only: false }),
        ("notes_width", PrefMeta { description: "Notes panel width in pixels", ptype: "number", category: "Notes", read_only: false }),
        ("notes_word_wrap", PrefMeta { description: "Wrap long lines in notes panel", ptype: "boolean", category: "Notes", read_only: false }),
        ("notes_scope", PrefMeta { description: "Default notes panel view (tab, workspace)", ptype: "string", category: "Notes", read_only: false }),
        ("show_recent_workspaces", PrefMeta { description: "Show recently used workspaces section in sidebar", ptype: "boolean", category: "Workspace", read_only: false }),
        ("workspace_sort_order", PrefMeta { description: "Workspace list sort order (default, alphabetical, recent)", ptype: "string", category: "Workspace", read_only: false }),
        ("show_workspace_tab_count", PrefMeta { description: "Show tab count badges on workspace items", ptype: "boolean", category: "Workspace", read_only: false }),
        ("claude_code_ide", PrefMeta { description: "Enable Claude Code IDE integration (MCP server)", ptype: "boolean", category: "Integration", read_only: false }),
        ("claude_code_ide_ssh", PrefMeta { description: "Enable MCP bridge over SSH (reverse tunnel for remote Claude Code)", ptype: "boolean", category: "Integration", read_only: false }),
        ("backup_directory", PrefMeta { description: "Backup directory path (null = scheduled backups disabled)", ptype: "string", category: "Backup", read_only: false }),
        ("backup_interval", PrefMeta { description: "Scheduled backup interval (off, hourly, daily, weekly, monthly)", ptype: "string", category: "Backup", read_only: false }),
        ("backup_compress", PrefMeta { description: "Compress backups with gzip", ptype: "boolean", category: "Backup", read_only: false }),
        ("backup_exclude_scrollback", PrefMeta { description: "Exclude terminal scrollback from backups", ptype: "boolean", category: "Backup", read_only: false }),
        ("backup_trim_enabled", PrefMeta { description: "Auto-delete old backups", ptype: "boolean", category: "Backup", read_only: false }),
        ("backup_trim_age", PrefMeta { description: "Max age for auto-trim (1h, 1d, 1w, 1m, 1y)", ptype: "string", category: "Backup", read_only: false }),
        ("prompt_patterns", PrefMeta { description: "Regex patterns for remote prompt/CWD detection", ptype: "string[]", category: "Terminal", read_only: true }),
        ("custom_themes", PrefMeta { description: "User-created custom color themes", ptype: "object[]", category: "Appearance", read_only: true }),
        ("triggers", PrefMeta { description: "Trigger rules for terminal pattern matching", ptype: "object[]", category: "Triggers", read_only: true }),
        ("hidden_default_triggers", PrefMeta { description: "IDs of deleted default trigger templates", ptype: "string[]", category: "Triggers", read_only: true }),
    ]
}

/// Handle tools that can be resolved entirely on the backend without frontend involvement.
/// Returns Some(result) if handled, None if the tool should be forwarded to the frontend.
fn handle_backend_tool(tool_name: &str, arguments: &Value, state: &Arc<AppState>, app_handle: &AppHandle) -> Option<Value> {
    match tool_name {
        "listWindows" => {
            let app_data = state.app_data.read();
            let windows: Vec<Value> = app_data.windows.iter()
                .filter(|w| w.label != "preferences" && w.label != "help")
                .map(|w| {
                    let workspaces: Vec<Value> = w.workspaces.iter().map(|ws| {
                        let tab_count: usize = ws.panes.iter().map(|p| p.tabs.len()).sum();
                        serde_json::json!({
                            "id": ws.id,
                            "name": ws.name,
                            "paneCount": ws.panes.len(),
                            "tabCount": tab_count,
                            "isActive": Some(&ws.id) == w.active_workspace_id.as_ref(),
                        })
                    }).collect();
                    serde_json::json!({
                        "windowId": w.id,
                        "windowLabel": w.label,
                        "workspaceCount": workspaces.len(),
                        "workspaces": workspaces,
                    })
                })
                .collect();
            Some(serde_json::json!({ "windows": windows }))
        }
        "getPreferences" => {
            let query = arguments.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let app_data = state.app_data.read();
            let prefs_json = serde_json::to_value(&app_data.preferences).unwrap_or(Value::Null);

            let entries: Vec<Value> = preference_meta().into_iter()
                .filter(|(key, meta)| {
                    if query.is_empty() { return true; }
                    let q = query.to_lowercase();
                    key.to_lowercase().contains(&q) || meta.description.to_lowercase().contains(&q)
                })
                .map(|(key, meta)| {
                    let value = prefs_json.get(key).cloned().unwrap_or(Value::Null);
                    let mut entry = serde_json::json!({
                        "key": key,
                        "value": value,
                        "description": meta.description,
                        "type": meta.ptype,
                        "category": meta.category,
                    });
                    if meta.read_only {
                        entry["readOnly"] = Value::Bool(true);
                    }
                    entry
                })
                .collect();

            Some(serde_json::json!({ "preferences": entries }))
        }
        "setPreference" => {
            let key = match arguments.get("key").and_then(|v| v.as_str()) {
                Some(k) => k,
                None => return Some(serde_json::json!({ "error": "Missing required parameter: key" })),
            };
            let value = match arguments.get("value") {
                Some(v) => v.clone(),
                None => return Some(serde_json::json!({ "error": "Missing required parameter: value" })),
            };

            // Verify key exists and is not read-only
            let meta_list = preference_meta();
            let meta = match meta_list.iter().find(|(k, _)| *k == key) {
                Some((_, m)) => m,
                None => return Some(serde_json::json!({ "error": format!("Unknown preference key: '{}'. Use getPreferences to discover available keys.", key) })),
            };
            if meta.read_only {
                return Some(serde_json::json!({ "error": format!("Preference '{}' is read-only and cannot be set via this tool.", key) }));
            }

            // Serialize current preferences to JSON, update the key, deserialize back
            let data_clone = {
                let mut app_data = state.app_data.write();
                let mut prefs_json = serde_json::to_value(&app_data.preferences).unwrap_or(Value::Null);
                if let Some(obj) = prefs_json.as_object_mut() {
                    obj.insert(key.to_string(), value.clone());
                }
                match serde_json::from_value::<crate::state::Preferences>(prefs_json) {
                    Ok(updated) => {
                        app_data.preferences = updated;
                        app_data.clone()
                    }
                    Err(e) => return Some(serde_json::json!({ "error": format!("Invalid value for '{}': {}", key, e) })),
                }
            };

            if let Err(e) = crate::state::save_state(&data_clone) {
                return Some(serde_json::json!({ "error": format!("Failed to save: {}", e) }));
            }

            // Broadcast change to all windows
            let _ = app_handle.emit("preferences-changed", &data_clone.preferences);

            Some(serde_json::json!({ "success": true, "key": key, "value": value }))
        }
        "createBackup" => {
            let app_data = state.app_data.read();
            let prefs = &app_data.preferences;

            // Determine backup directory — use argument override or configured default
            let dir = arguments.get("directory").and_then(|v| v.as_str())
                .or(prefs.backup_directory.as_deref());
            let dir = match dir {
                Some(d) => d.to_string(),
                None => return Some(serde_json::json!({ "error": "No backup directory configured. Pass 'directory' or set backup_directory in preferences." })),
            };

            let exclude_scrollback = arguments.get("excludeScrollback")
                .and_then(|v| v.as_bool())
                .unwrap_or(prefs.backup_exclude_scrollback);
            let compress = arguments.get("compress")
                .and_then(|v| v.as_bool())
                .unwrap_or(prefs.backup_compress);

            let dir_path = std::path::PathBuf::from(&dir);
            if !dir_path.exists() {
                if let Err(e) = std::fs::create_dir_all(&dir_path) {
                    return Some(serde_json::json!({ "error": format!("Failed to create backup directory: {}", e) }));
                }
            }

            let filtered = crate::commands::workspace::prepare_export(&app_data, exclude_scrollback);
            let json = match serde_json::to_string_pretty(&filtered) {
                Ok(j) => j,
                Err(e) => return Some(serde_json::json!({ "error": format!("Serialization failed: {}", e) })),
            };

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default();
            let secs = now.as_secs();
            // Simple UTC timestamp from epoch seconds
            let (s, m, h) = (secs % 60, (secs / 60) % 60, (secs / 3600) % 24);
            let days = secs / 86400;
            // Approximate date — good enough for filename uniqueness
            let y = 1970 + days / 365;
            let remainder = days % 365;
            let mo = remainder / 30 + 1;
            let da = remainder % 30 + 1;
            let timestamp = format!("{:04}{:02}{:02}_{:02}{:02}{:02}", y, mo, da, h, m, s);

            let ext = if compress { "json.gz" } else { "json" };
            let filename = format!("aiterm_backup_{}.{}", timestamp, ext);
            let file_path = dir_path.join(&filename);

            if compress {
                use flate2::write::GzEncoder;
                use flate2::Compression;
                use std::io::Write;
                let file = match std::fs::File::create(&file_path) {
                    Ok(f) => f,
                    Err(e) => return Some(serde_json::json!({ "error": format!("Failed to create file: {}", e) })),
                };
                let mut encoder = GzEncoder::new(file, Compression::default());
                if let Err(e) = encoder.write_all(json.as_bytes()) {
                    return Some(serde_json::json!({ "error": format!("Compression failed: {}", e) }));
                }
                if let Err(e) = encoder.finish() {
                    return Some(serde_json::json!({ "error": format!("Compression finalize failed: {}", e) }));
                }
            } else {
                if let Err(e) = std::fs::write(&file_path, &json) {
                    return Some(serde_json::json!({ "error": format!("Failed to write file: {}", e) }));
                }
            }

            let path_str = file_path.to_string_lossy().to_string();
            log::info!("MCP backup created: {}", path_str);
            Some(serde_json::json!({ "success": true, "path": path_str, "compressed": compress, "excludedScrollback": exclude_scrollback }))
        }
        _ => None,
    }
}

fn collect_workspace_folders(_state: &Arc<AppState>) -> Vec<String> {
    let mut folders = Vec::new();
    if let Some(home) = dirs::home_dir() {
        folders.push(home.to_string_lossy().to_string());
    }
    folders
}

fn set_connected(srv: &ServerState, connected: bool) {
    *srv.state.claude_code_connected.write() = connected;
    let _ = srv.app_handle.emit(
        "claude-code-connection",
        serde_json::json!({ "connected": connected }),
    );
}

// ─── WebSocket handler (IDE integration via lock file) ─────────────────────

async fn ws_upgrade_handler(
    ws: WebSocketUpgrade,
    State(srv): State<ServerState>,
    headers: HeaderMap,
) -> Response {
    let auth = headers
        .get("x-claude-code-ide-authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    if auth != srv.expected_auth {
        log::warn!("Claude Code WS connection rejected: invalid auth");
        return StatusCode::UNAUTHORIZED.into_response();
    }

    ws.on_upgrade(move |socket| handle_ws_connection(socket, srv))
}

async fn handle_ws_connection(socket: WebSocket, srv: ServerState) {
    log::info!("Claude Code WS client connected");
    set_connected(&srv, true);

    // response_tx: handle_message sends raw JSON here; main loop writes to WS
    let (response_tx, mut response_rx) = mpsc::unbounded_channel::<String>();
    *srv.state.claude_code_notify_tx.lock() = Some(response_tx.clone());

    let (mut ws_write, mut ws_read) = socket.split();
    let mut ping_interval = tokio::time::interval(PING_INTERVAL);
    ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            msg = ws_read.next() => {
                match msg {
                    Some(Ok(WsMessage::Text(text))) => {
                        handle_message(&text, &srv.app_handle, &srv.state, &response_tx).await;
                    }
                    Some(Ok(WsMessage::Ping(data))) => {
                        let _ = ws_write.send(WsMessage::Pong(data)).await;
                    }
                    Some(Ok(WsMessage::Close(_))) | None => {
                        log::info!("Claude Code WS client disconnected");
                        break;
                    }
                    Some(Err(e)) => {
                        log::warn!("Claude Code WS error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
            _ = ping_interval.tick() => {
                if ws_write.send(WsMessage::Ping(vec![].into())).await.is_err() {
                    break;
                }
            }
            response = response_rx.recv() => {
                if let Some(json) = response {
                    if ws_write.send(WsMessage::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    set_connected(&srv, false);
    *srv.state.claude_code_notify_tx.lock() = None;
    log::info!("Claude Code WS connection cleaned up");
}

// ─── Streamable HTTP handler (modern MCP transport) ────────────────────────

/// Handles POST /mcp — the Streamable HTTP MCP transport.
/// Each request is a JSON-RPC message. The response is returned as JSON
/// with an SSE wrapper (text/event-stream) so the client can handle
/// both synchronous and streaming responses uniformly.
async fn streamable_http_handler(
    State(srv): State<ServerState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let auth = headers
        .get("x-claude-code-ide-authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if auth != srv.expected_auth {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    // Process the JSON-RPC message and get the response
    let response_json = process_message(&body, &srv.app_handle, &srv.state).await;

    match response_json {
        Some(json) => {
            // Return as SSE event stream (single event then close)
            let sse_body = format!("event: message\ndata: {}\n\n", json);
            Response::builder()
                .status(200)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(Body::from(sse_body))
                .unwrap()
        }
        None => {
            // Notification — no response needed
            StatusCode::ACCEPTED.into_response()
        }
    }
}

// ─── SSE handlers (MCP server via ~/.claude/settings.json) ─────────────────

async fn sse_get_handler(State(srv): State<ServerState>, headers: HeaderMap) -> Response {
    let auth = headers
        .get("x-claude-code-ide-authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if auth != srv.expected_auth {
        log::warn!("Claude Code SSE connection rejected: invalid auth");
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    // sse_tx: carries raw JSON response strings from handle_message
    let (sse_tx, sse_rx) = mpsc::unbounded_channel::<String>();
    srv.sse_sessions.write().insert(session_id.clone(), sse_tx.clone());

    // Wire notify_tx to a bridge that forwards raw JSON as SSE data events
    let (notify_tx, mut notify_rx) = mpsc::unbounded_channel::<String>();
    let sse_tx_for_notify = sse_tx.clone();
    tokio::spawn(async move {
        while let Some(json) = notify_rx.recv().await {
            let _ = sse_tx_for_notify.send(json);
        }
    });
    *srv.state.claude_code_notify_tx.lock() = Some(notify_tx);

    set_connected(&srv, true);
    log::info!("Claude Code SSE client connected (session {}...)", &session_id[..8]);

    // First SSE event: tell Claude where to POST messages
    let endpoint_event =
        axum::body::Bytes::from(format!("event: endpoint\ndata: /message?sessionId={}\n\n", session_id));

    // SSE stream: start with endpoint event, then stream raw JSON wrapped as SSE data events
    let stream = futures_util::stream::once(futures_util::future::ready(Ok::<_, std::convert::Infallible>(endpoint_event)))
        .chain(futures_util::stream::unfold(sse_rx, |mut rx| async move {
            rx.recv().await.map(|json| {
                let event = axum::body::Bytes::from(format!("data: {}\n\n", json));
                (Ok::<_, std::convert::Infallible>(event), rx)
            })
        }));

    // Background task: send SSE keepalives and detect client disconnect
    let cleanup_srv = srv.clone();
    let cleanup_session_id = session_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(SSE_KEEPALIVE_INTERVAL).await;
            let tx = cleanup_srv.sse_sessions.read().get(&cleanup_session_id).cloned();
            match tx {
                Some(tx) => {
                    // SSE comment (keepalive) — sent directly pre-formatted since the stream
                    // expects raw JSON, but a keepalive isn't JSON. We detect disconnect via
                    // send failure on the sse_tx (receiver dropped when body is dropped).
                    if tx.is_closed() {
                        break;
                    }
                }
                None => break,
            }
        }
        cleanup_srv.sse_sessions.write().remove(&cleanup_session_id);
        set_connected(&cleanup_srv, false);
        *cleanup_srv.state.claude_code_notify_tx.lock() = None;
        log::info!("Claude Code SSE client disconnected");
    });

    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap()
}

#[derive(serde::Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

async fn sse_message_handler(
    State(srv): State<ServerState>,
    Query(params): Query<SessionQuery>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let auth = headers
        .get("x-claude-code-ide-authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if auth != srv.expected_auth {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let tx = srv.sse_sessions.read().get(&params.session_id).cloned();
    let Some(tx) = tx else {
        return StatusCode::NOT_FOUND.into_response();
    };

    handle_message(&body, &srv.app_handle, &srv.state, &tx).await;
    StatusCode::OK.into_response()
}

// ─── Shared JSON-RPC handler ────────────────────────────────────────────────

/// Process one JSON-RPC message and return the response as a raw JSON string.
/// Returns `None` for notifications (no id) that don't require a response.
async fn process_message(
    text: &str,
    app_handle: &AppHandle,
    state: &Arc<AppState>,
) -> Option<String> {
    let req: JsonRpcRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("Invalid JSON-RPC: {}", e);
            return None;
        }
    };

    let id = req.id.clone().unwrap_or(Value::Null);

    match req.method.as_str() {
        "initialize" => {
            let resp = JsonRpcResponse::success(id, initialize_response());
            Some(serde_json::to_string(&resp).unwrap())
        }
        "notifications/initialized" => None,
        "tools/list" => {
            let resp = JsonRpcResponse::success(id, tool_list_response());
            Some(serde_json::to_string(&resp).unwrap())
        }
        "tools/call" => {
            if let Some(params) = req.params {
                let tool_name = params
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let arguments = params
                    .get("arguments")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::new()));

                // Backend-only tools: handle directly without emitting to frontend
                if let Some(result) = handle_backend_tool(&tool_name, &arguments, state, app_handle) {
                    let content_text = serde_json::to_string(&result).unwrap_or_default();
                    let resp = JsonRpcResponse::success(
                        id,
                        serde_json::json!({
                            "content": [{ "type": "text", "text": content_text }]
                        }),
                    );
                    Some(serde_json::to_string(&resp).unwrap())
                } else {
                    // Frontend-handled tools: emit to the correct window
                    let request_id = uuid::Uuid::new_v4().to_string();
                    let (tx, rx) = oneshot::channel::<Value>();
                    state
                        .claude_code_pending
                        .write()
                        .insert(request_id.clone(), tx);

                    let payload = serde_json::json!({
                        "request_id": request_id,
                        "tool": tool_name,
                        "arguments": arguments,
                    });

                    // Emit to the specific window that owns the tab (avoids race
                    // when preferences/help windows also listen for the event)
                    if let Some(label) = resolve_target_window(state, &arguments) {
                        let _ = app_handle.emit_to(&label, "claude-code-tool", payload);
                    } else {
                        let _ = app_handle.emit("claude-code-tool", payload);
                    }

                    match tokio::time::timeout(RESPONSE_TIMEOUT, rx).await {
                        Ok(Ok(result)) => {
                            let content_text = serde_json::to_string(&result).unwrap_or_default();
                            let resp = JsonRpcResponse::success(
                                id,
                                serde_json::json!({
                                    "content": [{ "type": "text", "text": content_text }]
                                }),
                            );
                            Some(serde_json::to_string(&resp).unwrap())
                        }
                        Ok(Err(_)) => {
                            state.claude_code_pending.write().remove(&request_id);
                            let resp = JsonRpcResponse::error(
                                id,
                                -32603,
                                "Tool handler disconnected".to_string(),
                            );
                            Some(serde_json::to_string(&resp).unwrap())
                        }
                        Err(_) => {
                            state.claude_code_pending.write().remove(&request_id);
                            let resp = JsonRpcResponse::error(
                                id,
                                -32603,
                                "Tool response timeout".to_string(),
                            );
                            Some(serde_json::to_string(&resp).unwrap())
                        }
                    }
                }
            } else {
                let resp = JsonRpcResponse::error(id, -32602, "Missing params".to_string());
                Some(serde_json::to_string(&resp).unwrap())
            }
        }
        _ => {
            if req.id.is_some() {
                let resp = JsonRpcResponse::error(
                    id,
                    -32601,
                    format!("Method not found: {}", req.method),
                );
                Some(serde_json::to_string(&resp).unwrap())
            } else {
                None
            }
        }
    }
}

/// Channel-based wrapper: process a message and send the response to a channel.
/// Used by WebSocket and legacy SSE handlers.
async fn handle_message(
    text: &str,
    app_handle: &AppHandle,
    state: &Arc<AppState>,
    response_tx: &mpsc::UnboundedSender<String>,
) {
    if let Some(json) = process_message(text, app_handle, state).await {
        let _ = response_tx.send(json);
    }
}
