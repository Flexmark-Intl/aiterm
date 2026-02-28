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
