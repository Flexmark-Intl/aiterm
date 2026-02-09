use std::fs;
use std::path::PathBuf;

use super::workspace::{AppData, Layout, SplitDirection, SplitNode, WindowData};

pub fn app_data_slug() -> &'static str {
    if cfg!(debug_assertions) {
        "com.aiterm.dev"
    } else {
        "com.aiterm.app"
    }
}

pub fn get_state_path() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(app_data_slug()).join("aiterm-state.json"))
}

fn get_backup_path() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(app_data_slug()).join("aiterm-state.bak.json"))
}

fn get_temp_path() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(app_data_slug()).join("aiterm-state.tmp.json"))
}

pub fn load_state() -> AppData {
    let Some(path) = get_state_path() else {
        log::warn!("No data directory found");
        return AppData::default();
    };

    log::info!("Loading state from {:?}", path);

    if !path.exists() {
        log::info!("State file does not exist, using defaults");
        return AppData::default();
    }

    match fs::read_to_string(&path) {
        Ok(contents) => match serde_json::from_str::<AppData>(&contents) {
            Ok(data) => data,
            Err(e) => {
                log::error!("Failed to parse state file: {}. Trying backup.", e);
                load_from_backup()
            }
        },
        Err(e) => {
            log::error!("Failed to read state file: {}. Trying backup.", e);
            load_from_backup()
        }
    }
}

fn load_from_backup() -> AppData {
    let Some(backup_path) = get_backup_path() else {
        log::warn!("No backup path available, using defaults");
        return AppData::default();
    };

    if !backup_path.exists() {
        log::info!("No backup file found, using defaults");
        return AppData::default();
    }

    match fs::read_to_string(&backup_path) {
        Ok(contents) => match serde_json::from_str::<AppData>(&contents) {
            Ok(data) => {
                log::info!("Successfully loaded from backup");
                data
            }
            Err(e) => {
                log::error!("Backup also corrupt: {}. Using defaults.", e);
                AppData::default()
            }
        },
        Err(e) => {
            log::error!("Failed to read backup: {}. Using defaults.", e);
            AppData::default()
        }
    }
}

pub fn migrate_app_data(data: &mut AppData) {
    // Migrate from old single-window format to multi-window format
    if data.windows.is_empty() {
        if let Some(old_workspaces) = data.workspaces.take() {
            if !old_workspaces.is_empty() {
                let mut win = WindowData::new("main".to_string());
                win.workspaces = old_workspaces;
                win.active_workspace_id = data.active_workspace_id.take();
                win.sidebar_width = data.sidebar_width.unwrap_or(180);
                win.sidebar_collapsed = data.sidebar_collapsed.unwrap_or(false);
                data.windows.push(win);
                log::info!("Migration: moved old workspaces into WindowData 'main'");
            }
        }
    }

    let direction = match data.layout.as_ref() {
        Some(Layout::Vertical) => SplitDirection::Vertical,
        _ => SplitDirection::Horizontal,
    };

    // Per-window / per-workspace migrations
    for window in &mut data.windows {
        for workspace in &mut window.workspaces {
            // Migrate tabs: any tab with a non-default name that lacks custom_name flag
            for pane in &mut workspace.panes {
                for tab in &mut pane.tabs {
                    if !tab.custom_name && tab.name != "Terminal" {
                        tab.custom_name = true;
                        log::info!(
                            "Migration: set custom_name=true for tab '{}' (id={})",
                            tab.name, tab.id
                        );
                    }
                }
            }

            // Migrate split_root from flat pane list
            if workspace.split_root.is_none() && !workspace.panes.is_empty() {
                if workspace.panes.len() == 1 {
                    workspace.split_root = Some(SplitNode::Leaf {
                        pane_id: workspace.panes[0].id.clone(),
                    });
                } else {
                    let mut node = SplitNode::Leaf {
                        pane_id: workspace.panes[0].id.clone(),
                    };
                    for pane in &workspace.panes[1..] {
                        node = SplitNode::Split {
                            id: uuid::Uuid::new_v4().to_string(),
                            direction: direction.clone(),
                            ratio: 0.5,
                            children: Box::new((
                                node,
                                SplitNode::Leaf {
                                    pane_id: pane.id.clone(),
                                },
                            )),
                        };
                    }
                    workspace.split_root = Some(node);
                }
                log::info!(
                    "Migration: converted {} flat panes to split tree for workspace '{}'",
                    workspace.panes.len(),
                    workspace.name
                );
            }
        }
    }
}

pub fn save_state(data: &AppData) -> Result<(), String> {
    let path = get_state_path().ok_or("Could not determine data directory")?;
    let temp_path = get_temp_path().ok_or("Could not determine temp path")?;
    let backup_path = get_backup_path().ok_or("Could not determine backup path")?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;

    // Write to temp file first
    fs::write(&temp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Copy current state to backup (if it exists)
    if path.exists() {
        if let Err(e) = fs::copy(&path, &backup_path) {
            log::warn!("Failed to create backup: {}", e);
        }
    }

    // Atomic rename temp -> real path
    fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}
