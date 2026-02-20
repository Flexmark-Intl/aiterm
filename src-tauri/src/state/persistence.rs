use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use super::workspace::{AppData, Layout, SplitDirection, SplitNode, WindowData};

/// Tracks whether the last load_state() successfully parsed a real state file.
/// When false, save_state() will NOT overwrite the backup — preserving the last
/// known-good backup from being clobbered by a default/empty state.
static LOADED_SUCCESSFULLY: AtomicBool = AtomicBool::new(false);

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

/// Patch raw JSON to migrate old action_type values before deserialization.
/// "alert" and "question" were briefly used as standalone action types before
/// being consolidated into "set_tab_state" with a separate tab_state field.
fn migrate_json(contents: &str) -> String {
    // Replace "action_type":"alert" with "action_type":"set_tab_state","tab_state":"alert"
    // and same for "question". Only matches inside action entries.
    contents
        .replace(r#""action_type":"alert""#, r#""action_type":"set_tab_state","tab_state":"alert""#)
        .replace(r#""action_type":"question""#, r#""action_type":"set_tab_state","tab_state":"question""#)
}

fn parse_state(contents: &str) -> Result<AppData, serde_json::Error> {
    let migrated = migrate_json(contents);
    serde_json::from_str::<AppData>(&migrated)
}

fn get_corrupt_path() -> Option<PathBuf> {
    dirs::data_dir().map(|p| p.join(app_data_slug()).join("aiterm-state.corrupt.json"))
}

/// Preserve a corrupt state file so the user can recover data manually.
fn preserve_corrupt(source: &PathBuf) {
    if let Some(corrupt_path) = get_corrupt_path() {
        if let Err(e) = fs::copy(source, &corrupt_path) {
            log::warn!("Failed to preserve corrupt state file: {}", e);
        } else {
            log::info!("Preserved corrupt state file at {:?}", corrupt_path);
        }
    }
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
        Ok(contents) => match parse_state(&contents) {
            Ok(data) => {
                LOADED_SUCCESSFULLY.store(true, Ordering::Relaxed);
                data
            }
            Err(e) => {
                log::error!("Failed to parse state file: {}. Trying backup.", e);
                preserve_corrupt(&path);
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
        Ok(contents) => match parse_state(&contents) {
            Ok(data) => {
                log::info!("Successfully loaded from backup");
                LOADED_SUCCESSFULLY.store(true, Ordering::Relaxed);
                data
            }
            Err(e) => {
                log::error!("Backup also corrupt: {}. Using defaults.", e);
                preserve_corrupt(&backup_path);
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

    // Clone and filter out ephemeral diff tabs before serializing
    let mut filtered = data.clone();
    for win in &mut filtered.windows {
        for ws in &mut win.workspaces {
            for pane in &mut ws.panes {
                pane.tabs.retain(|t| t.tab_type != super::workspace::TabType::Diff);
                // Reset active_tab_id if it pointed to a removed diff tab
                if let Some(ref active_id) = pane.active_tab_id {
                    if !pane.tabs.iter().any(|t| t.id == *active_id) {
                        pane.active_tab_id = pane.tabs.last().map(|t| t.id.clone());
                    }
                }
            }
        }
    }

    let json = serde_json::to_string_pretty(&filtered).map_err(|e| e.to_string())?;

    // Write to temp file first
    fs::write(&temp_path, &json).map_err(|e| format!("Failed to write temp file: {}", e))?;

    // Only back up the current file if we know it was loaded successfully.
    // This prevents a failed-parse → default-state → save cycle from
    // clobbering the last known-good backup.
    if path.exists() && LOADED_SUCCESSFULLY.load(Ordering::Relaxed) {
        if let Err(e) = fs::copy(&path, &backup_path) {
            log::warn!("Failed to create backup: {}", e);
        }
    }

    // Atomic rename temp -> real path
    fs::rename(&temp_path, &path).map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}
