# Claude Code IDE Integration

aiTerm exposes an MCP server that Claude Code CLI discovers and connects to, providing IDE-like capabilities.

## Architecture

```
Claude Code CLI ←→ WebSocket/SSE ←→ axum server (Rust) ←→ Tauri events ←→ Frontend (Svelte)
```

**Backend** (`src-tauri/src/claude_code/`):
- `server.rs` — axum router with WebSocket (`/`) and SSE (`/sse` + `/message`) endpoints. Random port (10000–65535), 32-char auth token.
- `protocol.rs` — JSON-RPC request/response types, `tool_list_response()` (11 tools), `initialize_response()`
- `lockfile.rs` — writes `~/.claude/ide/{port}.lock` for discovery, registers `mcpServers.aiterm` (or `aiterm-dev`) in `~/.claude.json`, registers hooks in `~/.claude/settings.json`

**Frontend** (`src/lib/stores/claudeCode.svelte.ts`):
- Listens for `claude-code-tool` Tauri events
- Dispatches to tool handlers (getOpenEditors, openFile, openDiff, etc.)
- Responds via `claude_code_respond` Tauri command

**Enabled by**: `preferences.claude_code_ide` (default true). Server starts in `lib.rs` as a background tokio task.

## Tools Exposed

| Tool | Description |
|------|-------------|
| initSession | **REQUIRED first call.** Registers tab ID + session ID → enables auto-inject of tabId on all subsequent calls |
| getOpenEditors | List open editor tabs (path, language, dirty state) |
| getWorkspaceFolders | Workspace root paths |
| getDiagnostics | Language diagnostics for a file |
| checkDocumentDirty | Check if file has unsaved changes |
| saveDocument | Save file to disk |
| getCurrentSelection | Active editor selection + cursor |
| getLatestSelection | Most recent selection in any tab |
| openFile | Open file in editor tab (with optional line/text selection) |
| openDiff | Show side-by-side diff for review (blocking) |
| closeAllDiffTabs | Close all pending diff tabs |
| listWorkspaces | List all workspaces with panes, tabs (IDs, display names, types, active state, notes, Claude state) |
| switchTab | Navigate to a tab by ID (auto-resolves workspace/pane) |
| getTabNotes | Read notes for a tab (optional tabId, defaults to active) |
| setTabNotes | Write/clear notes for a tab |
| listWorkspaceNotes | List workspace-level notes (IDs, previews, timestamps) |
| readWorkspaceNote | Read full content of a workspace note |
| writeWorkspaceNote | Create or update a workspace note |
| deleteWorkspaceNote | Delete a workspace note |
| moveNote | Move note between tab and workspace (with conflict detection) |
| getTabContext | Get recent terminal output/editor content for tab discovery |
| openNotesPanel | Open/close/toggle the notes panel for the active tab |
| setNotesScope | Switch notes panel between 'tab' and 'workspace' views |
| getActiveTab | Get the currently active workspace, pane, and tab info |
| setTriggerVariable | Set/clear a trigger variable (e.g. claudeSessionId) for a tab |
| getTriggerVariables | Read all trigger variables for a tab |
| setAutoResume | Enable/disable auto-resume with optional command/cwd/ssh overrides |
| getAutoResume | Get current auto-resume configuration for a tab |
| findNotes | Search all tabs and workspaces for notes, returns previews |
| getClaudeSessions | All active Claude sessions across tabs (state, tool, model, cwd) — multi-agent coordination |

## Claude Code Hooks Integration

Hooks registered in `~/.claude/settings.json` on MCP server startup, cleaned up on app exit and stale lockfile sweep.

**Hooks registered:**
- `SessionStart` (command): Echoes tab ID into Claude's context. Gated on `$AITERM_PORT` matching server port (prevents dev/prod cross-talk). Output appears collapsed in TUI ("Ran 1 start hook") but injected into model context as system-reminder.
- `SessionStart` (HTTP): POST to `/hooks` with `{session_id, cwd, source, model}`. Registers session→tab mapping in `AppState.claude_sessions`.
- `SessionEnd` (HTTP): Removes session from mapping.
- `Notification` (HTTP): Receives Claude Code notification events.
- `Stop` (HTTP): Receives stop events.

**Connection tab affinity (`initSession`):**
- Claude calls `initSession({ tabId, sessionId })` as its first MCP tool call
- Server stores connection_id → tab_id mapping in `ServerState.connection_tabs`
- All subsequent tool calls on that connection auto-inject `tabId` if missing
- Prevents wrong-tab targeting when user switches tabs while Claude is working
- Connection affinity cleaned up on disconnect (WS close, SSE drop)

**Dev/prod isolation:**
- PTY env vars: `AITERM_TAB_ID` (tab ID), `AITERM_PORT` (server port) — set at spawn in `pty/manager.rs`
- Command hook gates on `$AITERM_PORT` match
- MCP tool guard in `server.rs` rejects `tabId` that doesn't exist in this instance
- MCP instructions specify server name (`aiterm` vs `aiterm-dev`)

