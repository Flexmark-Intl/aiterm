use std::sync::Arc;
use tauri::State;

use crate::state::{save_state, AppData, AppState, Layout, Preferences, Tab, Window, WindowSizes, Workspace};
use std::collections::HashMap;

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[JS] {}", message);
}

#[tauri::command]
pub fn sync_state(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    eprintln!("[sync_state] Forcing state sync to disk");
    let app_data = state.app_data.read();
    save_state(&app_data)?;
    eprintln!("[sync_state] State saved successfully");
    Ok(())
}

#[tauri::command]
pub fn get_app_data(state: State<'_, Arc<AppState>>) -> AppData {
    state.app_data.read().clone()
}

#[tauri::command]
pub fn save_app_data(state: State<'_, Arc<AppState>>, data: AppData) -> Result<(), String> {
    *state.app_data.write() = data.clone();
    save_state(&data)
}

#[tauri::command]
pub fn create_workspace(state: State<'_, Arc<AppState>>, name: String) -> Result<Workspace, String> {
    let workspace = Workspace::new(name);
    {
        let mut app_data = state.app_data.write();
        app_data.workspaces.push(workspace.clone());
        app_data.active_workspace_id = Some(workspace.id.clone());
        save_state(&app_data)?;
    }
    Ok(workspace)
}

#[tauri::command]
pub fn delete_workspace(state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let mut app_data = state.app_data.write();
    app_data.workspaces.retain(|w| w.id != workspace_id);

    if app_data.active_workspace_id.as_ref() == Some(&workspace_id) {
        app_data.active_workspace_id = app_data.workspaces.first().map(|w| w.id.clone());
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn rename_workspace(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.name = name;
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn create_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    name: String,
) -> Result<Window, String> {
    let window = Window::new(name);
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.windows.push(window.clone());
        workspace.active_window_id = Some(window.id.clone());
        save_state(&app_data)?;
        return Ok(window);
    }

    Err("Workspace not found".to_string())
}

#[tauri::command]
pub fn delete_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.windows.retain(|w| w.id != window_id);

        if workspace.active_window_id.as_ref() == Some(&window_id) {
            workspace.active_window_id = workspace.windows.first().map(|w| w.id.clone());
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn rename_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    name: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            window.name = name;
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn create_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    name: String,
) -> Result<Tab, String> {
    let tab = Tab::new(name);
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            window.tabs.push(tab.clone());
            window.active_tab_id = Some(tab.id.clone());
            save_state(&app_data)?;
            return Ok(tab);
        }
    }

    Err("Window not found".to_string())
}

#[tauri::command]
pub fn delete_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            window.tabs.retain(|t| t.id != tab_id);

            if window.active_tab_id.as_ref() == Some(&tab_id) {
                window.active_tab_id = window.tabs.first().map(|t| t.id.clone());
            }
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn rename_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
    name: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.name = name;
            }
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn set_active_workspace(state: State<'_, Arc<AppState>>, workspace_id: String) -> Result<(), String> {
    let mut app_data = state.app_data.write();
    app_data.active_workspace_id = Some(workspace_id);
    save_state(&app_data)
}

#[tauri::command]
pub fn set_active_window(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        workspace.active_window_id = Some(window_id);
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn set_active_tab(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            window.active_tab_id = Some(tab_id);
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn set_tab_pty_id(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
    pty_id: String,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.pty_id = Some(pty_id);
            }
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn set_layout(state: State<'_, Arc<AppState>>, layout: Layout) -> Result<(), String> {
    let mut app_data = state.app_data.write();
    app_data.layout = layout;
    save_state(&app_data)
}

#[tauri::command]
pub fn set_sidebar_width(state: State<'_, Arc<AppState>>, width: u32) -> Result<(), String> {
    let mut app_data = state.app_data.write();
    app_data.sidebar_width = width;
    save_state(&app_data)
}

#[tauri::command]
pub fn set_window_sizes(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    layout: Layout,
    sizes: HashMap<String, f64>,
) -> Result<(), String> {
    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        match layout {
            Layout::Horizontal => workspace.window_sizes.horizontal = sizes,
            Layout::Vertical => workspace.window_sizes.vertical = sizes,
            Layout::Grid => workspace.window_sizes.grid = sizes,
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn set_tab_scrollback(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    window_id: String,
    tab_id: String,
    scrollback: Option<String>,
) -> Result<(), String> {
    let sb_len = scrollback.as_ref().map(|s| s.len()).unwrap_or(0);
    eprintln!("set_tab_scrollback: tab_id={}, scrollback_len={}", &tab_id[..8.min(tab_id.len())], sb_len);

    let mut app_data = state.app_data.write();

    if let Some(workspace) = app_data.workspaces.iter_mut().find(|w| w.id == workspace_id) {
        if let Some(window) = workspace.windows.iter_mut().find(|w| w.id == window_id) {
            if let Some(tab) = window.tabs.iter_mut().find(|t| t.id == tab_id) {
                tab.scrollback = scrollback;
            }
        }
    }

    save_state(&app_data)
}

#[tauri::command]
pub fn get_preferences(state: State<'_, Arc<AppState>>) -> Preferences {
    state.app_data.read().preferences.clone()
}

#[tauri::command]
pub fn set_preferences(state: State<'_, Arc<AppState>>, preferences: Preferences) -> Result<(), String> {
    let mut app_data = state.app_data.write();
    app_data.preferences = preferences;
    save_state(&app_data)
}
