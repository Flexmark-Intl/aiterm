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
        // SSE — MCP server registration (via ~/.claude/settings.json)
        .route("/sse", get(sse_get_handler))
        .route("/message", post(sse_message_handler))
        .with_state(server_state);

    if let Err(e) = axum::serve(listener, app).await {
        log::error!("Claude Code server error: {}", e);
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

/// Process one JSON-RPC message and send the response (raw JSON string) to `response_tx`.
/// Used by both WebSocket (where main loop wraps in WsMessage::Text) and
/// SSE (where stream wraps as `data: …\n\n`).
async fn handle_message(
    text: &str,
    app_handle: &AppHandle,
    state: &Arc<AppState>,
    response_tx: &mpsc::UnboundedSender<String>,
) {
    let req: JsonRpcRequest = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(e) => {
            log::warn!("Invalid JSON-RPC: {}", e);
            return;
        }
    };

    let id = req.id.clone().unwrap_or(Value::Null);

    let response_json: Option<String> = match req.method.as_str() {
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

                let request_id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = oneshot::channel::<Value>();
                state
                    .claude_code_pending
                    .write()
                    .insert(request_id.clone(), tx);

                let _ = app_handle.emit(
                    "claude-code-tool",
                    serde_json::json!({
                        "request_id": request_id,
                        "tool": tool_name,
                        "arguments": arguments,
                    }),
                );

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
    };

    if let Some(json) = response_json {
        let _ = response_tx.send(json);
    }
}
