# aiTerm

A Tauri-based terminal emulator with workspace organization, built with Svelte 5 and Rust.

## Tech Stack

- **Frontend**: Svelte 5 (runes), SvelteKit, TypeScript, Vite
- **Backend**: Rust, Tauri 2
- **Terminal**: xterm.js with fit, serialize, and web-links addons
- **PTY**: portable-pty for cross-platform pseudo-terminal support
- **State**: parking_lot RwLock for thread-safe Rust state

## Project Structure

```
src/                          # Frontend (Svelte/TypeScript)
├── routes/                   # SvelteKit routes
│   ├── +layout.svelte        # App shell, keyboard shortcuts, modals
│   └── +page.svelte          # Main terminal view
├── lib/
│   ├── components/           # Svelte components
│   │   ├── terminal/         # TerminalPane, TerminalTabs
│   │   ├── workspace/        # WorkspaceSidebar
│   │   └── pane/             # SplitPane
│   ├── stores/               # Svelte 5 stores (.svelte.ts)
│   │   ├── workspaces.svelte.ts
│   │   ├── terminals.svelte.ts
│   │   └── preferences.svelte.ts
│   └── tauri/                # Tauri IPC layer
│       ├── commands.ts       # invoke() wrappers
│       └── types.ts          # TypeScript interfaces matching Rust

src-tauri/src/                # Backend (Rust)
├── lib.rs                    # Tauri app setup, command registration
├── commands/                 # Tauri command handlers
│   ├── workspace.rs          # State CRUD operations
│   └── terminal.rs           # PTY spawn/write/resize/kill
├── state/                    # Application state
│   ├── workspace.rs          # Data structures (Workspace, Pane, Tab, Preferences)
│   ├── app_state.rs          # Global state container
│   └── persistence.rs        # JSON file storage
└── pty/                      # PTY management
    └── manager.rs            # spawn_pty, PTY I/O handling
```

## Commands

```bash
npm run dev          # Start Vite dev server (frontend only)
npm run check        # TypeScript + Svelte type checking
npm run tauri dev    # Full app development (frontend + backend)
npm run tauri build  # Production build
cargo check          # Check Rust compilation (in src-tauri/)
```

## Key Patterns

### Svelte 5 Stores

Stores use the runes API with a factory function pattern:

```typescript
function createMyStore() {
  let value = $state<Type>(initial);

  return {
    get value() { return value; },  // Getter for reactivity

    async setValue(newValue: Type) {
      await commands.setValue(newValue);  // Persist to backend
      value = newValue;                   // Update local state
    }
  };
}

export const myStore = createMyStore();
```

### Tauri Commands

1. Define Rust struct in `state/workspace.rs` with serde derives
2. Add command in `commands/workspace.rs`
3. Register in `lib.rs` invoke_handler
4. Add TypeScript type in `tauri/types.ts`
5. Add wrapper function in `tauri/commands.ts`

### Component Patterns

- **Modals**: Follow `HelpModal.svelte` pattern (backdrop, escape key, close button)
- **Reactive effects**: Use `$effect()` for side effects, return cleanup function if needed
- **Props**: Use `$props()` with TypeScript interface

### Rust State

- All state wrapped in `Arc<AppState>` and managed by Tauri
- Use `state.app_data.read()` for queries, `state.app_data.write()` for mutations
- Always call `save_state(&app_data)` after mutations

## Styling

**Theme**: Tokyo Night color scheme

```css
--bg-dark: #1a1b26;     /* Main background */
--bg-medium: #24283b;   /* Elevated surfaces */
--bg-light: #414868;    /* Borders, hover states */
--fg: #c0caf5;          /* Primary text */
--fg-dim: #565f89;      /* Secondary text */
--accent: #7aa2f7;      /* Interactive elements */
```

Use CSS variables from `app.css`. Component styles are scoped.

## Data Model

```
Workspace
├── id, name
├── panes: Pane[]
├── active_pane_id
└── split_root: SplitNode (binary tree of pane layout)

Pane
├── id, name
├── tabs: Tab[]
└── active_tab_id

Tab
├── id, name, custom_name (bool — true if user explicitly renamed)
├── pty_id (links to running terminal)
└── scrollback (serialized terminal state)

SplitNode = SplitLeaf { pane_id } | SplitBranch { id, direction, ratio, children }

Preferences
├── font_size, font_family
├── cursor_style, cursor_blink
├── auto_save_interval, scrollback_limit
├── prompt_patterns (PS1-like patterns for remote cwd detection)
├── clone_cwd, clone_scrollback, clone_ssh, clone_history
```

