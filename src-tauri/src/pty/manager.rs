use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::state::{AppState, PtyCommand, PtyHandle};
use crate::state::persistence::app_data_slug;

pub fn spawn_pty(
    app_handle: &AppHandle,
    state: &Arc<AppState>,
    pty_id: &str,
    tab_id: &str,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    log::info!("spawn_pty: pty_id={}, tab_id={}, cols={}, rows={}", pty_id, tab_id, cols, rows);
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

    // Set up per-tab history file (sanitize tab_id to prevent path traversal)
    let safe_tab_id = tab_id.replace(['/', '\\', '.'], "");
    if let Some(data_dir) = dirs::data_dir() {
        let history_dir = data_dir.join(app_data_slug()).join("history");
        // Create history directory if it doesn't exist
        let _ = std::fs::create_dir_all(&history_dir);

        let history_file = history_dir.join(format!("{}.history", safe_tab_id));
        let history_path = history_file.to_string_lossy().to_string();

        // Set HISTFILE for bash/zsh/sh
        match shell_name {
            "bash" | "zsh" | "sh" | "ksh" => {
                cmd.env("HISTFILE", &history_path);
            }
            "fish" => {
                // Fish uses a different variable
                cmd.env("fish_history", &safe_tab_id);
            }
            _ => {
                cmd.env("HISTFILE", &history_path);
            }
        }
    }

    // Shell integration: configure shell hooks for title and/or command completion
    let prefs = state.app_data.read().preferences.clone();
    let shell_title_integration = prefs.shell_title_integration;
    let shell_integration = prefs.shell_integration;
    if shell_title_integration || shell_integration {
        match shell_name {
            "bash" => {
                if shell_integration {
                    // Build PROMPT_COMMAND with DEBUG trap for OSC 133 B.
                    // The trap is set once (guarded by __aiterm_trap). It fires
                    // before each command; the __aiterm_at_prompt flag ensures B
                    // is only emitted for the first command after a prompt.
                    // The flag is set LAST so DEBUG doesn't see it during prompt.
                    let title_part = if shell_title_integration {
                        r#" printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD/#$HOME/~}";"#
                    } else { "" };
                    let prompt_cmd = format!(
                        concat!(
                            r#"if [ -z "$__aiterm_trap" ]; then __aiterm_trap=1;"#,
                            r#" trap '[[ "$__aiterm_at_prompt" == 1 ]] && __aiterm_at_prompt= && printf "\033]133;B\007"' DEBUG;"#,
                            r#" fi;"#,
                            r#" __aiterm_ec=$?; printf '\033]133;D;%d\007' "$__aiterm_ec"; printf '\033]133;A\007';"#,
                            r#"{}"#,
                            r#" __aiterm_at_prompt=1"#,
                        ),
                        title_part,
                    );
                    cmd.env("PROMPT_COMMAND", prompt_cmd);
                } else if shell_title_integration {
                    cmd.env(
                        "PROMPT_COMMAND",
                        r#"printf "\033]0;%s@%s:%s\007" "${USER}" "${HOSTNAME%%.*}" "${PWD/#$HOME/~}""#,
                    );
                }
            }
            "zsh" => {
                if let Ok(integration_dir) = setup_zsh_integration(shell_title_integration, shell_integration) {
                    let real_zdotdir = std::env::var("ZDOTDIR")
                        .unwrap_or_else(|_| {
                            dirs::home_dir()
                                .map(|h| h.to_string_lossy().to_string())
                                .unwrap_or_default()
                        });
                    cmd.env("AITERM_REAL_ZDOTDIR", &real_zdotdir);
                    cmd.env("ZDOTDIR", integration_dir.to_string_lossy().to_string());
                }
            }
            "fish" => {
                let mut parts: Vec<String> = Vec::new();
                if shell_integration {
                    parts.push(
                        r#"function __aiterm_osc133 --on-event fish_prompt; printf '\e]133;D;%d\a\e]133;A\a' $status; end"#.to_string()
                    );
                    parts.push(
                        r#"function __aiterm_osc133_preexec --on-event fish_preexec; printf '\e]133;B\a'; end"#.to_string()
                    );
                }
                if shell_title_integration {
                    parts.push(
                        r#"function fish_title; printf '%s@%s:%s' $USER (prompt_hostname) (prompt_pwd); end"#.to_string()
                    );
                }
                cmd.arg("-C");
                cmd.arg(parts.join("; "));
            }
            _ => {}
        }
    }

    // Set working directory — use provided cwd (from split) or fall back to home
    if let Some(ref dir) = cwd {
        let path = std::path::Path::new(dir);
        if path.is_dir() {
            cmd.cwd(path);
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }
    } else if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }
    if let Some(home) = dirs::home_dir() {
        cmd.env("HOME", home.to_string_lossy().to_string());
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
        log::error!("Failed to spawn command: {}", e);
        e.to_string()
    })?;

    let child_pid = child.process_id();

    // Drop the slave - this is important! The shell won't start properly if we keep it open
    drop(pair.slave);

    // Get reader and writer from master
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Create channel for commands
    let (tx, rx) = mpsc::channel::<PtyCommand>();

    // Store PTY handle with child PID
    {
        let mut registry = state.pty_registry.write();
        registry.insert(pty_id.to_string(), PtyHandle { sender: tx, child_pid });
    }

    // Spawn writer thread (with PTY registry cleanup on exit)
    let master = pair.master;
    let state_clone = Arc::clone(state);
    let pty_id_owned = pty_id.to_string();
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
        // Cleanup: remove PTY handle from registry on exit
        state_clone.pty_registry.write().remove(&pty_id_owned);
    });

    // Spawn reader thread
    let pty_id_clone = pty_id.to_string();
    let app_handle_clone = app_handle.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    break;
                }
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let event_name = format!("pty-output-{}", pty_id_clone);
                    let _ = app_handle_clone.emit(&event_name, data);
                }
                Err(_) => {
                    break;
                }
            }
        }
        // Emit close event
        let event_name = format!("pty-close-{}", pty_id_clone);
        let _ = app_handle_clone.emit(&event_name, ());
    });

    Ok(())
}

