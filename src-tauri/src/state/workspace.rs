use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    #[default]
    Horizontal,
    Vertical,
    Grid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub name: String,
    pub pty_id: Option<String>,
    #[serde(default)]
    pub scrollback: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Window {
    pub id: String,
    pub name: String,
    pub tabs: Vec<Tab>,
    pub active_tab_id: Option<String>,
}

use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowSizes {
    #[serde(default)]
    pub horizontal: HashMap<String, f64>,
    #[serde(default)]
    pub vertical: HashMap<String, f64>,
    #[serde(default)]
    pub grid: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub windows: Vec<Window>,
    pub active_window_id: Option<String>,
    #[serde(default)]
    pub window_sizes: WindowSizes,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppData {
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub layout: Layout,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default)]
    pub preferences: Preferences,
}

fn default_sidebar_width() -> u32 {
    180
}

fn default_font_size() -> u32 {
    13
}

fn default_font_family() -> String {
    "Menlo".to_string()
}

fn default_cursor_style() -> CursorStyle {
    CursorStyle::Block
}

fn default_cursor_blink() -> bool {
    true
}

fn default_auto_save_interval() -> u32 {
    10
}

fn default_scrollback_limit() -> u32 {
    10000
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CursorStyle {
    #[default]
    Block,
    Underline,
    Bar,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: CursorStyle,
    #[serde(default = "default_cursor_blink")]
    pub cursor_blink: bool,
    #[serde(default = "default_auto_save_interval")]
    pub auto_save_interval: u32,
    #[serde(default = "default_scrollback_limit")]
    pub scrollback_limit: u32,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: default_font_family(),
            cursor_style: default_cursor_style(),
            cursor_blink: default_cursor_blink(),
            auto_save_interval: default_auto_save_interval(),
            scrollback_limit: default_scrollback_limit(),
        }
    }
}

impl Tab {
    pub fn new(name: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            pty_id: None,
            scrollback: None,
        }
    }
}

impl Window {
    pub fn new(name: String) -> Self {
        let tab = Tab::new("Terminal".to_string());
        let tab_id = tab.id.clone();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            tabs: vec![tab],
            active_tab_id: Some(tab_id),
        }
    }
}

impl Workspace {
    pub fn new(name: String) -> Self {
        let window = Window::new("Window 1".to_string());
        let window_id = window.id.clone();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            windows: vec![window],
            active_window_id: Some(window_id),
            window_sizes: WindowSizes::default(),
        }
    }
}