## Portal Pattern (Terminal Persistence)

When the split tree changes (leaf → split node), Svelte destroys and recreates the entire subtree. To prevent terminals from being killed and recreated:

- **TerminalPanes render flat** at the `+page.svelte` level in a keyed `{#each}` block over all tabs
- **SplitPane renders empty slot divs** with `data-terminal-slot={tab.id}`
- **TerminalPane portals** its `containerRef` into the matching slot via `attachToSlot()`
- **SplitPane dispatches** `terminal-slot-ready` CustomEvents on mount so TerminalPanes can re-attach after splits
- Guard `fitWithPadding` with `containerRef.isConnected` to skip when detached between portal moves

**Do not** move TerminalPane rendering into SplitPane — this breaks terminal persistence on split.

## Split Cloning (Pane Duplication)

`splitPaneWithContext()` in `workspaces.svelte.ts` handles pane duplication:

1. Serializes scrollback from source terminal
2. Gets PTY info via `getPtyInfo()` — returns local cwd (via lsof) and foreground SSH command (via process tree)
3. Creates new pane with scrollback pre-populated
4. Copies shell history (`copyTabHistory`)
5. Stores split context for the new TerminalPane to consume on mount

### SSH Session Cloning

When source has active SSH, `buildSshCommand()` in TerminalPane.svelte constructs:
```
ssh -t user@host 'cd ~/path && exec $SHELL -l'
```
- Atomic: cd + shell exec happen before prompt appears
- Works with interactive password prompts (auth is during SSH handshake)

### Remote CWD Detection

Priority: OSC 7 (if not stale) → prompt pattern heuristic.

**Stale OSC 7 detection**: Compare OSC 7 cwd with lsof-reported local cwd. If equal, OSC 7 is stale (set by local shell before SSH started).

**Prompt patterns**: User-configurable in Preferences > Shell. PS1-like format compiled to RegExp at runtime. See `src/lib/utils/promptPattern.ts`.

