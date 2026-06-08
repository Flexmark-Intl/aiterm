---
title: Claude Code Integration
description: MCP server exposing IDE tools to Claude Code CLI for file operations, diff review, and editor control.
---

maiTerm exposes an MCP server that Claude Code CLI discovers and connects to automatically, providing IDE-like capabilities without requiring a full IDE.

## How It Works

```
Claude Code CLI ←→ Streamable HTTP ←→ axum server (Rust) ←→ Tauri events ←→ Frontend (Svelte)
```

The MCP server starts automatically when maiTerm launches (configurable in preferences). It writes a lock file to `~/.claude/ide/` and registers in `~/.claude.json` for automatic discovery by Claude Code.

### SSH MCP Bridge

When you're SSH'd into a remote server, maiTerm can bridge the MCP connection so Claude Code running remotely still has access to all IDE tools. A reverse SSH tunnel is set up automatically in the background — no manual port forwarding needed. The bridge status is shown in the tab bar with a bolt icon (green = connected).

## Available Tools

### Editor Tools

| Tool | Description |
|------|-------------|
| `getOpenEditors` | List open editor tabs (path, language, dirty state) |
| `getWorkspaceFolders` | Workspace root paths |
| `getDiagnostics` | Language diagnostics for a file |
| `checkDocumentDirty` | Check if file has unsaved changes |
| `saveDocument` | Save file to disk |
| `getCurrentSelection` | Active editor selection + cursor |
| `getLatestSelection` | Most recent selection in any tab |
| `openFile` | Open file in editor tab (with optional line/text selection) |
| `openDiff` | Show side-by-side diff for review (blocking — accept/reject) |
| `showDiff` | View a git diff read-only (non-blocking) |
| `closeAllDiffTabs` | Close all pending diff tabs |

### Workspace & Tab Navigation

| Tool | Description |
|------|-------------|
| `listWorkspaces` | List all workspaces with panes, tabs (IDs, display names, types, active state, notes) |
| `switchTab` | Navigate to a tab by ID (auto-resolves workspace and pane) |
| `getTabContext` | Get recent terminal output or editor content for tab discovery |

### Notes Management

| Tool | Description |
|------|-------------|
| `getTabNotes` | Read notes for a tab (defaults to active tab) |
| `setTabNotes` | Write or clear notes for a tab |
| `listWorkspaceNotes` | List workspace-level notes (IDs, previews, timestamps) |
| `readWorkspaceNote` | Read full content of a workspace note |
| `writeWorkspaceNote` | Create or update a workspace note |
| `deleteWorkspaceNote` | Delete a workspace note |
| `moveNote` | Move notes between tab and workspace (with conflict detection) |
| `openNotesPanel` | Open, close, or toggle the notes panel |
| `setNotesScope` | Switch notes panel between tab and workspace views |

### Tab State & Preferences

| Tool | Description |
|------|-------------|
| `getActiveTab` | Get the currently active workspace, pane, and tab info |
| `setTriggerVariable` | Set or clear a trigger variable for a tab |
| `getTriggerVariables` | Read all trigger variables for a tab |
| `setAutoResume` | Enable/disable auto-resume with optional command/cwd/ssh overrides |
| `getAutoResume` | Get current auto-resume configuration for a tab |
| `getPreferences` | Read maiTerm preferences |
| `setPreference` | Update an maiTerm preference |
| `findNotes` | Search all tabs and workspaces for notes in one call |
| `getDiagnostics` | App diagnostics — version, PTY stats, memory, WebGL state |
| `readLogs` | Tail the log file with level filter and search |
| `getClaudeSessions` | List all active Claude sessions across tabs with state, tool, and model info |
| `listWindows` | List all maiTerm windows with workspace summaries |
| `createBackup` | Create a state backup on demand |
| `sendNotification` | Send a toast or OS notification from Claude Code |

### Agent Bridge

| Tool | Description |
|------|-------------|
| `sendToBridgedAgent` | Send a message to the peer agent this tab is bridged with — async, the reply arrives as a new prompt turn |
| `getBridgedAgent` | Report whether this tab is bridged and, if so, the partner's label and working directory |

