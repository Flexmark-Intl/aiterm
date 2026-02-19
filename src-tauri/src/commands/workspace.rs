use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, State};

use crate::state::{save_state, AppState, Pane, Preferences, Tab, Workspace};
use crate::state::workspace::WorkspaceNote;
use crate::state::persistence::app_data_slug;
use crate::state::workspace::{EditorFileInfo, SplitDirection};
use crate::commands::window::{TabContext, clone_workspace_with_id_mapping};

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    log::info!("exit_app called — terminating process");
    app.exit(0);
}

#[tauri::command]
pub fn sync_state(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    log::info!("Forcing state sync to disk");
    let data_clone = state.app_data.read().clone();
    save_state(&data_clone)?;
    log::info!("State saved successfully");
    Ok(())
}

#[tauri::command]
pub fn get_app_data(state: State<'_, Arc<AppState>>) -> crate::state::AppData {
    state.app_data.read().clone()
}

#[tauri::command]
pub fn create_workspace(window: tauri::Window, state: State<'_, Arc<AppState>>, name: String) -> Result<Workspace, String> {
    let label = window.label().to_string();
    let workspace = Workspace::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        win.workspaces.push(workspace.clone());
        win.active_workspace_id = Some(workspace.id.clone());
        app_data.clone()
    };
    save_state(&data_clone)?;
    Ok(workspace)
}

