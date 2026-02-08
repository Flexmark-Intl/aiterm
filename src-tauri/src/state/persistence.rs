use std::fs;
use std::path::PathBuf;

use super::workspace::AppData;

pub fn get_state_path() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join("com.aiterm.app").join("aiterm-state.json"))
}

pub fn load_state() -> AppData {
    let Some(path) = get_state_path() else {
        eprintln!("[load_state] No data directory found");
        return AppData::default();
    };

    eprintln!("[load_state] Loading from {:?}", path);

    if !path.exists() {
        eprintln!("[load_state] File does not exist, using defaults");
        return AppData::default();
    }

    match fs::read_to_string(&path) {
        Ok(contents) => {
            let data: AppData = serde_json::from_str(&contents).unwrap_or_default();
            // Log scrollback lengths for each tab
            for ws in &data.workspaces {
                for win in &ws.windows {
                    for tab in &win.tabs {
                        let sb_len = tab.scrollback.as_ref().map(|s| s.len()).unwrap_or(0);
                        eprintln!("[load_state] Tab {} scrollback: {} chars", &tab.id[..8.min(tab.id.len())], sb_len);
                    }
                }
            }
            data
        },
        Err(e) => {
            eprintln!("[load_state] Failed to read file: {}", e);
            AppData::default()
        }
    }
}

pub fn save_state(data: &AppData) -> Result<(), String> {
    let path = get_state_path().ok_or("Could not determine data directory")?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;

    // Log what we're saving
    eprintln!("[save_state] Saving to {:?} ({} bytes)", path, json.len());

    fs::write(&path, json).map_err(|e| e.to_string())?;

    Ok(())
}
