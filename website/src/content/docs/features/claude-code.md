---
title: Claude Code Integration
description: MCP server exposing IDE tools to Claude Code CLI for file operations, diff review, and editor control.
---

aiTerm exposes an MCP server that Claude Code CLI discovers and connects to automatically, providing IDE-like capabilities without requiring a full IDE.

## How It Works

```
Claude Code CLI ←→ Streamable HTTP ←→ axum server (Rust) ←→ Tauri events ←→ Frontend (Svelte)
```

The MCP server starts automatically when aiTerm launches (configurable in preferences). It writes a lock file to `~/.claude/ide/` and registers in `~/.claude.json` for automatic discovery by Claude Code.

### SSH MCP Bridge

When you're SSH'd into a remote server, aiTerm can bridge the MCP connection so Claude Code running remotely still has access to all IDE tools. A reverse SSH tunnel is set up automatically in the background — no manual port forwarding needed. The bridge status is shown in the tab bar with a bolt icon (green = connected).

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
| `getPreferences` | Read aiTerm preferences |
| `setPreference` | Update an aiTerm preference |
| `findNotes` | Search all tabs and workspaces for notes in one call |
| `getDiagnostics` | App diagnostics — version, PTY stats, memory, WebGL state |
| `readLogs` | Tail the log file with level filter and search |
| `getClaudeSessions` | List all active Claude sessions across tabs with state, tool, and model info |
| `listWindows` | List all aiTerm windows with workspace summaries |
| `createBackup` | Create a state backup on demand |
| `sendNotification` | Send a toast or OS notification from Claude Code |

### Tab Context Discovery

The `getTabContext` tool lets Claude Code peek at what's happening in your tabs — recent terminal output or editor file content. If you have fewer than 10 tabs, it automatically returns context for all of them, making it easy for Claude to find the right tab without you having to specify. For larger workspaces, you can pass specific tab IDs.

## Claude Code Hooks

aiTerm integrates with Claude Code's hook system for real-time session awareness — no regex triggers needed:

- **Session lifecycle** — tracks session start, end, and compaction events
- **Active tool overlay** — see what Claude is doing right now (editing files, running bash, etc.) in the terminal corner
- **Permission alerts** — workspace sidebar shows an alert indicator when Claude needs permission approval
- **Auto-resume** — automatically captures session IDs and reconnects on tab restore
- **Multi-agent awareness** — `getClaudeSessions` tool lets any Claude session discover all other active sessions across tabs for coordination
- **Compaction notifications** — alerts during and after context compaction

## File Drop

Drag files onto a terminal running Claude Code over SSH — aiTerm SCP uploads them to a temp directory on the remote and pastes the paths so Claude can read them as file references. On local terminals, file paths are pasted directly.

## Dev/Production Isolation

Dev builds register as `aiterm-dev` with display name "aiTermDev", so development and production instances don't interfere with each other.
