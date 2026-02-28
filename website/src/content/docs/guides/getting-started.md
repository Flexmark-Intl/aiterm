---
title: Getting Started
description: Install aiTerm and get up and running on macOS, Windows, or Linux.
---

## Download

Download the latest release from the [GitHub Releases page](https://github.com/Flexmark-Intl/aiterm/releases).

| Platform | Format |
|----------|--------|
| macOS | DMG |
| Windows | NSIS installer (.exe) |
| Linux | .deb package |

## Prerequisites (Building from Source)

If you want to build aiTerm from source, you'll need:

**All platforms:**
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)

**macOS:**
- macOS 13+
- Xcode Command Line Tools (`xcode-select --install`)

**Windows:**
- Windows 10/11
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++" workload
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11)

**Linux:**
- WebKitGTK 4.1, GTK 3, libayatana-appindicator3
- See [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)

## First Launch

1. Open aiTerm
2. You'll start with a default workspace and a single terminal tab
3. The terminal spawns your default shell automatically

## Quick Tips

- **Cmd+T** — new tab
- **Cmd+D** — split pane (duplicates current tab with full context)
- **Cmd+N** — new workspace
- **Cmd+,** — open preferences
- **Cmd+/** — help and keyboard shortcuts

## Setting Up Claude Code Integration

Claude Code integration is enabled by default. When you run `claude` in a terminal tab, aiTerm automatically:

1. Exposes MCP tools to Claude Code CLI
2. Captures session IDs via built-in triggers
3. Enables auto-resume for your sessions

No configuration needed — it just works.