See [Agent Bridge](/features/agent-bridge/) for the full feature.

### Tab Context Discovery

The `getTabContext` tool lets Claude Code peek at what's happening in your tabs — recent terminal output or editor file content. If you have fewer than 10 tabs, it automatically returns context for all of them, making it easy for Claude to find the right tab without you having to specify. For larger workspaces, you can pass specific tab IDs.

## Claude Code Hooks

maiTerm integrates with Claude Code's hook system for real-time session awareness — no regex triggers needed:

- **Session lifecycle** — tracks session start, end, and compaction events
- **Active tool overlay** — see what Claude is doing right now (editing files, running bash, etc.) in the terminal corner
- **Agent state indicators** — per-tab, per-workspace, and a global footer dot show whether each agent is working, waiting for permission, or done — see [Agent State Indicators](#agent-state-indicators) below
- **Auto-resume** — automatically captures session IDs and reconnects on tab restore
- **Multi-agent awareness** — `getClaudeSessions` tool lets any Claude session discover all other active sessions across tabs for coordination, and [Agent Bridge](/features/agent-bridge/) lets two sessions talk to each other directly
- **Compaction notifications** — alerts during and after context compaction

## Agent State Indicators

maiTerm surfaces what every Claude agent is doing at three levels, all driven by hooks — no terminal-output guessing:

- **Per tab** — each tab's indicator reflects its agent: a pulse while working, ❗ when it needs permission, and a green dot when it's done and waiting for input. Ordinary terminal output stays a dim dot, so a finished agent is never mistaken for a stray line of output.
- **Per workspace** — the sidebar rolls a workspace's tabs into one dot using batch semantics (`permission > working > done`). It turns green only once *every* agent in the workspace has settled, so green unambiguously means "all done."
- **Global footer dot** — rolls up every agent in the current window: red pulse = needs permission, accent pulse = working, green = finished, dim = no agents. Click it to jump straight to an agent's tab; when several agents share the dominant state, each click cycles to the next.

### Read vs. unread

A finished agent shows a **filled** green dot (unread); once you view its tab it relaxes to a **hollow** green ring (seen). This rolls up too — a workspace dot stays filled until every finished agent inside it has been seen, then goes hollow — so you can tell at a glance which completed agents still need a look.

## Agent Bridge

Bridge two running Claude Code sessions so they can collaborate directly — one local and one over SSH, or two related projects. Press `Cmd+Shift+L` to pick a peer session; maiTerm forks it into a split pane beside you (or links an existing tab), and the two agents talk through `sendToBridgedAgent`. Every message is stamped with the sender's real identity so the recipient knows it's a peer, not you — and the agents stay deferring to you for decisions. Bridges persist across restarts.

See the dedicated [Agent Bridge](/features/agent-bridge/) page for the full walkthrough.

## File Drop & Image Paste

Drag files onto a terminal running Claude Code over SSH — maiTerm SCP uploads them to a temp directory on the remote and pastes the paths so Claude can read them as file references. On local terminals, file paths are pasted directly.

You can also paste images from your clipboard (Cmd+V) into a Claude Code session. maiTerm saves the image to a temp file and pastes the path, so Claude can view it directly — useful for sharing screenshots, diagrams, or error messages without leaving the terminal.

## The `/maiterm` Skill

maiTerm installs a Claude Code skill that gives your agent fast slash-command access to the most common tools — `/maiterm notes`, `/maiterm tabs`, `/maiterm diag`, and more — without making it hunt through every MCP tool. It's written on launch and removed on exit, and it works the same way over SSH on bridged remote hosts.

It also ships a recommended **status line** for Claude Code. Run `/maiterm statusline` and your agent installs a compact status line showing host · cwd · git branch · model · reasoning effort · context usage. The installer renders a live colored preview first, only writes to `~/.claude/statusline-command.sh` and your settings (it's idempotent — safe to re-run), and tells you if `jq` is missing instead of leaving a broken line. It works on local sessions and on SSH-bridged hosts.

## Dev/Production Isolation

Dev builds register as `aiterm-dev` with display name "maiTermDev", so development and production instances don't interfere with each other.
