use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{Term, TermMode};
use alacritty_terminal::vte::ansi::{Color, NamedColor};

/// A rendered viewport frame sent to the frontend.
#[derive(serde::Serialize, Clone)]
pub struct TerminalFrame {
    /// Full viewport as ANSI escape sequences (raw UTF-8 bytes).
    /// Sent as bytes to avoid WebView string encoding issues with non-ASCII characters.
    pub ansi: Vec<u8>,
    pub cursor_x: usize,
    pub cursor_y: usize,
    pub cursor_visible: bool,
    /// 0 = at bottom (live), >0 = scrolled up into history
    pub display_offset: usize,
    /// Total lines including scrollback history
    pub total_lines: usize,
    /// Whether alternate screen buffer is active
    pub alternate_screen: bool,
}

/// Extract the visible viewport from a Term and produce an ANSI string.
/// The frontend xterm.js (scrollback=0) receives this and renders it.
pub fn render_viewport<T: EventListener>(term: &Term<T>) -> TerminalFrame {
    let content = term.renderable_content();
    let num_cols = term.columns();
    let num_lines = term.screen_lines();

    let cursor = content.cursor;
    let cursor_visible = content.mode.contains(TermMode::SHOW_CURSOR);
    let display_offset = content.display_offset;
    let alternate_screen = content.mode.contains(TermMode::ALT_SCREEN);
    let total_lines = term.grid().total_lines();

    // Pre-allocate output — rough estimate: 10 bytes per cell for ANSI + content
    let mut out = String::with_capacity(num_cols * num_lines * 10);

    // Clear screen and home cursor
    out.push_str("\x1b[H\x1b[2J");

    let mut prev_fg = Color::Named(NamedColor::Foreground);
    let mut prev_bg = Color::Named(NamedColor::Background);
    let mut prev_flags = Flags::empty();
    let mut current_line: i32 = i32::MIN;
    // Track active OSC 8 hyperlink URI so we emit open/close at boundaries
    let mut active_hyperlink_uri: Option<String> = None;

    for indexed in content.display_iter {
        let point = indexed.point;
        let cell = indexed.cell;

        // Track line changes for newlines
        if point.line.0 != current_line {
            if current_line != i32::MIN {
                // Close hyperlink before line break
                if active_hyperlink_uri.is_some() {
                    out.push_str("\x1b]8;;\x1b\\");
                    active_hyperlink_uri = None;
                }
                // Reset attributes at end of line and emit newline
                out.push_str("\x1b[0m\r\n");
                prev_fg = Color::Named(NamedColor::Foreground);
                prev_bg = Color::Named(NamedColor::Background);
                prev_flags = Flags::empty();
            }
            current_line = point.line.0;
        }

        // Skip wide char spacers (the trailing cell of a double-width char)
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER)
            || cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER)
        {
            continue;
        }

        // Handle OSC 8 hyperlink transitions
        let cell_uri = cell.hyperlink().map(|h| h.uri().to_string());
        match (&active_hyperlink_uri, &cell_uri) {
            (None, Some(uri)) => {
                // Open new hyperlink
                out.push_str(&format!("\x1b]8;;{}\x1b\\", uri));
                active_hyperlink_uri = Some(uri.clone());
            }
            (Some(prev), Some(uri)) if prev != uri => {
                // Close old, open new
                out.push_str("\x1b]8;;\x1b\\");
                out.push_str(&format!("\x1b]8;;{}\x1b\\", uri));
                active_hyperlink_uri = Some(uri.clone());
            }
            (Some(_), None) => {
                // Close hyperlink
                out.push_str("\x1b]8;;\x1b\\");
                active_hyperlink_uri = None;
            }
            _ => {} // Same link or both None — no change
        }

        // Emit SGR changes if attributes differ
        let needs_sgr = cell.fg != prev_fg || cell.bg != prev_bg || cell.flags != prev_flags;
        if needs_sgr {
            emit_sgr(&mut out, cell.fg, cell.bg, cell.flags);
            prev_fg = cell.fg;
            prev_bg = cell.bg;
            prev_flags = cell.flags;
        }

        // Output the character
        let c = cell.c;
        if c == '\0' || c == ' ' {
            out.push(' ');
        } else {
            out.push(c);
        }

        // Append zero-width characters
        if let Some(zerowidth) = cell.zerowidth() {
            for &zw in zerowidth {
                out.push(zw);
            }
        }
    }

    // Close any open hyperlink
    if active_hyperlink_uri.is_some() {
        out.push_str("\x1b]8;;\x1b\\");
    }

    // Reset at end
    out.push_str("\x1b[0m");

    // Position cursor (hidden when scrolled into history)
    if cursor_visible && display_offset == 0 {
        out.push_str("\x1b[?25h"); // Re-show cursor (may have been hidden by scrollback)
        let cursor_viewport_line = cursor.point.line.0;
        if cursor_viewport_line >= 0 {
            let cy = cursor_viewport_line as usize + 1; // 1-based
            let cx = cursor.point.column.0 + 1; // 1-based
            out.push_str(&format!("\x1b[{};{}H", cy, cx));
        }
    } else if display_offset > 0 {
        out.push_str("\x1b[?25l"); // Hide cursor when browsing scrollback
    }

    TerminalFrame {
        ansi: out.into_bytes(),
        cursor_x: cursor.point.column.0,
        cursor_y: {
            let line = cursor.point.line.0 + display_offset as i32;
            if line >= 0 { line as usize } else { 0 }
        },
        cursor_visible,
        display_offset,
        total_lines,
        alternate_screen,
    }
}

