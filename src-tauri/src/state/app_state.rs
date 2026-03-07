use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
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

pub struct FileWatcherHandle {
    pub _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

/// Per-PTY byte counter
pub struct PtyStats {
    pub bytes_written: AtomicU64,
    pub bytes_read: AtomicU64,
}

pub const MEMORY_SAMPLE_CAP: usize = 60;

/// Memory sample taken on each getDiagnostics call
#[derive(Clone, serde::Serialize)]
pub struct MemorySample {
    pub timestamp_secs: u64,
    pub rss_bytes: u64,
}

pub struct AppState {
    pub pty_registry: RwLock<HashMap<String, PtyHandle>>,
    /// Maps tab_id → pty_id so we can auto-kill a previous PTY when a new one
    /// is spawned for the same tab (e.g. HMR remount, frontend crash recovery).
    pub tab_pty_map: RwLock<HashMap<String, String>>,
    pub app_data: RwLock<AppData>,
    // File watchers keyed by tab ID
    pub file_watchers: RwLock<HashMap<String, FileWatcherHandle>>,
    // Claude Code IDE integration
    pub claude_code_port: RwLock<Option<u16>>,
    pub claude_code_auth: RwLock<Option<String>>,
    pub claude_code_pending: RwLock<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
    pub claude_code_connected: RwLock<bool>,
    pub claude_code_notify_tx: parking_lot::Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
    // Diagnostics
    pub pty_stats: RwLock<HashMap<String, PtyStats>>,
    pub memory_samples: RwLock<Vec<MemorySample>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pty_registry: RwLock::new(HashMap::new()),
            tab_pty_map: RwLock::new(HashMap::new()),
            app_data: RwLock::new(AppData::default()),
            file_watchers: RwLock::new(HashMap::new()),
            claude_code_port: RwLock::new(None),
            claude_code_auth: RwLock::new(None),
            claude_code_pending: RwLock::new(HashMap::new()),
            claude_code_connected: RwLock::new(false),
            claude_code_notify_tx: parking_lot::Mutex::new(None),
            pty_stats: RwLock::new(HashMap::new()),
            memory_samples: RwLock::new(Vec::new()),
        }
    }
}