pub fn write_pty(state: &Arc<AppState>, pty_id: &str, data: &[u8]) -> Result<(), String> {
    let registry = state.pty_registry.read();
    let handle = registry.get(pty_id).ok_or("PTY not found")?;
    handle
        .sender
        .send(PtyCommand::Write(data.to_vec()))
        .map_err(|e| e.to_string())
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

/// Info returned when querying a PTY for split cloning
#[derive(serde::Serialize, Clone)]
pub struct PtyInfo {
    pub cwd: Option<String>,
    pub foreground_command: Option<String>,
}

pub fn get_pty_info(state: &Arc<AppState>, pty_id: &str) -> Result<PtyInfo, String> {
    let registry = state.pty_registry.read();
    let handle = registry.get(pty_id).ok_or("PTY not found")?;
    let pid = handle.child_pid.ok_or("No child PID")?;

    let cwd = get_cwd_for_pid(pid);
    let foreground_command = get_foreground_command(pid);

    Ok(PtyInfo { cwd, foreground_command })
}

/// Get the current working directory of a process (macOS)
fn get_cwd_for_pid(pid: u32) -> Option<String> {
    let output = std::process::Command::new("lsof")
        .args(["-a", "-d", "cwd", "-p", &pid.to_string(), "-Fn"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // lsof output: lines starting with 'n' contain the path
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('n') {
            if path.starts_with('/') {
                return Some(path.to_string());
            }
        }
    }
    None
}

/// Check if a command string looks like an SSH/remote connection command
fn is_ssh_command(cmd: &str) -> bool {
    let base = cmd.split_whitespace().next().unwrap_or("");
    let basename = std::path::Path::new(base)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(base);
    matches!(basename, "ssh" | "mosh" | "autossh")
}

/// Get the foreground process command (for SSH detection)
/// Walks child processes to find any SSH-like process in the chain.
/// An alias like `gnova` that expands to `ssh user@host` will show
/// `ssh user@host` in the process tree, so aliases are handled transparently.
fn get_foreground_command(shell_pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "pid=,ppid=,command=", "-x"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Build a map of ppid -> [(pid, command)]
    let mut children: std::collections::HashMap<u32, Vec<(u32, String)>> =
        std::collections::HashMap::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.trim().splitn(3, char::is_whitespace).collect();
        if parts.len() < 3 {
            continue;
        }
        let pid: u32 = match parts[0].trim().parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let ppid: u32 = match parts[1].trim().parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let cmd = parts[2].trim().to_string();
        children.entry(ppid).or_default().push((pid, cmd));
    }

    // Walk down from shell_pid to the leaf, remembering any SSH command found
    let mut current_pid = shell_pid;
    let mut ssh_cmd: Option<String> = None;

    loop {
        if let Some(kids) = children.get(&current_pid) {
            if let Some((kid_pid, kid_cmd)) = kids.first() {
                if is_ssh_command(kid_cmd) {
                    ssh_cmd = Some(kid_cmd.clone());
                }
                current_pid = *kid_pid;
            } else {
                break;
            }
        } else {
            break;
        }
    }

    ssh_cmd
}

/// Create zsh integration directory with shim files that source the user's
/// real config and add precmd hooks for title and/or command completion.
fn setup_zsh_integration(title: bool, shell_integration: bool) -> Result<std::path::PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("No data directory")?;
    let zsh_dir = data_dir.join(app_data_slug()).join("shell-integration").join("zsh");
    std::fs::create_dir_all(&zsh_dir).map_err(|e| e.to_string())?;

    let zshenv_content = r#"# aiTerm shell integration - do not edit
if [[ -n "$AITERM_REAL_ZDOTDIR" ]]; then
  [[ -f "$AITERM_REAL_ZDOTDIR/.zshenv" ]] && source "$AITERM_REAL_ZDOTDIR/.zshenv"
else
  [[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
fi
"#;

    let mut hooks = String::new();
    hooks.push_str("# aiTerm shell integration - do not edit\n");
    hooks.push_str("if [[ -n \"$AITERM_REAL_ZDOTDIR\" ]]; then\n");
    hooks.push_str("  ZDOTDIR=\"$AITERM_REAL_ZDOTDIR\"\n");
    hooks.push_str("  [[ -f \"$ZDOTDIR/.zshrc\" ]] && source \"$ZDOTDIR/.zshrc\"\n");
    hooks.push_str("else\n");
    hooks.push_str("  ZDOTDIR=\"$HOME\"\n");
    hooks.push_str("  [[ -f \"$HOME/.zshrc\" ]] && source \"$HOME/.zshrc\"\n");
    hooks.push_str("fi\n\n");
    hooks.push_str("autoload -Uz add-zsh-hook\n");

    if shell_integration {
        hooks.push_str("_aiterm_osc133_precmd() {\n");
        hooks.push_str("  print -Pn '\\e]133;D;%?\\a\\e]133;A\\a'\n");
        hooks.push_str("}\n");
        hooks.push_str("add-zsh-hook precmd _aiterm_osc133_precmd\n");
        hooks.push_str("_aiterm_osc133_preexec() {\n");
        hooks.push_str("  print -Pn '\\e]133;B\\a'\n");
        hooks.push_str("}\n");
        hooks.push_str("add-zsh-hook preexec _aiterm_osc133_preexec\n");
    }

    if title {
        hooks.push_str("_aiterm_title_precmd() {\n");
        hooks.push_str("  printf '\\033]0;%s@%s:%s\\007' \"${USER}\" \"${HOST%%.*}\" \"${PWD/#$HOME/~}\"\n");
        hooks.push_str("}\n");
        hooks.push_str("add-zsh-hook precmd _aiterm_title_precmd\n");
    }

    std::fs::write(zsh_dir.join(".zshenv"), zshenv_content).map_err(|e| e.to_string())?;
    std::fs::write(zsh_dir.join(".zshrc"), &hooks).map_err(|e| e.to_string())?;

    Ok(zsh_dir)
}