/// Emit SGR escape sequence for the given attributes.
fn emit_sgr(
    out: &mut String,
    fg: Color,
    bg: Color,
    flags: Flags,
) {
    out.push_str("\x1b[0"); // Reset first, then set what's needed

    // Flags
    if flags.contains(Flags::BOLD) {
        out.push_str(";1");
    }
    if flags.contains(Flags::DIM) {
        out.push_str(";2");
    }
    if flags.contains(Flags::ITALIC) {
        out.push_str(";3");
    }
    if flags.contains(Flags::UNDERLINE) {
        out.push_str(";4");
    }
    if flags.contains(Flags::DOUBLE_UNDERLINE) {
        out.push_str(";21");
    }
    if flags.contains(Flags::UNDERCURL) {
        out.push_str(";4:3");
    }
    if flags.contains(Flags::DOTTED_UNDERLINE) {
        out.push_str(";4:4");
    }
    if flags.contains(Flags::DASHED_UNDERLINE) {
        out.push_str(";4:5");
    }
    if flags.contains(Flags::INVERSE) {
        out.push_str(";7");
    }
    if flags.contains(Flags::HIDDEN) {
        out.push_str(";8");
    }
    if flags.contains(Flags::STRIKEOUT) {
        out.push_str(";9");
    }

    // Foreground color
    emit_color_sgr(out, fg, true);

    // Background color
    emit_color_sgr(out, bg, false);

    out.push('m');
}

/// Emit the SGR parameters for a single color (fg or bg).
///
/// IMPORTANT: We emit standard ANSI SGR codes for Named and Indexed colors
/// (not resolved RGB values) so that xterm.js resolves them through its theme.
/// If we looked up alacritty_terminal's default palette and emitted RGB, the
/// colors would not match the user's xterm.js theme (e.g. Tokyo Night).
fn emit_color_sgr(
    out: &mut String,
    color: Color,
    is_fg: bool,
) {
    match color {
        Color::Named(name) => {
            let code = match name {
                NamedColor::Black => 30,
                NamedColor::Red => 31,
                NamedColor::Green => 32,
                NamedColor::Yellow => 33,
                NamedColor::Blue => 34,
                NamedColor::Magenta => 35,
                NamedColor::Cyan => 36,
                NamedColor::White => 37,
                NamedColor::BrightBlack => 90,
                NamedColor::BrightRed => 91,
                NamedColor::BrightGreen => 92,
                NamedColor::BrightYellow => 93,
                NamedColor::BrightBlue => 94,
                NamedColor::BrightMagenta => 95,
                NamedColor::BrightCyan => 96,
                NamedColor::BrightWhite => 97,
                // Default foreground/background — skip (already in reset)
                NamedColor::Foreground | NamedColor::BrightForeground if is_fg => return,
                NamedColor::Background if !is_fg => return,
                // Dim colors — map to their base + dim flag (already handled via Flags::DIM)
                NamedColor::DimBlack => 30,
                NamedColor::DimRed => 31,
                NamedColor::DimGreen => 32,
                NamedColor::DimYellow => 33,
                NamedColor::DimBlue => 34,
                NamedColor::DimMagenta => 35,
                NamedColor::DimCyan => 36,
                NamedColor::DimWhite => 37,
                NamedColor::DimForeground => return,
                NamedColor::Cursor => return,
                _ => return,
            };
            let code = if !is_fg { code + 10 } else { code };
            out.push_str(&format!(";{}", code));
        }
        Color::Spec(rgb) => {
            // True color — must emit RGB directly
            if is_fg {
                out.push_str(&format!(";38;2;{};{};{}", rgb.r, rgb.g, rgb.b));
            } else {
                out.push_str(&format!(";48;2;{};{};{}", rgb.r, rgb.g, rgb.b));
            }
        }
        Color::Indexed(idx) => {
            if idx < 8 {
                // Standard ANSI colors — emit as SGR codes for theme resolution
                let base = if is_fg { 30 } else { 40 };
                out.push_str(&format!(";{}", base + idx));
            } else if idx < 16 {
                // Bright ANSI colors
                let base = if is_fg { 90 } else { 100 };
                out.push_str(&format!(";{}", base + idx - 8));
            } else {
                // 256-color palette (16-255) — emit as indexed for xterm.js
                if is_fg {
                    out.push_str(&format!(";38;5;{}", idx));
                } else {
                    out.push_str(&format!(";48;5;{}", idx));
                }
            }
        }
    }
}
