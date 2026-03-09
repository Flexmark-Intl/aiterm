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

/// Remote file watch entry for SSH-based polling.
pub struct RemoteFileWatch {
    pub user_host: String,
    pub remote_path: String,
    pub last_mtime: Option<u64>,
}

/// Active SSH MCP tunnel info (reverse port forward to expose local MCP on remote).
pub struct SshTunnel {
    pub pid: u32,
    pub remote_port: u16,
    pub host_key: String,
    pub tab_ids: std::collections::HashSet<String>,
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
    pub claude_code_shutdown: parking_lot::Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    // SSH MCP tunnels: keyed by host_key (user@host)
    pub ssh_tunnels: RwLock<HashMap<String, SshTunnel>>,
    // Remote file watchers (SSH stat polling): keyed by tab_id
    pub remote_file_watchers: RwLock<HashMap<String, RemoteFileWatch>>,
    pub remote_watcher_running: std::sync::atomic::AtomicBool,
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
            claude_code_shutdown: parking_lot::Mutex::new(None),
            ssh_tunnels: RwLock::new(HashMap::new()),
            remote_file_watchers: RwLock::new(HashMap::new()),
            remote_watcher_running: std::sync::atomic::AtomicBool::new(false),
            pty_stats: RwLock::new(HashMap::new()),
            memory_samples: RwLock::new(Vec::new()),
        }
    }
}
