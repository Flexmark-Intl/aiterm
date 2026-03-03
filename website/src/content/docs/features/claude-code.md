---
title: Claude Code Integration
description: MCP server exposing IDE tools to Claude Code CLI for file operations, diff review, and editor control.
---

aiTerm exposes an MCP server that Claude Code CLI discovers and connects to automatically, providing IDE-like capabilities without requiring a full IDE.

## How It Works

```
Claude Code CLI ←→ WebSocket/SSE ←→ axum server (Rust) ←→ Tauri events ←→ Frontend (Svelte)
```

The MCP server starts automatically when aiTerm launches (configurable in preferences). It writes a lock file to `~/.claude/ide/` and registers in `~/.claude.json` for automatic discovery by Claude Code.

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
| `openDiff` | Show side-by-side diff for review (blocking) |
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

### Tab Context Discovery

The `getTabContext` tool lets Claude Code peek at what's happening in your tabs — recent terminal output or editor file content. If you have fewer than 10 tabs, it automatically returns context for all of them, making it easy for Claude to find the right tab without you having to specify. For larger workspaces, you can pass specific tab IDs.

## Claude Code Triggers

aiTerm ships with 6+ built-in triggers designed for Claude Code workflows:

- **Auto-capture session IDs** — detects Claude's resume commands and session UUIDs
- **Auto-resume** — automatically reconnects to your last Claude session when you open a tab
- **Question detection** — notifies when Claude asks "Do you want to proceed?"
- **Plan ready** — alerts when Claude has a plan ready for review
- **Context compaction** — notifies during and after context compaction
- **Tab state awareness** — know at a glance which tabs have Claude waiting for input

## Dev/Production Isolation

Dev builds register as `aiterm-dev` with display name "aiTermDev", so development and production instances don't interfere with each other.
