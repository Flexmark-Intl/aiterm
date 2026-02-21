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
│   │   ├── editor/           # EditorPane (CodeMirror 6)
│   │   ├── terminal/         # TerminalPane, TerminalTabs
│   │   ├── workspace/        # WorkspaceSidebar
│   │   └── pane/             # SplitPane
│   ├── stores/               # Svelte 5 stores (.svelte.ts)
│   │   ├── workspaces.svelte.ts
│   │   ├── terminals.svelte.ts
│   │   ├── preferences.svelte.ts
│   │   ├── activity.svelte.ts
│   │   ├── triggers.svelte.ts    # Trigger engine (pattern matching, variables)
│   │   ├── toasts.svelte.ts      # In-app toast notification store
│   │   └── notificationDispatch.ts # Routes to toast or OS notification
│   ├── utils/                # Pure utility modules
│   │   ├── shellIntegration.ts  # Remote shell hook snippets
│   │   ├── promptPattern.ts     # PS1 prompt pattern matching
│   │   ├── ansi.ts              # ANSI escape code stripping
│   │   ├── editorTheme.ts       # Tokyo Night CodeMirror 6 theme
│   │   ├── languageDetect.ts    # Extension/filename → language + CM6 loader
│   │   ├── filePathDetector.ts  # xterm.js ILinkProvider for file paths
│   │   └── openFile.ts          # Orchestrates file open (local/remote/editor tab)
│   └── tauri/                # Tauri IPC layer
│       ├── commands.ts       # invoke() wrappers
│       └── types.ts          # TypeScript interfaces matching Rust

src-tauri/src/                # Backend (Rust)
├── lib.rs                    # Tauri app setup, command registration
├── commands/                 # Tauri command handlers
│   ├── workspace.rs          # State CRUD operations
│   ├── editor.rs             # File read/write, SCP, binary/image loading
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
├── split_root: SplitNode (binary tree of pane layout)
└── notes: WorkspaceNote[] (workspace-level notes)

Pane
├── id, name
├── tabs: Tab[]
└── active_tab_id

Tab
├── id, name, custom_name (bool — true if user explicitly renamed)
├── tab_type: 'terminal' | 'editor'
├── pty_id (terminal tabs — links to running PTY)
├── editor_file (editor tabs — EditorFileInfo: file_path, is_remote, remote_ssh_command, remote_path, language)
├── scrollback (serialized terminal state)
├── notes, notes_open, notes_mode (per-tab markdown notes)
└── trigger_variables (persisted variable map from triggers)

SplitNode = SplitLeaf { pane_id } | SplitBranch { id, direction, ratio, children }

Trigger
├── id, name, description, pattern (regex)
├── actions: TriggerActionEntry[] (notify, send_command)
├── variables: VariableMapping[] (capture group → named variable)
├── enabled, cooldown, workspaces (scope filter)
└── default_id (links to app-provided default template, if any)

