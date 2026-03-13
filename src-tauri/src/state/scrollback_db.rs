use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::PathBuf;

pub struct ScrollbackDb {
    conn: Mutex<Connection>,
}

impl ScrollbackDb {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create DB directory: {}", e))?;
        }

        let conn = Connection::open(&path).map_err(|e| format!("Failed to open scrollback DB: {}", e))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS scrollback (
                 tab_id TEXT PRIMARY KEY,
                 data TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );"
        ).map_err(|e| format!("Failed to initialize scrollback DB: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save(&self, tab_id: &str, data: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT OR REPLACE INTO scrollback (tab_id, data, updated_at) VALUES (?1, ?2, datetime('now'))",
            rusqlite::params![tab_id, data],
        ).map_err(|e| format!("Failed to save scrollback: {}", e))?;
        Ok(())
    }

    pub fn load(&self, tab_id: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT data FROM scrollback WHERE tab_id = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        let result = stmt
            .query_row(rusqlite::params![tab_id], |row| row.get(0))
            .ok();
        Ok(result)
    }

    pub fn has(&self, tab_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT 1 FROM scrollback WHERE tab_id = ?1 LIMIT 1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        let exists = stmt.exists(rusqlite::params![tab_id])
            .map_err(|e| format!("Failed to check scrollback: {}", e))?;
        Ok(exists)
    }

    pub fn delete(&self, tab_id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM scrollback WHERE tab_id = ?1",
            rusqlite::params![tab_id],
        ).map_err(|e| format!("Failed to delete scrollback: {}", e))?;
        Ok(())
    }
}
