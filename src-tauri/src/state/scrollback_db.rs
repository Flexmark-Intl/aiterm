use parking_lot::Mutex;
use rusqlite::Connection;
use std::collections::HashSet;
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

    pub fn delete_many(&self, tab_ids: &[String]) -> Result<(), String> {
        if tab_ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock();
        let tx = conn.transaction().map_err(|e| format!("Failed to begin tx: {}", e))?;
        for id in tab_ids {
            tx.execute(
                "DELETE FROM scrollback WHERE tab_id = ?1",
                rusqlite::params![id],
            ).map_err(|e| format!("Failed to delete scrollback: {}", e))?;
        }
        tx.commit().map_err(|e| format!("Failed to commit: {}", e))?;
        Ok(())
    }

    /// Delete any rows whose tab_id is not in `live_tab_ids`, then VACUUM
    /// so freed pages are returned to the OS. Returns count removed.
    pub fn prune_orphans(&self, live_tab_ids: &HashSet<String>) -> Result<usize, String> {
        let orphans: Vec<String> = {
            let conn = self.conn.lock();
            let mut stmt = conn
                .prepare("SELECT tab_id FROM scrollback")
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to query: {}", e))?;
            rows.filter_map(|r| r.ok())
                .filter(|id| !live_tab_ids.contains(id))
                .collect()
        };

        if orphans.is_empty() {
            return Ok(0);
        }

        self.delete_many(&orphans)?;

        let conn = self.conn.lock();
        let _ = conn.execute("VACUUM", []);
        Ok(orphans.len())
    }
}
