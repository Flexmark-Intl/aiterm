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
    /// True when the user has explicitly renamed this tab (disables OSC title).
    #[serde(default)]
    pub custom_name: bool,
    /// Persisted restore context: local cwd from last session.
    #[serde(default)]
    pub restore_cwd: Option<String>,
    /// Persisted restore context: SSH command from last session.
    #[serde(default)]
    pub restore_ssh_command: Option<String>,
    /// Persisted restore context: remote cwd from last session.
    #[serde(default)]
    pub restore_remote_cwd: Option<String>,
    /// Auto-resume: local cwd to restore to on startup.
    #[serde(default)]
    pub auto_resume_cwd: Option<String>,
    /// Auto-resume: SSH command to replay on startup.
    #[serde(default, alias = "pinned_ssh_command")]
    pub auto_resume_ssh_command: Option<String>,
    /// Auto-resume: remote cwd — used with auto_resume_ssh_command.
    #[serde(default, alias = "pinned_remote_cwd")]
    pub auto_resume_remote_cwd: Option<String>,
    /// Auto-resume: command to run after connect (e.g. "claude").
    #[serde(default, alias = "pinned_command")]
    pub auto_resume_command: Option<String>,
    /// Auto-resume: last command entered by the user (for pre-fill memory).
    /// Only updated when user submits a command, never cleared on disable.
    #[serde(default)]
    pub auto_resume_remembered_command: Option<String>,
    /// User-editable notes scratchpad for this tab.
    #[serde(default)]
    pub notes: Option<String>,
    /// Persisted source/render mode for the notes panel.
    #[serde(default)]
    pub notes_mode: Option<String>,
    /// Whether the notes panel is open for this tab.
    #[serde(default)]
    pub notes_open: bool,
    /// Trigger-extracted variables (persisted across restarts).
    #[serde(default)]
    pub trigger_variables: HashMap<String, String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowData {
    pub id: String,
    pub label: String,
    pub workspaces: Vec<Workspace>,
    pub active_workspace_id: Option<String>,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default)]
    pub sidebar_collapsed: bool,
}

