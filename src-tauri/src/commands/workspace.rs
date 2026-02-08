use std::sync::Arc;
use tauri::State;

use crate::state::{save_state, AppData, AppState, Layout, Pane, Preferences, Tab, Workspace};
use std::collections::HashMap;

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[JS] {}", message);
}

#[tauri::command]
pub fn sync_state(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    eprintln!("[sync_state] Forcing state sync to disk");
    let data_clone = state.app_data.read().clone();
    save_state(&data_clone)?;
    eprintln!("[sync_state] State saved successfully");
    Ok(())
}

#[tauri::command]
pub fn get_app_data(state: State<'_, Arc<AppState>>) -> AppData {
    state.app_data.read().clone()
}

#[tauri::command]
pub fn create_workspace(state: State<'_, Arc<AppState>>, name: String) -> Result<Workspace, String> {
    let workspace = Workspace::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.workspaces.push(workspace.clone());
        app_data.active_workspace_id = Some(workspace.id.clone());
        app_data.clone()
    };
    save_state(&data_clone)?;
    Ok(workspace)
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.workspaces.retain(|w| w.id != workspace_id);

        if app_data.active_workspace_id.as_ref() == Some(&workspace_id) {
            app_data.active_workspace_id = app_data.workspaces.first().map(|w| w.id.clone());
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn rename_workspace(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.name = name;
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn create_pane(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<Pane, String> {
    let pane = Pane::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.panes.push(pane.clone());
            workspace.active_pane_id = Some(pane.id.clone());
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(pane)
}

#[tauri::command]
pub fn delete_pane(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
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
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    name: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
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
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    name: String,
) -> Result<Tab, String> {
    let tab = Tab::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
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
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                if pane.active_tab_id.as_ref() == Some(&tab_id) {
                    let old_index = pane.tabs.iter().position(|t| t.id == tab_id).unwrap_or(0);
                    pane.tabs.retain(|t| t.id != tab_id);
                    pane.active_tab_id = if pane.tabs.is_empty() {
                        None
                    } else {
                        let new_index = old_index.min(pane.tabs.len() - 1);
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
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    name: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                    tab.name = name;
                }
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_active_workspace(state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.active_workspace_id = Some(workspace_id);
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_active_pane(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.active_pane_id = Some(pane_id);
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_active_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                pane.active_tab_id = Some(tab_id);
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_tab_pty_id(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    pty_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                    tab.pty_id = Some(pty_id);
                }
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_layout(state: State<'_, Arc<AppState>>, layout: Layout) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.layout = layout;
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_sidebar_width(state: State<'_, Arc<AppState>>, width: u32) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.sidebar_width = width;
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_pane_sizes(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    layout: Layout,
    sizes: HashMap<String, f64>,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            match layout {
                Layout::Horizontal => workspace.pane_sizes.horizontal = sizes,
                Layout::Vertical => workspace.pane_sizes.vertical = sizes,
                Layout::Grid => workspace.pane_sizes.grid = sizes,
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_tab_scrollback(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    pane_id: String,
    tab_id: String,
    scrollback: Option<String>,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(pane) = workspace.panes.iter_mut().find(|p| p.id == pane_id) {
                if let Some(tab) = pane.tabs.iter_mut().find(|t| t.id == tab_id) {
                    tab.scrollback = scrollback;
                }
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
pub fn set_preferences(state: State<'_, Arc<AppState>>, preferences: Preferences) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.preferences = preferences;
        app_data.clone()
    };
    save_state(&data_clone)
}