| Placeholder | Meaning | Compiles to |
|-------------|---------|-------------|
| `\h` | hostname | `\S+` |
| `\u` | username | `\S+` |
| `\d` | directory (capture group) | `(.+?)` |
| `\p` | prompt char ($#%>) | `[$#%>]` |

### Shell Escaping

`shellEscapePath()` handles quoting for remote shells:
- `~` left unquoted for expansion, rest single-quoted: `~/path` → `~/'path'`
- Single quotes in paths escaped as `'\''`

## OSC State

`terminals.svelte.ts` manages per-terminal OSC state (title, cwd, cwdHost):

- **OSC 0/2** (title): Updates tab display name unless `tab.custom_name` is true
- **OSC 7** (cwd): Parses `file://hostname/path` URL, stores both cwd and cwdHost
- **Listener API**: `onOscChange(fn)` for reactive subscriptions (used by TerminalTabs)

## Dev/Production Isolation

Dev and production builds use **separate data directories** so they can run simultaneously without state corruption:

- **Dev** (`tauri dev`): `~/Library/Application Support/com.aiterm.dev/`
- **Production** (`tauri build`): `~/Library/Application Support/com.aiterm.app/`

Controlled by `cfg!(debug_assertions)` in `state/persistence.rs` → `app_data_slug()`. The window title is set to "aiTerm (Dev)" in debug builds, and the sidebar shows a DEV badge via `+layout.svelte` exposing an `isDevMode` flag.

**Do not** hardcode `com.aiterm.app` anywhere — always use `app_data_slug()` in Rust. State files, backups, and temp files all derive their paths from this slug.

## Important Conventions

- **Keyboard shortcuts**: Defined in `+layout.svelte` handleKeydown
- **Persistence**: State saved to `<data_dir>/<app_slug>/aiterm-state.json` (see Dev/Production Isolation above)
- **Terminal lifecycle**: Created in TerminalPane onMount, PTY spawned immediately
- **Scrollback**: Saved on destroy, periodically (based on preferences), and on app close

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab (or pane if last tab) |
| Cmd+1-9 | Switch to tab |
| Cmd+Shift+[ | Previous tab |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+T | New pane |
| Cmd+N | New workspace |
| Cmd+, | Preferences |
| Cmd+/ | Help |

## xterm.js Notes

- Terminal created with `new Terminal(options)` in TerminalPane
- Required addons: FitAddon (resize), SerializeAddon (scrollback), WebLinksAddon (clickable links)
- Call `fitAddon.fit()` after container resize or font changes
- Options can be updated at runtime via `terminal.options.propertyName`
- Serialize scrollback with `serializeAddon.serialize()` for persistence

## Type Safety

- Rust structs and TypeScript interfaces must stay in sync
- Use `snake_case` for Rust/serde, same in TypeScript (not camelCase)
- Tauri commands return `Result<T, String>` for error handling

## Adding a New Feature Checklist

### New Tauri Command
1. [ ] Add/modify struct in `src-tauri/src/state/workspace.rs`
2. [ ] Add command function in `src-tauri/src/commands/workspace.rs`
3. [ ] Register command in `src-tauri/src/lib.rs` generate_handler!
4. [ ] Export types from `src-tauri/src/state/mod.rs` if new
5. [ ] Add TypeScript interface in `src/lib/tauri/types.ts`
6. [ ] Add invoke wrapper in `src/lib/tauri/commands.ts`
7. [ ] Run `cargo check` and `npm run check`

### New Store
1. [ ] Create `src/lib/stores/mystore.svelte.ts`
2. [ ] Use factory function pattern with `$state` runes
3. [ ] Export getters for reactive access
4. [ ] Call Tauri commands in async methods

### New Modal
1. [ ] Create component following `HelpModal.svelte` pattern
2. [ ] Add state variable in `+layout.svelte`
3. [ ] Add keyboard shortcut in handleKeydown
4. [ ] Render modal at bottom of `+layout.svelte`

## Debugging

### Logging

Uses `tauri-plugin-log` — all logs go to a log file, stdout, and (in dev) browser devtools via `attachConsole()`. Rust and frontend share the same log file.

**Rust** — use `log` crate macros (no `use` needed, `log` is a dependency):
```rust
log::info!("Loading state from {:?}", path);
log::warn!("Backup failed: {}", e);
log::error!("Fatal: {}", e);
log::debug!("Verbose detail");  // only appears in dev builds
```

**Frontend** — import from `@tauri-apps/plugin-log`:
```typescript
import { error, info, warn, debug } from '@tauri-apps/plugin-log';
error(`Failed to spawn PTY: ${e}`);
info('State loaded');
```

Do **not** use `eprintln!()` or `console.error()` — they bypass the log file and are invisible in production.

### Log file locations

| OS | Dev | Prod |
|----|-----|------|
| **macOS** | `~/Library/Logs/com.aiterm.app/aiterm-dev.log` | `~/Library/Logs/com.aiterm.app/aiterm.log` |
| **Linux** | `~/.config/aiterm/logs/aiterm-dev.log` | `~/.config/aiterm/logs/aiterm.log` |
| **Windows** | `%APPDATA%\aiterm\logs\aiterm-dev.log` | `%APPDATA%\aiterm\logs\aiterm.log` |

### Reading logs during development

Logs also stream to stdout (the terminal running `npm run tauri dev`). To tail the log file directly:

```bash
# macOS
tail -f ~/Library/Logs/com.aiterm.app/aiterm-dev.log

# Linux
tail -f ~/.config/aiterm/logs/aiterm-dev.log

# Windows (PowerShell)
Get-Content "$env:APPDATA\aiterm\logs\aiterm-dev.log" -Wait
```

In dev builds, Rust-side logs also appear in the browser devtools console (via the `Webview` target + `attachConsole()` in `+layout.svelte`).

### State file

Check `~/Library/Application Support/com.aiterm.dev/aiterm-state.json` (dev) or `com.aiterm.app/` (prod)

## Common Pitfalls

- **Async in onMount**: Don't make onMount async, use IIFE or fire-and-forget instead
- **Effect cleanup**: Return cleanup function from `$effect()` when setting up intervals/listeners
- **Map reactivity**: When mutating Maps in stores, create new Map: `instances = new Map(instances)`
- **Terminal options**: Can update `terminal.options.*` at runtime, call `fitAddon.fit()` after font changes
- **PTY lifecycle**: Kill PTY in onDestroy, save scrollback before disposal
- **Single quotes prevent ~ expansion**: `cd '~/path'` fails on remote. Use `cd ~/'path'` instead
- **`\u` in Svelte templates**: Interpreted as unicode escape. Use expression syntax: `{'\\u'}`
- **Stale OSC 7 on SSH**: Local shell sets OSC 7 cwd before SSH starts. If remote doesn't emit OSC 7, the local value persists — compare with lsof cwd to detect
- **Shell escaping layers**: JS → local shell → SSH → remote shell. `$SHELL` must not be escaped (remote needs to expand it). Single quotes protect from local expansion but prevent ~ expansion
