use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::Column;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::Term;
use alacritty_terminal::vte;
use alacritty_terminal::vte::ansi::{Color, NamedColor};

/// Serialize the entire terminal buffer (visible + scrollback) as an ANSI string.
/// Compatible with both old xterm.js SerializeAddon format and our own restore.
pub fn serialize_buffer<T: EventListener>(term: &Term<T>) -> String {
    let num_cols = term.columns();
    let grid = term.grid();
    let topmost = grid.topmost_line();
    let bottommost = grid.bottommost_line();
    let total_rows = (bottommost.0 - topmost.0 + 1) as usize;

    // Pre-allocate
    let mut out = String::with_capacity(num_cols * total_rows * 4);

    let mut prev_fg = Color::Named(NamedColor::Foreground);
    let mut prev_bg = Color::Named(NamedColor::Background);
    let mut prev_flags = Flags::empty();
    let mut active_hyperlink_uri: Option<String> = None;
    let mut first_line = true;

    let mut line = topmost;
    while line <= bottommost {
        if !first_line {
            // Close hyperlink before line break
            if active_hyperlink_uri.is_some() {
                out.push_str("\x1b]8;;\x1b\\");
                active_hyperlink_uri = None;
            }
            out.push_str("\r\n");
        }
        first_line = false;

        // Find the last non-empty column on this line to avoid trailing spaces
        let row = &grid[line];
        let mut last_col = 0usize;
        for col in (0..num_cols).rev() {
            let cell = &row[Column(col)];
            if cell.c != ' ' || cell.c == '\0' || cell.fg != Color::Named(NamedColor::Foreground)
                || cell.bg != Color::Named(NamedColor::Background)
                || !cell.flags.is_empty()
                || cell.hyperlink().is_some()
            {
                last_col = col;
                break;
            }
        }

        for col in 0..=last_col {
            let cell = &row[Column(col)];

            // Skip wide char spacers
            if cell.flags.contains(Flags::WIDE_CHAR_SPACER)
                || cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER)
            {
                continue;
            }

            // Handle OSC 8 hyperlink transitions
            let cell_uri = cell.hyperlink().map(|h| h.uri().to_string());
            match (&active_hyperlink_uri, &cell_uri) {
                (None, Some(uri)) => {
                    out.push_str(&format!("\x1b]8;;{}\x1b\\", uri));
                    active_hyperlink_uri = Some(uri.clone());
                }
                (Some(prev), Some(uri)) if prev != uri => {
                    out.push_str("\x1b]8;;\x1b\\");
                    out.push_str(&format!("\x1b]8;;{}\x1b\\", uri));
                    active_hyperlink_uri = Some(uri.clone());
                }
                (Some(_), None) => {
                    out.push_str("\x1b]8;;\x1b\\");
                    active_hyperlink_uri = None;
                }
                _ => {}
            }

            // Emit SGR if attributes changed
            let needs_sgr = cell.fg != prev_fg || cell.bg != prev_bg || cell.flags != prev_flags;
            if needs_sgr {
                emit_serialize_sgr(&mut out, cell.fg, cell.bg, cell.flags);
                prev_fg = cell.fg;
                prev_bg = cell.bg;
                prev_flags = cell.flags;
            }

            let c = cell.c;
            if c == '\0' {
                out.push(' ');
            } else {
                out.push(c);
            }

            // Zero-width characters
            if let Some(zerowidth) = cell.zerowidth() {
                for &zw in zerowidth {
                    out.push(zw);
                }
            }
        }

        line += 1;
    }

    // Close any open hyperlink
    if active_hyperlink_uri.is_some() {
        out.push_str("\x1b]8;;\x1b\\");
    }

    // Final reset
    if prev_fg != Color::Named(NamedColor::Foreground)
        || prev_bg != Color::Named(NamedColor::Background)
        || !prev_flags.is_empty()
    {
        out.push_str("\x1b[0m");
    }

    out
}

/// Restore scrollback by feeding ANSI text through the VTE parser into the Term.
/// Backward compatible with old xterm.js SerializeAddon format.
pub fn restore_scrollback<T: EventListener>(term: &mut Term<T>, scrollback: &str) {
    // Strip orphaned underline from serialized OSC 8 links (same as frontend did).
    // The serialize addon doesn't preserve OSC 8 link data but emits SGR 4 for linked cells.
    let cleaned = strip_orphaned_underlines(scrollback);

    let mut processor: vte::ansi::Processor = vte::ansi::Processor::new();
    processor.advance(term, cleaned.as_bytes());

    // Reset DEC private modes that may have been set
    // (focus reporting, bracketed paste — shell manages its own)
    processor.advance(term, b"\x1b[?1004l\x1b[?2004l");
}

