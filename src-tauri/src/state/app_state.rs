use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::mpsc::Sender;

use super::workspace::AppData;

pub enum PtyCommand {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Kill,
}

pub struct PtyHandle {
    pub sender: Sender<PtyCommand>,
    pub child_pid: Option<u32>,
}

pub struct AppState {
    pub pty_registry: RwLock<HashMap<String, PtyHandle>>,
    pub app_data: RwLock<AppData>,
    // Claude Code IDE integration
    pub claude_code_port: RwLock<Option<u16>>,
    pub claude_code_auth: RwLock<Option<String>>,
    pub claude_code_pending: RwLock<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
    pub claude_code_connected: RwLock<bool>,
    pub claude_code_notify_tx: parking_lot::Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pty_registry: RwLock::new(HashMap::new()),
            app_data: RwLock::new(AppData::default()),
            claude_code_port: RwLock::new(None),
            claude_code_auth: RwLock::new(None),
            claude_code_pending: RwLock::new(HashMap::new()),
            claude_code_connected: RwLock::new(false),
            claude_code_notify_tx: parking_lot::Mutex::new(None),
        }
    }
}
