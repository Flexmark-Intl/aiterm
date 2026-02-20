pub mod app_state;
pub mod persistence;
pub mod workspace;

pub use app_state::{AppState, PtyCommand, PtyHandle};
pub use persistence::{load_state, save_state};
pub use workspace::{AppData, DiffContext, EditorFileInfo, Pane, Preferences, Tab, WindowData, Workspace};