/// Strip SGR 4/24 (underline on/off) from SGR sequences to remove
/// orphaned underlines from old xterm.js serialized OSC 8 links.
fn strip_orphaned_underlines(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i < bytes.len() {
        // Look for ESC [
        if i + 1 < bytes.len() && bytes[i] == 0x1b && bytes[i + 1] == b'[' {
            // Find the end of the SGR sequence (terminated by 'm')
            let start = i;
            i += 2; // skip ESC [
            let params_start = i;
            while i < bytes.len() && bytes[i] != b'm' && bytes[i] != 0x1b {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'm' {
                let params = &input[params_start..i];
                // Filter out '4' and '24' from the parameter list
                let filtered: Vec<&str> = params
                    .split(';')
                    .filter(|p| *p != "4" && *p != "24")
                    .collect();
                if filtered.is_empty() {
                    // Entire sequence was just underline — skip it
                } else {
                    out.push_str("\x1b[");
                    out.push_str(&filtered.join(";"));
                    out.push('m');
                }
                i += 1; // skip 'm'
            } else {
                // Not a valid SGR — copy as-is
                out.push_str(&input[start..i]);
            }
        } else {
            // Advance by full UTF-8 character width to preserve multi-byte chars.
            // `bytes[i] as char` would corrupt non-ASCII by treating individual
            // bytes as Latin-1 code points — bytes 0x80-0x9F become C1 control
            // characters that VTE interprets as escape sequences, causing massive
            // garbled output on restore.
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    out
}

/// Emit a compact SGR for serialization (without color palette lookups).
fn emit_serialize_sgr(out: &mut String, fg: Color, bg: Color, flags: Flags) {
    out.push_str("\x1b[0");

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
    if flags.contains(Flags::INVERSE) {
        out.push_str(";7");
    }
    if flags.contains(Flags::HIDDEN) {
        out.push_str(";8");
    }
    if flags.contains(Flags::STRIKEOUT) {
        out.push_str(";9");
    }

    emit_serialize_color(out, fg, true);
    emit_serialize_color(out, bg, false);

    out.push('m');
}

fn emit_serialize_color(out: &mut String, color: Color, is_fg: bool) {
    match color {
        Color::Named(name) => {
            let code = match name {
                NamedColor::Black | NamedColor::DimBlack => 30,
                NamedColor::Red | NamedColor::DimRed => 31,
                NamedColor::Green | NamedColor::DimGreen => 32,
                NamedColor::Yellow | NamedColor::DimYellow => 33,
                NamedColor::Blue | NamedColor::DimBlue => 34,
                NamedColor::Magenta | NamedColor::DimMagenta => 35,
                NamedColor::Cyan | NamedColor::DimCyan => 36,
                NamedColor::White | NamedColor::DimWhite => 37,
                NamedColor::BrightBlack => 90,
                NamedColor::BrightRed => 91,
                NamedColor::BrightGreen => 92,
                NamedColor::BrightYellow => 93,
                NamedColor::BrightBlue => 94,
                NamedColor::BrightMagenta => 95,
                NamedColor::BrightCyan => 96,
                NamedColor::BrightWhite => 97,
                // Default colors — skip
                _ => return,
            };
            let code = if !is_fg { code + 10 } else { code };
            out.push_str(&format!(";{}", code));
        }
        Color::Spec(rgb) => {
            if is_fg {
                out.push_str(&format!(";38;2;{};{};{}", rgb.r, rgb.g, rgb.b));
            } else {
                out.push_str(&format!(";48;2;{};{};{}", rgb.r, rgb.g, rgb.b));
            }
        }
        Color::Indexed(idx) => {
            if idx < 8 {
                let base = if is_fg { 30 } else { 40 };
                out.push_str(&format!(";{}", base + idx));
            } else if idx < 16 {
                let base = if is_fg { 90 } else { 100 };
                out.push_str(&format!(";{}", base + idx - 8));
            } else {
                if is_fg {
                    out.push_str(&format!(";38;5;{}", idx));
                } else {
                    out.push_str(&format!(";48;5;{}", idx));
                }
            }
        }
    }
}