impl WindowData {
    pub fn new(label: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            label,
            workspaces: Vec::new(),
            active_workspace_id: None,
            sidebar_width: default_sidebar_width(),
            sidebar_collapsed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppData {
    #[serde(default)]
    pub windows: Vec<WindowData>,
    // Old fields kept for migration deserialization only
    #[serde(default, skip_serializing)]
    pub workspaces: Option<Vec<Workspace>>,
    #[serde(default, skip_serializing)]
    pub active_workspace_id: Option<String>,
    #[serde(default, skip_serializing)]
    pub layout: Option<Layout>,
    #[serde(default, skip_serializing)]
    pub sidebar_width: Option<u32>,
    #[serde(default, skip_serializing)]
    pub sidebar_collapsed: Option<bool>,
    #[serde(default)]
    pub preferences: Preferences,
}

impl AppData {
    pub fn window(&self, label: &str) -> Option<&WindowData> {
        self.windows.iter().find(|w| w.label == label)
    }

    pub fn window_mut(&mut self, label: &str) -> Option<&mut WindowData> {
        self.windows.iter_mut().find(|w| w.label == label)
    }
}

fn default_sidebar_width() -> u32 {
    180
}

fn default_font_size() -> u32 {
    13
}

fn default_notes_font_size() -> u32 {
    16
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

fn default_prompt_patterns() -> Vec<String> {
    vec![
        "\\u@\\h:\\d\\p".to_string(),
        "\\h \\u[\\d]\\p".to_string(),
        "[\\u@\\h \\d]\\p".to_string(),
    ]
}

fn default_theme() -> String {
    "tokyo-night".to_string()
}

fn default_notify_min_duration() -> u32 {
    5
}

fn default_notification_mode() -> String {
    "auto".to_string()
}

fn default_true() -> bool {
    true
}

fn default_notes_width() -> u32 {
    320
}

fn default_toast_font_size() -> u32 {
    14
}

fn default_toast_width() -> u32 {
    400
}

fn default_toast_duration() -> u32 {
    8
}

fn default_notification_sound() -> String {
    "default".to_string()
}

fn default_notification_volume() -> u32 {
    50
}

/// Deserialize notification_sound: accepts string or bool (migration from old format).
fn deserialize_notification_sound<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrBool {
        Str(String),
        Bool(bool),
    }
    match StringOrBool::deserialize(deserializer)? {
        StringOrBool::Str(s) => Ok(s),
        StringOrBool::Bool(true) => Ok("default".to_string()),
        StringOrBool::Bool(false) => Ok("none".to_string()),
    }
}

fn default_trigger_cooldown() -> u32 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerActionType {
    #[default]
    Notify,
    #[serde(rename = "send_command")]
    SendCommand,
    #[serde(rename = "set_tab_state")]
    SetTabState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerActionEntry {
    pub action_type: TriggerActionType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariableMapping {
    pub name: String,
    pub group: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trigger {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub pattern: String,
    /// New: array of actions to execute on match
    #[serde(default)]
    pub actions: Vec<TriggerActionEntry>,
    pub enabled: bool,
    #[serde(default)]
    pub workspaces: Vec<String>,
    #[serde(default = "default_trigger_cooldown")]
    pub cooldown: u32,
    /// Variable extraction from capture groups (ordered)
    #[serde(default)]
    pub variables: Vec<VariableMapping>,
    /// When true, the pattern is plain text matched against TUI-normalized output
    /// (spaces in the pattern match any gap caused by cursor positioning).
    #[serde(default)]
    pub plain_text: bool,
    /// Links this trigger to an app-provided default template (e.g. "claude-resume").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_id: Option<String>,
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
    #[serde(default = "default_prompt_patterns")]
    pub prompt_patterns: Vec<String>,
    #[serde(default = "default_true")]
    pub clone_cwd: bool,
    #[serde(default = "default_true")]
    pub clone_scrollback: bool,
    #[serde(default = "default_true")]
    pub clone_ssh: bool,
    #[serde(default = "default_true")]
    pub clone_history: bool,
    #[serde(default = "default_true")]
    pub clone_notes: bool,
    #[serde(default = "default_true")]
    pub clone_auto_resume: bool,
    #[serde(default = "default_true")]
    pub clone_variables: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub shell_title_integration: bool,
    #[serde(default)]
    pub shell_integration: bool,
    #[serde(default)]
    pub custom_themes: Vec<serde_json::Value>,
    #[serde(default)]
    pub restore_session: bool,
    /// Legacy field kept for migration deserialization only.
    #[serde(default, skip_serializing)]
    #[allow(dead_code)]
    pub notify_on_completion: bool,
    #[serde(default = "default_notification_mode")]
    pub notification_mode: String,
    #[serde(default = "default_notify_min_duration")]
    pub notify_min_duration: u32,
    #[serde(default = "default_notes_font_size")]
    pub notes_font_size: u32,
    #[serde(default = "default_font_family")]
    pub notes_font_family: String,
    #[serde(default = "default_notes_width")]
    pub notes_width: u32,
    #[serde(default = "default_true")]
    pub notes_word_wrap: bool,
    #[serde(default = "default_toast_font_size")]
    pub toast_font_size: u32,
    #[serde(default = "default_toast_width")]
    pub toast_width: u32,
    #[serde(default = "default_toast_duration")]
    pub toast_duration: u32,
    #[serde(default = "default_notification_sound")]
    #[serde(deserialize_with = "deserialize_notification_sound")]
    pub notification_sound: String,
    #[serde(default = "default_notification_volume")]
    pub notification_volume: u32,
    #[serde(default)]
    pub triggers: Vec<Trigger>,
    /// Default trigger IDs the user has intentionally deleted (prevents re-seeding).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_default_triggers: Vec<String>,
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
            prompt_patterns: default_prompt_patterns(),
            clone_cwd: true,
            clone_scrollback: true,
            clone_ssh: true,
            clone_history: true,
            clone_notes: true,
            clone_auto_resume: true,
            clone_variables: true,
            theme: default_theme(),
            shell_title_integration: false,
            shell_integration: false,
            custom_themes: Vec::new(),
            restore_session: false,
            notify_on_completion: false,
            notification_mode: default_notification_mode(),
            notify_min_duration: default_notify_min_duration(),
            notes_font_size: default_notes_font_size(),
            notes_font_family: default_font_family(),
            notes_width: default_notes_width(),
            notes_word_wrap: true,
            toast_font_size: default_toast_font_size(),
            toast_width: default_toast_width(),
            toast_duration: default_toast_duration(),
            notification_sound: default_notification_sound(),
            notification_volume: default_notification_volume(),
            triggers: Vec::new(),
            hidden_default_triggers: Vec::new(),
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
            custom_name: false,
            restore_cwd: None,
            restore_ssh_command: None,
            restore_remote_cwd: None,
            auto_resume_cwd: None,
            auto_resume_ssh_command: None,
            auto_resume_remote_cwd: None,
            auto_resume_command: None,
            auto_resume_remembered_command: None,
            notes: None,
            notes_mode: None,
            notes_open: false,
            trigger_variables: HashMap::new(),
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