**`/aiterm` skill (auto-installed):**
- Written to `~/.claude/skills/aiterm/SKILL.md` on startup, removed on exit
- Provides fast slash-command access: `/aiterm notes`, `/aiterm diag`, `/aiterm tabs`, etc.
- Reduces LLM inference by giving explicit tool→parameter mappings
- Uses `mcp_server_key()` to reference correct MCP server (aiterm vs aiterm-dev)

**Stale hook cleanup:** On startup, `write_hook_settings()` sweeps hooks whose port has no live lockfile. `cleanup_stale_lockfiles()` also removes hooks for dead servers by auth token. Port extraction handles both URL format (`127.0.0.1:NNNNN`) and legacy env var format (`AITERM_PORT = "NNNNN"`).

**Auto-open notes panel:** `claudeCode.svelte.ts` auto-opens notes panel when MCP tools write tab notes or workspace notes, switching scope as appropriate.

## SSH MCP Bridge (Remote IDE Tools)

Exposes local MCP tools to Claude Code running on remote servers via SSH reverse tunnels.

**Architecture:**
```
Local aiTerm → SSH reverse tunnel (-R 0:127.0.0.1:{mcp_port}) → Remote :allocated_port
               Background SSH → writes lockfile + ~/.claude.json on remote
Remote Claude Code → discovers ~/.claude/ide/{port}.lock → connects through tunnel → local MCP server
```

**Key files:**
- `src-tauri/src/commands/ssh_tunnel.rs` — tunnel lifecycle (start, detach, kill), port parsing, `ssh_run_setup` for background lockfile writing
- `src/lib/stores/sshMcpBridge.svelte.ts` — bridge orchestration, reactive status tracking, ref counting

**Preference:** `claude_code_ide_ssh` (default true, requires `claude_code_ide`). Controls auto-enable on SSH detection.

**Tunnel sharing:** One tunnel per `host_key` (user@host), ref-counted by tab IDs. Last tab detaches → tunnel killed.

**Auto-enable:** SSH sessions detected via `getPtyInfo()` foreground_command. For restore/clone SSH: 5s delay after SSH replay. For ad-hoc SSH: 10s delayed check. Manual via context menu.

**Remote setup:** Lockfile, `~/.claude.json`, and hooks (`~/.claude/settings.json`) are written via a separate background SSH connection (`ssh_run_setup`), **not** through the user's interactive PTY. This prevents command injection into running programs (e.g. Claude Code). The setup script uses shell variables for JSON data to avoid nested quoting issues, and pipes JSON to python3/jq via stdin. After setup, `AITERM_TAB_ID` and `AITERM_PORT` env vars are injected into the remote shell via PTY write (leading space suppresses shell history).

**Remote hooks:** All hook events (SessionStart, SessionEnd, Notification, Stop, UserPromptSubmit, PreToolUse, PostToolUse, PreCompact) are registered on the remote with HTTP hooks pointing to `127.0.0.1:{remotePort}/hooks`. These tunnel back through the SSH reverse tunnel to the local MCP server's hooks handler. A command hook on SessionStart reads `$AITERM_TAB_ID` (from env var injection) and echoes the tab ID into Claude's context. Hooks require python3 on the remote for the settings.json merge.

**Remote cleanup:** Stale lockfile detection on reconnect tests dead ports via `/dev/tcp/localhost/{port}`. No EXIT trap (background SSH has no persistent shell on remote). Stale hooks with dead port URLs are harmless (fail silently) and cleaned up on next bridge setup.

**Port allocation:** `ssh -v -R 0:...` lets SSH pick a free remote port. The `-v` flag is required because ControlMaster mux clients print nothing without it. Port parsed from both stdout and stderr (direct connections use stderr, mux clients use stderr with `-v`). Uses `tokio::select!` to read both streams concurrently.

**ControlMaster mux:** Tunnel and setup SSH commands do **not** use `-o ControlMaster=no` — this lets them multiplex over the user's existing authenticated socket (free auth for password/passphrase users). Mux clients exit immediately after setup (the master holds the forwarding), so the background process monitor only removes tunnel state on error exits, not clean exits.

**Bridge status UI:** Reactive `$state` Map in `sshMcpBridge.svelte.ts` drives a bolt icon in TerminalTabs (green=connected, dim=failed). Failure dispatches an in-app notification via `notificationDispatch`.

## SSH-Specific Pitfalls

- **SSH ControlMaster mux silent output**: When SSH multiplexes through an existing master socket, `ssh -R 0:...` prints nothing to stdout or stderr without `-v`. The "Allocated port" message only appears with verbose mode. Additionally, the mux client exits immediately with code 0 after setting up the forwarding — the master process holds the tunnel. Background tunnel monitors must not clean up state on clean exit.
- **SSH background command quoting**: Shell commands sent via `ssh user@host 'script'` must use newlines (not `;`) as separators — `do;`, `then;`, `else;` are syntax errors. JSON data should be stored in shell variables and passed to python3/jq via stdin to avoid nested quote hell.
