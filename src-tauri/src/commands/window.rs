use std::sync::Arc;
use tauri::{Manager, State};
use tauri::webview::WebviewWindowBuilder;

use crate::state::{save_state, AppState, Pane, Tab, WindowData, Workspace};
use crate::state::workspace::{SplitNode};

#[tauri::command]
pub fn get_window_data(window: tauri::Window, state: State<'_, Arc<AppState>>) -> Result<WindowData, String> {
    let label = window.label().to_string();
    let app_data = state.app_data.read();
    app_data.window(&label)
        .cloned()
        .ok_or_else(|| format!("No window data for label '{}'", label))
}

#[tauri::command]
pub fn create_window(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> Result<String, String> {
    let label = format!("window-{}", uuid::Uuid::new_v4());

    // Create window data with a default workspace
    let mut win_data = WindowData::new(label.clone());
    let ws = Workspace::new("Default".to_string());
    win_data.active_workspace_id = Some(ws.id.clone());
    win_data.workspaces.push(ws);

    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.windows.push(win_data);
        app_data.clone()
    };
    save_state(&data_clone)?;

    // Spawn window creation asynchronously so the calling window isn't blocked.
    // On Windows, WebView2 init is heavy and blocks the main thread event loop.
    let app_clone = app.clone();
    let label_clone = label.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = build_window_sync(&app_clone, &label_clone) {
            log::error!("Failed to create window '{}': {}", label_clone, e);
        }
    });

    Ok(label)
}

/// Context for each tab when duplicating a window.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct TabContext {
    pub tab_id: String,
    pub scrollback: Option<String>,
    pub cwd: Option<String>,
    pub ssh_command: Option<String>,
    pub remote_cwd: Option<String>,
}

#[tauri::command]
pub fn duplicate_window(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    tab_contexts: Vec<TabContext>,
) -> Result<String, String> {
    let source_label = window.label().to_string();
    let new_label = format!("window-{}", uuid::Uuid::new_v4());

    let data_clone = {
        let mut app_data = state.app_data.write();
        let source = app_data.window(&source_label)
            .ok_or_else(|| format!("Source window '{}' not found", source_label))?
            .clone();

        let mut new_win = WindowData::new(new_label.clone());
        new_win.sidebar_width = source.sidebar_width;
        new_win.sidebar_collapsed = source.sidebar_collapsed;

        for ws in &source.workspaces {
            let cloned = clone_workspace_with_new_ids(ws, &tab_contexts);
            new_win.workspaces.push(cloned);
        }

        // Set active workspace to the cloned version of the source's active
        if let Some(ref active_id) = source.active_workspace_id {
            // Find the index of the active workspace in source
            if let Some(idx) = source.workspaces.iter().position(|w| w.id == *active_id) {
                if let Some(cloned_ws) = new_win.workspaces.get(idx) {
                    new_win.active_workspace_id = Some(cloned_ws.id.clone());
                }
            }
        }

        app_data.windows.push(new_win);
        app_data.clone()
    };
    save_state(&data_clone)?;

    // Spawn window creation asynchronously (see create_window comment)
    let app_clone = app.clone();
    let label_clone = new_label.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = build_window_sync(&app_clone, &label_clone) {
            log::error!("Failed to create window '{}': {}", label_clone, e);
        }
    });

    Ok(new_label)
}

#[tauri::command]
pub fn close_window(window: tauri::Window, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        app_data.windows.retain(|w| w.label != label);
        app_data.clone()
    };
    save_state(&data_clone)?;
    Ok(())
}

#[tauri::command]
pub fn reset_window(window: tauri::Window, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let label = window.label().to_string();
    let data_clone = {
        let mut app_data = state.app_data.write();
        let win = app_data.window_mut(&label).ok_or("Window not found")?;
        win.workspaces.clear();
        win.active_workspace_id = None;
        app_data.clone()
    };
    save_state(&data_clone)?;
    Ok(())
}

#[tauri::command]
pub fn get_window_count(app: tauri::AppHandle) -> usize {
    app.webview_windows().iter()
        .filter(|(label, _)| label.as_str() != "preferences")
        .count()
}

#[tauri::command]
pub fn open_preferences_window(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    // If already open, focus it
    if let Some(win) = app.get_webview_window("preferences") {
        let _ = win.set_focus();
        return Ok(());
    }

    let url = if cfg!(debug_assertions) {
        tauri::WebviewUrl::External("http://localhost:1420/preferences".parse().unwrap())
    } else {
        tauri::WebviewUrl::App("preferences".into())
    };

    let title = if cfg!(debug_assertions) { "Preferences (Dev)" } else { "Preferences" };

    let pref_w: f64 = 900.0;
    let pref_h: f64 = 650.0;

    let mut builder = WebviewWindowBuilder::new(&app, "preferences", url)
        .title(title)
        .inner_size(pref_w, pref_h)
        .min_inner_size(500.0, 400.0)
        .resizable(true)
        .fullscreen(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder.hidden_title(true);
    }

    // Center on the calling window
    if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let scale = window.scale_factor().unwrap_or(1.0);
        let win_x = pos.x as f64 / scale;
        let win_y = pos.y as f64 / scale;
        let win_w = size.width as f64 / scale;
        let win_h = size.height as f64 / scale;
        let x = win_x + (win_w - pref_w) / 2.0;
        let y = win_y + (win_h - pref_h) / 2.0;
        builder = builder.position(x, y);
    }

    builder.build()
        .map_err(|e| format!("Failed to create preferences window: {}", e))?;

    Ok(())
}

