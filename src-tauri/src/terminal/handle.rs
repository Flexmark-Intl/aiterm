use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte;

use super::event_proxy::AitermEventProxy;
use super::osc::OscInterceptor;

/// Dimensions implementation for creating/resizing Term instances.
pub struct TermDimensions {
    pub cols: usize,
    pub rows: usize,
}

impl Dimensions for TermDimensions {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

/// Wraps one alacritty_terminal instance with its associated state.
pub struct TerminalHandle {
    pub term: Term<AitermEventProxy>,
    pub pty_id: String,
    pub tab_id: String,
    pub osc_interceptor: OscInterceptor,
    /// VTE processor for feeding bytes to the terminal.
    pub processor: vte::ansi::Processor,
}

/// Create a new alacritty_terminal instance.
pub fn create_terminal(
    pty_id: &str,
    tab_id: &str,
    cols: u16,
    rows: u16,
    scrollback_limit: usize,
    event_proxy: AitermEventProxy,
) -> TerminalHandle {
    let config = Config {
        scrolling_history: scrollback_limit,
        ..Config::default()
    };

    let dims = TermDimensions {
        cols: cols as usize,
        rows: rows as usize,
    };

    let term = Term::new(config, &dims, event_proxy);
    let processor = vte::ansi::Processor::default();
    let osc_interceptor = OscInterceptor::new();

    TerminalHandle {
        term,
        pty_id: pty_id.to_string(),
        tab_id: tab_id.to_string(),
        osc_interceptor,
        processor,
    }
}
