---
title: Building from Source
description: How to build aiTerm for development and production.
---

## Development

```bash
# Clone the repository
git clone https://github.com/Flexmark-Intl/aiterm.git
cd aiterm

# Install dependencies
npm install

# Full app dev (frontend + Rust backend + MCP bridge)
npm run tauri:dev

# Frontend only (no Tauri)
npm run dev

# Type checking
npm run check

# Rust compilation check (run from src-tauri/)
cd src-tauri && cargo check
```

`npm run tauri:dev` enables the MCP bridge feature and applies dev-specific configuration automatically.

## Production Build

```bash
npm run tauri:build
```

### Build Output

| Platform | Format | Output Path |
|----------|--------|-------------|
| macOS | DMG | `src-tauri/target/release/bundle/dmg/` |
| Windows | NSIS installer | `src-tauri/target/release/bundle/nsis/` |
| Linux | .deb | `src-tauri/target/release/bundle/deb/` |

### macOS Post-Build

After building on macOS, set the DMG volume icon:

```bash
./scripts/set-dmg-icon.sh
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5 (runes), SvelteKit, TypeScript |
| Backend | Rust, Tauri 2 |
| Terminal | xterm.js (FitAddon, SerializeAddon, WebLinksAddon) |
| Editor | CodeMirror 6 (+ MergeView for diffs) |
| PTY | portable-pty |
| State | parking_lot RwLock |

## Dev/Production Isolation

Dev and production builds use separate data directories so they can run simultaneously:

- **Dev**: `~/Library/Application Support/com.aiterm.dev/`
- **Production**: `~/Library/Application Support/com.aiterm.app/`

The window title shows "aiTerm (Dev)" in debug builds, and the sidebar displays a DEV badge.