#[tauri::command]
pub fn delete_workspace(window: tauri::Window, state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        let old_index = win.workspaces.iter().position(|w| w.id == workspace_id).unwrap_or(0);
        win.workspaces.retain(|w| w.id != workspace_id);
        if win.active_workspace_id.as_ref() == Some(&workspace_id) {
            // Activate adjacent: prefer previous, fall back to next
            let adjacent = old_index.min(win.workspaces.len().saturating_sub(1));
            win.active_workspace_id = win.workspaces.get(adjacent).map(|w| w.id.clone());
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn rename_workspace(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.name = name;
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn split_pane(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    target_pane_id: String,
    direction: SplitDirection,
    scrollback: Option<String>,
    editor_file: Option<EditorFileInfo>,
) -> Result<Pane, String> {
    let label = window.label().to_string();
    let mut new_pane = if let Some(file_info) = editor_file {
        let name = file_info
            .file_path
            .rsplit('/')
            .next()
            .unwrap_or(&file_info.file_path)
            .to_string();
        let tab = Tab::new_editor(name.clone(), file_info);
        let tab_id = tab.id.clone();
        Pane {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            tabs: vec![tab],
            active_tab_id: Some(tab_id),
        }
    } else {
        Pane::new("Terminal".to_string())
    };
    if let Some(ref sb) = scrollback {
        if let Some(tab) = new_pane.tabs.first_mut() {
            tab.scrollback = Some(sb.clone());
        }
    }
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(ref root) = workspace.split_root {
                workspace.split_root =
                    Some(root.split_pane(&target_pane_id, &new_pane.id, direction));
            }
            workspace.panes.push(new_pane.clone());
            workspace.active_pane_id = Some(new_pane.id.clone());
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(new_pane)
}

#[tauri::command]
pub fn delete_pane(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(ref root) = workspace.split_root {
                workspace.split_root = root.remove_pane(&pane_id);
            }
            workspace.panes.retain(|p| p.id != pane_id);
            if workspace.active_pane_id.as_ref() == Some(&pane_id) {
                workspace.active_pane_id = workspace.panes.first().map(|p| p.id.clone());
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn rename_pane(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    name: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                pane.name = name;
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn create_tab(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    name: String,
) -> Result<Tab, String> {
    let label = window.label().to_string();
    let tab = Tab::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                pane.tabs.push(tab.clone());
                pane.active_tab_id = Some(tab.id.clone());
                app_data.clone()
            } else {
                return Err("Pane not found".to_string());
            }
        } else {
            return Err("Pane not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(tab)
}

#[tauri::command]
pub fn delete_tab(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                if pane.active_tab_id.as_ref() == Some(&tab_id) {
                    let old_index = pane.tabs.iter().position(|t| t.id == tab_id).unwrap_or(0);
                    pane.tabs.retain(|t| t.id != tab_id);
                    pane.active_tab_id = if pane.tabs.is_empty() {
                        None
                    } else {
                        // Prefer previous (left) tab; fall back to next if closing first tab
                        let new_index = if old_index > 0 {
                            old_index - 1
                        } else {
                            0
                        };
                        Some(pane.tabs[new_index].id.clone())
                    };
                } else {
                    pane.tabs.retain(|t| t.id != tab_id);
                }
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn rename_tab(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    name: String,
    custom_name: Option<bool>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.name = name;
                if let Some(cn) = custom_name {
                    tab.custom_name = cn;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_active_workspace(window: tauri::Window, state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    win.active_workspace_id = Some(workspace_id);
    Ok(())
}

#[tauri::command]
pub fn set_active_pane(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.active_pane_id = Some(pane_id);
    }
    Ok(())
}

#[tauri::command]
pub fn set_active_tab(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            pane.active_tab_id = Some(tab_id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tab_pty_id(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    pty_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.pty_id = Some(pty_id);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_sidebar_width(window: tauri::Window, state: State<'_, Arc<AppState>>, width: u32) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    win.sidebar_width = width;
    Ok(())
}

#[tauri::command]
pub fn set_sidebar_collapsed(window: tauri::Window, state: State<'_, Arc<AppState>>, collapsed: bool) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    win.sidebar_collapsed = collapsed;
    Ok(())
}

#[tauri::command]
pub fn set_split_ratio(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    split_id: String,
    ratio: f64,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(ref root) = workspace.split_root {
            workspace.split_root = Some(root.set_ratio(&split_id, ratio.clamp(0.1, 0.9)));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tab_scrollback(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    scrollback: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.scrollback = scrollback;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tab_notes(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    notes: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.notes = notes;
            }
        }
    }
    save_state(&app_data)?;
    Ok(())
}

#[tauri::command]
pub fn set_tab_notes_open(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    open: bool,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.notes_open = open;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tab_notes_mode(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    notes_mode: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.notes_mode = notes_mode;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn reorder_tabs(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_ids: Vec<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                let mut reordered = Vec::with_capacity(tab_ids.len());
                for id in &tab_ids {
                    if let Some(tab) = pane.tabs.iter().find(|t| &t.id == id) {
                        reordered.push(tab.clone());
                    }
                }
                pane.tabs = reordered;
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn get_preferences(state: State<'_, Arc<AppState>>) -> Preferences {
    state.app_data.read().preferences.clone()
}

#[tauri::command]
pub fn set_preferences(app: tauri::AppHandle, state: State<'_, Arc<AppState>>, preferences: Preferences) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.preferences = preferences.clone();
        app_data.clone()
    };
    save_state(&data_clone)?;
    // Broadcast to all windows so other windows pick up the change
    let _ = app.emit("preferences-changed", &preferences);
    Ok(())
}

#[tauri::command]
pub fn set_tab_restore_context(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    cwd: Option<String>,
    ssh_command: Option<String>,
    remote_cwd: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.restore_cwd = cwd;
                tab.restore_ssh_command = ssh_command;
                tab.restore_remote_cwd = remote_cwd;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_tab_auto_resume_context(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    cwd: Option<String>,
    ssh_command: Option<String>,
    remote_cwd: Option<String>,
    command: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.auto_resume_cwd = cwd;
                tab.auto_resume_ssh_command = ssh_command;
                tab.auto_resume_remote_cwd = remote_cwd;
                if command.is_some() {
                    tab.auto_resume_remembered_command = command.clone();
                }
                tab.auto_resume_command = command;
            }
        }
    }
    save_state(&app_data)?;
    Ok(())
}

#[tauri::command]
pub fn reorder_workspaces(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_ids: Vec<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        let mut reordered = Vec::with_capacity(workspace_ids.len());
        for id in &workspace_ids {
            if let Some(ws) = win.workspaces.iter().find(|w| &w.id == id) {
                reordered.push(ws.clone());
            }
        }
        win.workspaces = reordered;
        app_data.clone()
    };
    save_state(&data_clone)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DuplicateWorkspaceResult {
    pub workspace: Workspace,
    pub tab_id_map: HashMap<String, String>,
}

#[tauri::command]
pub fn duplicate_workspace(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    position: usize,
    tab_contexts: Vec<TabContext>,
) -> Result<DuplicateWorkspaceResult, String> {
    let label = window.label().to_string();
    let (data_clone, result) = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        let source = win.workspaces.iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?
            .clone();

        let (cloned, tab_id_map) = clone_workspace_with_id_mapping(&source, &tab_contexts);
        let result = DuplicateWorkspaceResult {
            workspace: cloned.clone(),
            tab_id_map,
        };

        let insert_pos = position.min(win.workspaces.len());
        win.workspaces.insert(insert_pos, cloned);

        (app_data.clone(), result)
    };
    save_state(&data_clone)?;
    Ok(result)
}

#[tauri::command]
pub fn set_tab_trigger_variables(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    vars: HashMap<String, String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let mut app_data = state.app_data.write();
    let win = app_data.window_mut(&label).ok_or("Window not found")?;
    if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
            if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.trigger_variables = vars;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn copy_tab_history(source_tab_id: String, dest_tab_id: String) -> Result<(), String> {
    let data_dir = dirs::data_dir().ok_or("No data directory")?;
    let history_dir = data_dir.join(app_data_slug()).join("history");

    let safe_source = source_tab_id.replace(['/', '\\', '.'], "");
    let safe_dest = dest_tab_id.replace(['/', '\\', '.'], "");

    let source_path = history_dir.join(format!("{}.history", safe_source));
    let dest_path = history_dir.join(format!("{}.history", safe_dest));

    if source_path.exists() {
        std::fs::copy(&source_path, &dest_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Return all workspace id/name pairs across all windows (for preferences UI).
#[tauri::command]
pub fn get_all_workspaces(state: State<'_, Arc<AppState>>) -> Vec<(String, String)> {
    let app_data = state.app_data.read();
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for win in &app_data.windows {
        for ws in &win.workspaces {
            if seen.insert(ws.id.clone()) {
                result.push((ws.id.clone(), ws.name.clone()));
            }
        }
    }
    result
}

/// Return the list of directories where system sounds live on this platform.
fn system_sound_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/System/Library/Sounds"),
            PathBuf::from("/Library/Sounds"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/share/sounds/freedesktop/stereo"),
            PathBuf::from("/usr/share/sounds"),
        ]
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(windir) = std::env::var_os("SystemRoot") {
            vec![PathBuf::from(windir).join("Media")]
        } else {
            vec![PathBuf::from("C:\\Windows\\Media")]
        }
    }
}

#[tauri::command]
pub fn list_system_sounds() -> Vec<String> {
    let mut names = Vec::new();
    for dir in system_sound_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_lower.as_str(), "aiff" | "aif" | "wav" | "ogg" | "mp3") {
                        if let Some(stem) = path.file_stem() {
                            names.push(stem.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    names.sort();
    names.dedup();
    names
}

#[tauri::command]
pub fn play_system_sound(name: String, volume: u32) -> Result<(), String> {
    // Find the sound file
    for dir in system_sound_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(stem) = path.file_stem() {
                    if stem.to_string_lossy() == name {
                        // Spawn playback in background (non-blocking)
                        let vol = (volume as f64 / 100.0).min(1.0);
                        #[cfg(target_os = "macos")]
                        {
                            let vol_str = format!("{:.2}", vol);
                            std::thread::spawn(move || {
                                let _ = std::process::Command::new("afplay")
                                    .arg("-v")
                                    .arg(&vol_str)
                                    .arg(&path)
                                    .output();
                            });
                            return Ok(());
                        }
                        #[cfg(target_os = "linux")]
                        {
                            std::thread::spawn(move || {
                                // Try paplay first (PulseAudio), fall back to aplay
                                let vol_pa = format!("{}", (vol * 65536.0) as u32);
                                let result = std::process::Command::new("paplay")
                                    .arg("--volume")
                                    .arg(&vol_pa)
                                    .arg(&path)
                                    .output();
                                if result.is_err() {
                                    let _ = std::process::Command::new("aplay")
                                        .arg(&path)
                                        .output();
                                }
                            });
                            return Ok(());
                        }
                        #[cfg(target_os = "windows")]
                        {
                            std::thread::spawn(move || {
                                let _ = std::process::Command::new("powershell")
                                    .arg("-c")
                                    .arg(format!(
                                        "(New-Object Media.SoundPlayer '{}').PlaySync()",
                                        path.display()
                                    ))
                                    .output();
                            });
                            return Ok(());
                        }
                        #[allow(unreachable_code)]
                        {
                            return Err("Unsupported platform".to_string());
                        }
                    }
                }
            }
        }
    }
    Err(format!("Sound '{}' not found", name))
}

fn iso_now() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs();
    // Simple ISO 8601 from epoch seconds (UTC)
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    // days since epoch → date via civil algorithm
    let days = (secs / 86400) as i64;
    let (y, mo, da) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, da, h, m, s)
}

/// Convert days since Unix epoch to (year, month, day). Civil algorithm from Howard Hinnant.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[tauri::command]
pub fn add_workspace_note(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    content: String,
    mode: Option<String>,
) -> Result<WorkspaceNote, String> {
    let label = window.label().to_string();
    let now = iso_now();
    let note = WorkspaceNote {
        id: uuid::Uuid::new_v4().to_string(),
        content,
        mode,
        created_at: now.clone(),
        updated_at: now,
    };
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.workspace_notes.push(note.clone());
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(note)
}

#[tauri::command]
pub fn update_workspace_note(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    note_id: String,
    content: String,
    mode: Option<String>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let now = iso_now();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(note) = workspace.workspace_notes.iter_mut().find(|n| n.id == note_id) {
                note.content = content;
                note.mode = mode;
                note.updated_at = now;
            }
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn delete_workspace_note(
    window: tauri::Window,
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    note_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        if let Some(workspace) = win.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.workspace_notes.retain(|n| n.id != note_id);
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)
}
