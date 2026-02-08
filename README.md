# aiTerm - macOS Terminal Organizer

A Tauri 2.x + Svelte 5 application that wraps terminal functionality with workspace-based organization.

## Features

- **Workspaces**: Named groups containing terminal windows
- **Windows**: Named windows within workspaces, each with multiple tabs
- **Tabs**: xterm.js-based terminal tabs within each window
- **Tokyo Night theme**: Beautiful dark theme for terminals
- **State persistence**: Automatically saves and restores your workspace layout

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New tab in focused window |
| `Cmd+Shift+T` | New window in current workspace |
| `Cmd+N` | New workspace |
| `Cmd+W` | Close current tab |
| `Cmd+1-9` | Switch to tab 1-9 |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- macOS 10.15+

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Project Structure

```
aiterm/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri IPC commands
│   │   ├── pty/            # PTY management with portable-pty
│   │   └── state/          # App state and persistence
│   └── tauri.conf.json
│
├── src/                    # Svelte frontend
│   ├── routes/             # SvelteKit routes
│   └── lib/
│       ├── components/     # UI components
│       ├── stores/         # Svelte 5 runes stores
│       └── tauri/          # Tauri IPC wrappers
```

## Tech Stack

- **Frontend**: Svelte 5, SvelteKit, xterm.js
- **Backend**: Rust, Tauri 2.x, portable-pty
- **Styling**: Custom CSS with Tokyo Night color scheme
