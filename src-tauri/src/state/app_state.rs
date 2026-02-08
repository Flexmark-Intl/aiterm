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
}

pub struct AppState {
    pub pty_registry: RwLock<HashMap<String, PtyHandle>>,
    pub app_data: RwLock<AppData>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            pty_registry: RwLock::new(HashMap::new()),
            app_data: RwLock::new(AppData::default()),
        }
    }
}
