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
│   │   └── window/           # TerminalWindow
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
│   ├── workspace.rs          # Data structures (Workspace, Window, Tab, Preferences)
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
├── windows: Window[]
├── active_window_id
└── window_sizes (per-layout)

Window
├── id, name
├── tabs: Tab[]
└── active_tab_id

Tab
├── id, name
├── pty_id (links to running terminal)
└── scrollback (serialized terminal state)

Preferences
├── font_size, font_family
├── cursor_style, cursor_blink
├── auto_save_interval, scrollback_limit
```

## Important Conventions

- **Keyboard shortcuts**: Defined in `+layout.svelte` handleKeydown
- **Persistence**: State saved to `~/.aiterm/state.json`
- **Terminal lifecycle**: Created in TerminalPane onMount, PTY spawned immediately
- **Scrollback**: Saved on destroy, periodically (based on preferences), and on app close

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab (or window if last tab) |
| Cmd+1-9 | Switch to tab |
| Cmd+Shift+[ | Previous tab |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+T | New window |
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

- **Rust logs**: Use `eprintln!()` or `log::*` macros, visible in terminal running `tauri dev`
- **Frontend logs**: `console.log()` visible in DevTools (Cmd+Option+I in dev mode)
- **Debug command**: `invoke('debug_log', { message })` logs to Rust stderr
- **State file**: Check `~/.aiterm/state.json` for persisted state

## Common Pitfalls

- **Async in onMount**: Don't make onMount async, use IIFE or fire-and-forget instead
- **Effect cleanup**: Return cleanup function from `$effect()` when setting up intervals/listeners
- **Map reactivity**: When mutating Maps in stores, create new Map: `instances = new Map(instances)`
- **Terminal options**: Can update `terminal.options.*` at runtime, call `fitAddon.fit()` after font changes
- **PTY lifecycle**: Kill PTY in onDestroy, save scrollback before disposal
