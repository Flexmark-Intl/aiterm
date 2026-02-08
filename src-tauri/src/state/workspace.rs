use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Kept for migration from old state files
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    #[default]
    Horizontal,
    Vertical,
    Grid,
}

// Kept for migration from old state files
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PaneSizes {
    #[serde(default)]
    pub horizontal: HashMap<String, f64>,
    #[serde(default)]
    pub vertical: HashMap<String, f64>,
    #[serde(default)]
    pub grid: HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SplitNode {
    #[serde(rename = "leaf")]
    Leaf { pane_id: String },
    #[serde(rename = "split")]
    Split {
        id: String,
        direction: SplitDirection,
        ratio: f64,
        children: Box<(SplitNode, SplitNode)>,
    },
}

impl SplitNode {
    #[allow(dead_code)]
    pub fn contains_pane(&self, pane_id: &str) -> bool {
        match self {
            SplitNode::Leaf { pane_id: id } => id == pane_id,
            SplitNode::Split { children, .. } => {
                children.0.contains_pane(pane_id) || children.1.contains_pane(pane_id)
            }
        }
    }

    pub fn split_pane(
        &self,
        target_pane_id: &str,
        new_pane_id: &str,
        direction: SplitDirection,
    ) -> SplitNode {
        match self {
            SplitNode::Leaf { pane_id } if pane_id == target_pane_id => SplitNode::Split {
                id: uuid::Uuid::new_v4().to_string(),
                direction,
                ratio: 0.5,
                children: Box::new((
                    SplitNode::Leaf {
                        pane_id: target_pane_id.to_string(),
                    },
                    SplitNode::Leaf {
                        pane_id: new_pane_id.to_string(),
                    },
                )),
            },
            SplitNode::Leaf { .. } => self.clone(),
            SplitNode::Split {
                id,
                direction: dir,
                ratio,
                children,
            } => SplitNode::Split {
                id: id.clone(),
                direction: dir.clone(),
                ratio: *ratio,
                children: Box::new((
                    children.0.split_pane(target_pane_id, new_pane_id, direction.clone()),
                    children.1.split_pane(target_pane_id, new_pane_id, direction),
                )),
            },
        }
    }

    pub fn remove_pane(&self, pane_id: &str) -> Option<SplitNode> {
        match self {
            SplitNode::Leaf { pane_id: id } if id == pane_id => None,
            SplitNode::Leaf { .. } => Some(self.clone()),
            SplitNode::Split {
                id,
                direction,
                ratio,
                children,
            } => {
                let left = children.0.remove_pane(pane_id);
                let right = children.1.remove_pane(pane_id);
                match (left, right) {
                    (None, None) => None,
                    (Some(node), None) | (None, Some(node)) => Some(node),
                    (Some(l), Some(r)) => Some(SplitNode::Split {
                        id: id.clone(),
                        direction: direction.clone(),
                        ratio: *ratio,
                        children: Box::new((l, r)),
                    }),
                }
            }
        }
    }

    pub fn set_ratio(&self, split_id: &str, new_ratio: f64) -> SplitNode {
        match self {
            SplitNode::Leaf { .. } => self.clone(),
            SplitNode::Split {
                id,
                direction,
                ratio,
                children,
            } => {
                let r = if id == split_id { new_ratio } else { *ratio };
                SplitNode::Split {
                    id: id.clone(),
                    direction: direction.clone(),
                    ratio: r,
                    children: Box::new((
                        children.0.set_ratio(split_id, new_ratio),
                        children.1.set_ratio(split_id, new_ratio),
                    )),
                }
            }
        }
    }

    #[allow(dead_code)]
    pub fn all_pane_ids(&self) -> Vec<String> {
        match self {
            SplitNode::Leaf { pane_id } => vec![pane_id.clone()],
            SplitNode::Split { children, .. } => {
                let mut ids = children.0.all_pane_ids();
                ids.extend(children.1.all_pane_ids());
                ids
            }
        }
    }
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
pub struct Pane {
    pub id: String,
    pub name: String,
    pub tabs: Vec<Tab>,
    pub active_tab_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(alias = "windows")]
    pub panes: Vec<Pane>,
    #[serde(alias = "active_window_id")]
    pub active_pane_id: Option<String>,
    #[serde(default)]
    pub split_root: Option<SplitNode>,
    // Old field kept for migration deserialization only
    #[serde(default, alias = "window_sizes", skip_serializing)]
    #[allow(dead_code)]
    pub pane_sizes: Option<PaneSizes>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppData {
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
    // Old field kept for migration deserialization only
    #[serde(default, skip_serializing)]
    pub layout: Option<Layout>,
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

impl Pane {
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
        let pane = Pane::new("Terminal".to_string());
        let pane_id = pane.id.clone();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            panes: vec![pane],
            active_pane_id: Some(pane_id.clone()),
            split_root: Some(SplitNode::Leaf { pane_id }),
            pane_sizes: None,
        }
    }
}
