use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::state::{AppState, PtyCommand, PtyHandle};

pub fn spawn_pty(
    app_handle: &AppHandle,
    state: &Arc<AppState>,
    pty_id: &str,
    tab_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    eprintln!("spawn_pty called: pty_id={}, tab_id={}, cols={}, rows={}", pty_id, tab_id, cols, rows);
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Get the user's shell
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("zsh");

    // Spawn as login shell - handle different shells
    let mut cmd = CommandBuilder::new(&shell);

    // Most shells use -l for login, fish uses --login
    match shell_name {
        "fish" => { cmd.arg("--login"); }
        "bash" | "zsh" | "sh" | "ksh" | "tcsh" | "csh" => { cmd.arg("-l"); }
        _ => { cmd.arg("-l"); } // Default to -l for unknown shells
    }

    // Set environment variables
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    // Shell-specific environment variables for macOS
    if shell_name == "bash" {
        // Completely disable macOS bash session save/restore feature
        cmd.env("SHELL_SESSION_HISTORY", "0");
        cmd.env("SHELL_SESSION_DID_INIT", "1");
        cmd.env("BASH_SILENCE_DEPRECATION_WARNING", "1");
    }

    // Set up per-tab history file
    if let Some(data_dir) = dirs::data_dir() {
        let history_dir = data_dir.join("com.aiterm.app").join("history");
        // Create history directory if it doesn't exist
        let _ = std::fs::create_dir_all(&history_dir);

        let history_file = history_dir.join(format!("{}.history", tab_id));
        let history_path = history_file.to_string_lossy().to_string();

        // Set HISTFILE for bash/zsh/sh
        match shell_name {
            "bash" | "zsh" | "sh" | "ksh" => {
                cmd.env("HISTFILE", &history_path);
            }
            "fish" => {
                // Fish uses a different variable
                cmd.env("fish_history", tab_id);
            }
            _ => {
                cmd.env("HISTFILE", &history_path);
            }
        }
        eprintln!("Set HISTFILE to {}", history_path);
    }

    // Get current working directory - use home dir for new terminals
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home.clone());
        cmd.env("HOME", home.to_string_lossy().to_string());
    }

    eprintln!("Spawning command...");
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
        eprintln!("Failed to spawn command: {}", e);
        e.to_string()
    })?;
    eprintln!("Command spawned successfully");

    // Drop the slave - this is important! The shell won't start properly if we keep it open
    drop(pair.slave);
    eprintln!("Slave dropped");

    // Get reader and writer from master
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Create channel for commands
    let (tx, rx) = mpsc::channel::<PtyCommand>();

    // Store PTY handle
    {
        let mut registry = state.pty_registry.write();
        registry.insert(pty_id.to_string(), PtyHandle { sender: tx });
    }

    // Spawn writer thread
    let master = pair.master;
    thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(PtyCommand::Write(data)) => {
                    if writer.write_all(&data).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Ok(PtyCommand::Resize { cols, rows }) => {
                    let _ = master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
                Ok(PtyCommand::Kill) => {
                    let _ = child.kill();
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // Check if child is still alive
                    if let Ok(Some(_)) = child.try_wait() {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    let _ = child.kill();
                    break;
                }
            }
        }
    });

    // Spawn reader thread
    let pty_id_clone = pty_id.to_string();
    let app_handle_clone = app_handle.clone();

    thread::spawn(move || {
        eprintln!("Reader thread started for {}", pty_id_clone);
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!("Reader got EOF");
                    break;
                }
                Ok(n) => {
                    eprintln!("Reader got {} bytes", n);
                    let data = buf[..n].to_vec();
                    let event_name = format!("pty-output-{}", pty_id_clone);
                    let _ = app_handle_clone.emit(&event_name, data);
                }
                Err(e) => {
                    eprintln!("Reader error: {}", e);
                    break;
                }
            }
        }
        // Emit close event
        eprintln!("Reader thread exiting for {}", pty_id_clone);
        let event_name = format!("pty-close-{}", pty_id_clone);
        let _ = app_handle_clone.emit(&event_name, ());
    });

    Ok(())
}

pub fn write_pty(state: &Arc<AppState>, pty_id: &str, data: &[u8]) -> Result<(), String> {
    eprintln!("write_pty called: pty_id={}, data_len={}", pty_id, data.len());
    let registry = state.pty_registry.read();
    let handle = registry.get(pty_id).ok_or_else(|| {
        eprintln!("PTY not found: {}", pty_id);
        "PTY not found".to_string()
    })?;
    handle
        .sender
        .send(PtyCommand::Write(data.to_vec()))
        .map_err(|e| {
            eprintln!("Failed to send write command: {}", e);
            e.to_string()
        })
}

pub fn resize_pty(state: &Arc<AppState>, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let registry = state.pty_registry.read();
    let handle = registry.get(pty_id).ok_or("PTY not found")?;
    handle
        .sender
        .send(PtyCommand::Resize { cols, rows })
        .map_err(|e| e.to_string())
}

pub fn kill_pty(state: &Arc<AppState>, pty_id: &str) -> Result<(), String> {
    let mut registry = state.pty_registry.write();

    if let Some(handle) = registry.remove(pty_id) {
        let _ = handle.sender.send(PtyCommand::Kill);
    }

    Ok(())
}