Preferences
├── font_size, font_family
├── cursor_style, cursor_blink
├── auto_save_interval, scrollback_limit
├── prompt_patterns (PS1-like patterns for remote cwd detection)
├── clone_cwd, clone_scrollback, clone_ssh, clone_history, clone_notes, clone_auto_resume, clone_variables
├── notification_mode (auto, in_app, native, disabled)
├── workspace_sort_order (default, alphabetical, recent)
├── show_workspace_tab_count, show_recent_workspaces
├── triggers: Trigger[]
└── hidden_default_triggers (IDs of deleted app-provided defaults)
```

## Portal Pattern (Terminal Persistence)

When the split tree changes (leaf → split node), Svelte destroys and recreates the entire subtree. To prevent terminals from being killed and recreated:

- **TerminalPanes render flat** at the `+page.svelte` level in a keyed `{#each}` block over all tabs
- **SplitPane renders empty slot divs** with `data-terminal-slot={tab.id}`
- **TerminalPane portals** its `containerRef` into the matching slot via `attachToSlot()`
- **SplitPane dispatches** `terminal-slot-ready` CustomEvents on mount so TerminalPanes can re-attach after splits
- Guard `fitWithPadding` with `containerRef.isConnected` to skip when detached between portal moves

**Do not** move TerminalPane rendering into SplitPane — this breaks terminal persistence on split.

**EditorPane uses the same portal pattern** — `attachToSlot()` portals into `data-terminal-slot={tabId}`, listens for `terminal-slot-ready`, and handles `editor-save` CustomEvents from the layout layer.

## CodeMirror Editor Tabs

Editor tabs (`tab_type === 'editor'`) render `EditorPane.svelte` instead of `TerminalPane.svelte`. They exist alongside terminal tabs in the same pane.

**Key files**:
- `src/lib/components/editor/EditorPane.svelte` — main component
- `src/lib/utils/editorTheme.ts` — Tokyo Night CM6 theme (matches terminal colors)
- `src/lib/utils/languageDetect.ts` — language detection + dynamic CM6 language loader
- `src/lib/utils/openFile.ts` — orchestrates open flow (local vs remote, fetch, tab creation)
- `src-tauri/src/commands/editor.rs` — `read_file`, `write_file`, `read_file_base64`, `scp_read_file`, `scp_write_file`, `scp_read_file_base64`, `create_editor_tab`

**Language loading**: `loadLanguageExtension(langId)` dynamically imports the CM6 language package. First-class packages (js, ts, python, rust, html, css, json, etc.) are preferred; legacy `StreamLanguage` modes cover 30+ additional languages. Detection priority: explicit `editorFile.language` → shebang → file extension → filename.

**Image preview**: `isImageFile()` checks extension; if true, loads via `read_file_base64` / `scp_read_file_base64` and renders with `<img src="data:...">`. Zoom controls: fit-to-window (default), preset steps (10%–500%), +/- buttons.

**Remote files**: SCP commands extracted from the SSH foreground command. Files >2MB or binary (null bytes in first 8KB) are rejected with a user-friendly error toast.

**Search panel**: Uses `search({ top: true })` — positioned at top of editor. Styled via `:global(.cm-panel.cm-search)` CSS in EditorPane.

**Tab insertion**: New editor tabs insert after the currently active tab, not at the end.

## OSC 8 File Hyperlinks (`l` Command)

The `l` shell function wraps `ls -la` and emits OSC 8 hyperlinks (`file://hostname/path`) for each file, making filenames clickable in the terminal.

**Injection**: Always injected via `PROMPT_COMMAND` (bash) or ZDOTDIR shim (zsh) in `pty/manager.rs`, regardless of shell integration preference. Also available in remote shells via `shellIntegration.ts`.

**Multi-file support**: `l Downloads/*.jpg` works — awk branch detects single-dir vs multi-file arguments and resolves each path individually.

**Link handling**: `TerminalPane.svelte` registers a `linkHandler` for `file://` URIs. On activate, calls `openFile()` from `openFile.ts`. Context menu adds "Copy Full Path" for hovered file links (snapshot to `contextMenuLinkUri` at open time — hover `leave` fires before menu interaction).

**Underline behavior**: xterm.js hardcodes `UnderlineStyle.DASHED` for any cell with a `urlId`. We override with `.xterm-underline-5 { text-decoration: none; }` (no `!important` — lets xterm's inline hover style override the class rule). Result: no underline at rest, underline on hover.

**Scrollback cleanup**: The serialize addon emits SGR `4` for OSC 8 linked cells but doesn't preserve `urlId`. On restore, these become orphaned underlines. Stripped before writing to terminal:
```typescript
const cleaned = scrollback.replace(/\x1b\[([0-9;]*)m/g, (_match, params) => {
  const filtered = params.split(';').filter(p => p !== '4' && p !== '24');
  return filtered.length === 0 ? '' : `\x1b[${filtered.join(';')}m`;
});
```

**File path detection**: `filePathDetector.ts` implements xterm's `ILinkProvider`. Only active when Cmd/Ctrl is held (reduces regex overhead). Detects absolute paths, `~/`, `./`, `../`, and relative paths with extensions. Skips `d`-prefixed lines from `ls -l` (directories).

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
- **OSC 133** (FinalTerm): Command completion detection — see Shell Integration below
- **Listener API**: `onOscChange(fn)` for reactive subscriptions (used by TerminalTabs)

## Shell Integration

OSC 133 (FinalTerm protocol) detects command start/finish for tab indicators. Controlled by `shell_integration` preference.

**Protocol**: `A` = prompt start, `B` = command start, `D;exitcode` = command finished

**Local hooks** (Rust `pty/manager.rs`): Injected via env vars / ZDOTDIR shim before the shell starts.

**Remote hooks** (`src/lib/utils/shellIntegration.ts`): Two context menu modes:
- **Setup Shell Integration** — sends a one-liner to the current session (temporary, lost on shell exit). Uses `buildShellIntegrationSnippet()`.
- **Install Shell Integration** — writes clean hook functions to `~/.bashrc` or `~/.zshrc` via heredoc (permanent, idempotent). Uses `buildInstallSnippet()`.

**Tab indicators** (`activity.svelte.ts`): Priority: completed (checkmark/cross) > prompt (›) > activity dot. Shell state only shown on inactive tabs. `B`/`C` sequences clear indicators (new command started), they do NOT show a spinner — long-running interactive programs (SSH, vim) make a "running" state unreliable.

**Bash hook anatomy**:
```
PROMPT_COMMAND="__aiterm_ec=$?; printf D; printf A; printf title; __aiterm_at_prompt=1"
trap '[[ "$__aiterm_at_prompt" == 1 ]] && __aiterm_at_prompt= && printf B' DEBUG
```

**Zsh hook anatomy**: Uses `add-zsh-hook precmd` (for D+A) and `add-zsh-hook preexec` (for B).

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

## Triggers

Triggers watch terminal output for regex patterns and fire actions. Configured in Preferences > Triggers.

- **Engine**: `src/lib/stores/triggers.svelte.ts` — `processOutput()` called from TerminalPane's PTY listener
- **Flow**: raw PTY bytes → redraw detection → ANSI-stripped → buffer (append or replace) → regex match → dedup check → fire
- **Redraw detection**: Raw PTY data is tested for cursor-repositioning sequences (`\e[A`, `\e[H`, `\e[J`) before ANSI stripping. If detected, the buffer is **replaced** (not appended) with the current chunk's stripped text, since TUI redraws overwrite existing content.
- **Dedup**: Tracks last matched text + timestamp per trigger per tab. If the exact same text matches again within 10s (`DEDUP_WINDOW_MS`), the match is consumed from the buffer but the trigger doesn't fire. Prevents TUI apps (Claude Code / Ink) from re-triggering on redrawn content.
- **Buffer consumption**: Matched text is always consumed from the buffer, even when blocked by cooldown or dedup. This prevents stale matches from accumulating and re-firing after cooldown expires.
- **Actions**: `notify` (dispatches via notification system), `send_command` (writes to PTY)
- **Variables**: Capture groups extracted into named variables (`%varName`), persisted per-tab via `trigger_variables`
- **Variable interpolation**: `interpolateVariables(tabId, text)` replaces `%varName` tokens — used in tab titles, auto-resume commands, notification messages
- **Cooldown**: Per-trigger per-tab, prevents rapid re-firing
- **Default triggers**: App-provided templates (e.g. `claude-resume`, `claude-session-id`) with stable `default_id`. Seeded on Preferences page mount. Users can edit them; "Reset" button restores template values. Deleted defaults tracked in `hidden_default_triggers`.

## Notifications

Three-mode notification system controlled by `notification_mode` preference:

- **auto** (default): In-app toasts when window is focused, OS notifications when unfocused
- **in_app**: Always show in-app toasts
- **native**: Always use OS notifications
- **disabled**: No notifications

Architecture: `notificationDispatch.ts` routes `dispatch(title, body, type)` calls based on mode + focus state. Toast UI in `Toast.svelte` (rendered in `+layout.svelte`), store in `toasts.svelte.ts` (max 3 visible, 5s auto-dismiss).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+T | New tab |
| Cmd+W | Close tab (or pane if last tab) |
| Cmd+1-9 | Switch to tab |
| Cmd+Shift+[ | Previous tab |
| Cmd+Shift+] | Next tab |
| Cmd+Shift+T | Duplicate tab |
| Cmd+Shift+R | Reload tab (duplicate + close original) |
| Cmd+D | Split pane (duplicate current tab) |
| Cmd+N | New workspace |
| Cmd+O | Open file in editor tab (native dialog, defaults to terminal CWD) |
| Cmd+S | Save file (editor tabs only) |
| Cmd+F | Find/replace (editor tabs only; terminal search otherwise) |
| Cmd+Shift+N | Toggle notes panel |
| Cmd+, | Preferences |
| Cmd+/ | Help |

**Note**: Cmd+F, Cmd+K, Cmd+S, Cmd+D are intercepted by `+layout.svelte` in capture phase. When the active tab is an editor tab, these are passed through to CodeMirror by checking `activeTabIsEditor` and returning early.

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
- **PROMPT_COMMAND guard flag must be last**: `__aiterm_at_prompt=1` MUST be the final item in PROMPT_COMMAND. If other commands follow it (e.g. title printf), the DEBUG trap fires spuriously during PROMPT_COMMAND and clears shell state.
- **Bash parses all if/elif branches**: Even non-executed branches must be syntactically valid. Zsh function bodies `(){ cmd }` need `; }` to be valid bash syntax.
- **Svelte $effect reactive loops with stores**: `clearFoo()` that reads `$state` inside `$effect` subscribes the effect to that state. Wrap in `untrack()` to prevent re-triggering.
- **OSC 133 replayed from scrollback**: Restored scrollback replays OSC sequences. Gate the OSC 133 handler on `trackActivity` flag (delayed 2s after mount) to ignore stale sequences.
- **`confirm()` doesn't work in Tauri webviews**: Use inline confirmation UI (e.g. "Save / Discard / Cancel" in tab area) instead of `window.confirm()`.
- **Capture-phase keyboard shortcuts intercept CodeMirror**: `+layout.svelte` uses `addEventListener('keydown', handler, true)` (capture). For editor-specific shortcuts (Cmd+F, Cmd+K, Cmd+S, Cmd+D), check `activeTabIsEditor` and return early to let events propagate to CodeMirror.
- **OSC 8 scrollback underlines**: Serialize addon emits SGR 4 for linked cells but strips urlId. Strip `4`/`24` from SGR parameter lists in serialized scrollback before writing to terminal on restore.
- **Hover state cleared before context menu interaction**: If you snapshot reactive hover state when the context menu opens, the `leave` callback fires as the mouse moves to the menu, clearing it. Use a plain (non-reactive) variable for the snapshot, set it at open time.
- **TUI redraws cause false triggers and activity**: TUI apps like Claude Code (Ink) redraw on the normal buffer using cursor-up sequences, sending the same stripped text repeatedly. This re-triggers pattern matches and falsely marks background tabs as active. Detect redraws via `\e[A`, `\e[H`, `\e[J` in the raw PTY data *before* ANSI stripping. In triggers: replace buffer instead of appending. In activity: skip `markActive()`. Note: the redraw check in TerminalPane's PTY listener decodes `data` to string separately from `processOutput()` — acceptable since it only runs for non-visible tabs, but worth consolidating if performance becomes a concern.
- **TUI cursor-up causes viewport scroll jumps**: Ink-style TUI redraws on the normal buffer (not alternate screen) use cursor-up sequences that cause xterm.js to scroll the viewport into the scrollback region. Fix: save `distFromBottom = baseY - viewportY` before `terminal.write()`, restore via `scrollToLine(newBaseY - distFromBottom)` in the write callback. Do NOT use `scrollToBottom()` — that just creates rapid top/bottom flipping.
