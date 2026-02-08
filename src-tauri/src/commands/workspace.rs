use std::sync::Arc;
use tauri::State;

use crate::state::{save_state, AppData, AppState, Layout, Preferences, Tab, Window, Workspace};
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
pub fn create_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<Window, String> {
    let window = Window::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.windows.push(window.clone());
            workspace.active_window_id = Some(window.id.clone());
            app_data.clone()
        } else {
            return Err("Workspace not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(window)
}

#[tauri::command]
pub fn delete_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.windows.retain(|w| w.id != window_id);

            if workspace.active_window_id.as_ref() == Some(&window_id) {
                workspace.active_window_id = workspace.windows.first().map(|w| w.id.clone());
            }
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn rename_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    name: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                window.name = name;
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
    window_id: String,
    name: String,
) -> Result<Tab, String> {
    let tab = Tab::new(name);
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                window.tabs.push(tab.clone());
                window.active_tab_id = Some(tab.id.clone());
                app_data.clone()
            } else {
                return Err("Window not found".to_string());
            }
        } else {
            return Err("Window not found".to_string());
        }
    };
    save_state(&data_clone)?;
    Ok(tab)
}

#[tauri::command]
pub fn delete_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                // Fix 11: Select adjacent tab instead of first tab
                if window.active_tab_id.as_ref() == Some(&tab_id) {
                    let old_index = window.tabs.iter().position(|t| t.id == tab_id).unwrap_or(0);
                    window.tabs.retain(|t| t.id != tab_id);
                    window.active_tab_id = if window.tabs.is_empty() {
                        None
                    } else {
                        let new_index = old_index.min(window.tabs.len() - 1);
                        Some(window.tabs[new_index].id.clone())
                    };
                } else {
                    window.tabs.retain(|t| t.id != tab_id);
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
    window_id: String,
    tab_id: String,
    name: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
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
pub fn set_active_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            workspace.active_window_id = Some(window_id);
        }
        app_data.clone()
    };
    save_state(&data_clone)
}

#[tauri::command]
pub fn set_active_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                window.active_tab_id = Some(tab_id);
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
    window_id: String,
    tab_id: String,
    pty_id: String,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
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
pub fn set_window_sizes(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    layout: Layout,
    sizes: HashMap<String, f64>,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            match layout {
                Layout::Horizontal => workspace.window_sizes.horizontal = sizes,
                Layout::Vertical => workspace.window_sizes.vertical = sizes,
                Layout::Grid => workspace.window_sizes.grid = sizes,
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
    window_id: String,
    tab_id: String,
    scrollback: Option<String>,
) -> Result<(), String> {
    let data_clone = {
        let mut app_data = state.app_data.write();
        if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
            if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
                if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
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