fn build_window_sync(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let url = if cfg!(debug_assertions) {
        tauri::WebviewUrl::External("http://localhost:1420".parse().unwrap())
    } else {
        tauri::WebviewUrl::App("index.html".into())
    };

    let title = if cfg!(debug_assertions) { "aiTerm (Dev)" } else { "aiTerm" };

    let mut builder = WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .resizable(true)
        .fullscreen(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    builder.build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(())
}

fn clone_workspace_with_new_ids(ws: &Workspace, tab_contexts: &[TabContext]) -> Workspace {
    let (cloned, _) = clone_workspace_with_id_mapping(ws, tab_contexts);
    cloned
}

/// Clone a workspace with new UUIDs for all entities.
/// Returns the cloned workspace and a mapping of old_tab_id -> new_tab_id.
pub(crate) fn clone_workspace_with_id_mapping(
    ws: &Workspace,
    tab_contexts: &[TabContext],
) -> (Workspace, std::collections::HashMap<String, String>) {
    let mut id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut tab_id_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let new_ws_id = uuid::Uuid::new_v4().to_string();
    id_map.insert(ws.id.clone(), new_ws_id.clone());

    let new_panes: Vec<Pane> = ws.panes.iter().map(|pane| {
        let new_pane_id = uuid::Uuid::new_v4().to_string();
        id_map.insert(pane.id.clone(), new_pane_id.clone());

        let new_tabs: Vec<Tab> = pane.tabs.iter().map(|tab| {
            let new_tab_id = uuid::Uuid::new_v4().to_string();
            id_map.insert(tab.id.clone(), new_tab_id.clone());
            tab_id_map.insert(tab.id.clone(), new_tab_id.clone());

            // Find matching context from the source window
            let ctx = tab_contexts.iter().find(|c| c.tab_id == tab.id);

            Tab {
                id: new_tab_id,
                name: tab.name.clone(),
                pty_id: None, // New window will spawn fresh PTYs
                scrollback: ctx.and_then(|c| c.scrollback.clone()),
                custom_name: tab.custom_name,
                restore_cwd: ctx.and_then(|c| c.cwd.clone()),
                restore_ssh_command: ctx.and_then(|c| c.ssh_command.clone()),
                restore_remote_cwd: ctx.and_then(|c| c.remote_cwd.clone()),
                auto_resume_cwd: tab.auto_resume_cwd.clone(),
                auto_resume_ssh_command: tab.auto_resume_ssh_command.clone(),
                auto_resume_remote_cwd: tab.auto_resume_remote_cwd.clone(),
                auto_resume_command: tab.auto_resume_command.clone(),
                auto_resume_remembered_command: tab.auto_resume_remembered_command.clone(),
                notes: tab.notes.clone(),
                notes_mode: tab.notes_mode.clone(),
                notes_open: tab.notes_open,
                trigger_variables: tab.trigger_variables.clone(),
                tab_type: tab.tab_type.clone(),
                editor_file: tab.editor_file.clone(),
                diff_context: tab.diff_context.clone(),
            }
        }).collect();

        let new_active_tab = pane.active_tab_id.as_ref()
            .and_then(|id| id_map.get(id))
            .cloned();

        Pane {
            id: new_pane_id,
            name: pane.name.clone(),
            tabs: new_tabs,
            active_tab_id: new_active_tab,
        }
    }).collect();

    let new_active_pane = ws.active_pane_id.as_ref()
        .and_then(|id| id_map.get(id))
        .cloned();

    let new_split_root = ws.split_root.as_ref().map(|root| clone_split_node(root, &id_map));

    let cloned = Workspace {
        id: new_ws_id,
        name: ws.name.clone(),
        panes: new_panes,
        active_pane_id: new_active_pane,
        split_root: new_split_root,
        workspace_notes: ws.workspace_notes.clone(),
        pane_sizes: None,
    };

    (cloned, tab_id_map)
}

fn clone_split_node(node: &SplitNode, id_map: &std::collections::HashMap<String, String>) -> SplitNode {
    match node {
        SplitNode::Leaf { pane_id } => SplitNode::Leaf {
            pane_id: id_map.get(pane_id).cloned().unwrap_or_else(|| pane_id.clone()),
        },
        SplitNode::Split { direction, ratio, children, .. } => SplitNode::Split {
            id: uuid::Uuid::new_v4().to_string(),
            direction: direction.clone(),
            ratio: *ratio,
            children: Box::new((
                clone_split_node(&children.0, id_map),
                clone_split_node(&children.1, id_map),
            )),
        },
    }
}
