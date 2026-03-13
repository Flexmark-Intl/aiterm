use std::sync::mpsc::Sender;

use alacritty_terminal::event::{Event, EventListener};
use tauri::{AppHandle, Emitter};

use crate::state::PtyCommand;

/// Bridge between alacritty_terminal's internal events and our Tauri event system.
/// alacritty_terminal calls `send_event()` when the terminal state changes.
pub struct AitermEventProxy {
    pub pty_id: String,
    pub app_handle: AppHandle,
    pub pty_sender: Sender<PtyCommand>,
}

impl EventListener for AitermEventProxy {
    fn send_event(&self, event: Event) {
        match event {
            Event::Title(title) => {
                let _ = self.app_handle.emit(
                    &format!("term-title-{}", self.pty_id),
                    title,
                );
            }
            Event::Bell => {
                let _ = self.app_handle.emit(
                    &format!("term-bell-{}", self.pty_id),
                    (),
                );
            }
            Event::ClipboardStore(_clipboard_type, text) => {
                let _ = self.app_handle.emit(
                    &format!("term-clipboard-{}", self.pty_id),
                    text,
                );
            }
            Event::PtyWrite(text) => {
                let bytes = text.into_bytes();
                let _ = self.pty_sender.send(PtyCommand::Write(bytes));
            }
            Event::ResetTitle => {
                let _ = self.app_handle.emit(
                    &format!("term-title-{}", self.pty_id),
                    String::new(),
                );
            }
            // ColorRequest: terminal querying current color values — respond via PtyWrite
            Event::ColorRequest(_index, formatter) => {
                // Look up the color from our configured colors and respond.
                // For now, respond with a default black to avoid leaving the query unanswered.
                let response = formatter(alacritty_terminal::vte::ansi::Rgb { r: 0, g: 0, b: 0 });
                let _ = self.pty_sender.send(PtyCommand::Write(response.into_bytes()));
            }
            // TextAreaSizeRequest: terminal querying window size in pixels
            Event::TextAreaSizeRequest(formatter) => {
                // Respond with zeros — we don't have pixel info in the backend
                let response = formatter(alacritty_terminal::event::WindowSize {
                    num_lines: 0,
                    num_cols: 0,
                    cell_width: 0,
                    cell_height: 0,
                });
                let _ = self.pty_sender.send(PtyCommand::Write(response.into_bytes()));
            }
            // ClipboardLoad: terminal wants to read clipboard — not supported from backend
            Event::ClipboardLoad(_clipboard_type, _formatter) => {}
            // Wakeup, CursorBlinkingChange, MouseCursorDirty, Exit, ChildExit — not needed
            _ => {}
        }
    }
}
