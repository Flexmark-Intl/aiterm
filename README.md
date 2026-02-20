# aiTerm

A terminal emulator built with Tauri 2 + Svelte 5, focused on workspace organization, deep shell integration, and a built-in code editor. Runs on macOS, Windows, and Linux.

## Features

### Terminal
- **xterm.js** — full terminal emulator with scrollback, selection, and WebGL rendering
- **Split panes** — horizontal and vertical splits, drag to resize, fully recursive
- **Multiple workspaces** — named workspaces with independent pane layouts, reorderable via drag and drop
- **Multiple tabs** — per-pane tabs with activity indicators and completion detection
- **Scrollback persistence** — saves and restores terminal state across restarts
- **SSH session cloning** — split an SSH session to get a second shell at the same remote CWD

### Shell Integration
- **OSC 133 (FinalTerm)** — command start/finish detection for tab completion indicators
- **OSC 7** — directory tracking (remote CWD awareness through SSH)
- **OSC 8 file hyperlinks** — `l` command wraps `ls` to emit clickable file links; underline appears on hover
- **`l` shell function** — always available in local shells; also injectable into remote shells via context menu
- **Tab indicators** — completed (✓/✗), at-prompt (›), and activity dot; no spinner (interactive programs stay stable)
- **Remote install** — one-liner session setup or permanent `~/.bashrc`/`~/.zshrc` installation

### Code Editor
- **CodeMirror 6** — full-featured editor in tabs alongside terminal tabs
- **Click to open** — click any file path in terminal output to open it in an editor tab
- **`Cmd+O`** — file dialog that defaults to the active terminal's CWD
- **Local + remote files** — remote files read/written via SCP, transparent to the user
- **Image preview** — PNG, JPG, GIF, WebP, SVG, AVIF, BMP, ICO with zoom controls (fit, +/-, presets)
- **50+ languages** — syntax highlighting via CodeMirror 6 first-class packages and legacy StreamLanguage modes
- **Language detection** — by extension, known filename (`.bashrc`, `Dockerfile`), and shebang line
- **Find/replace** — `Cmd+F`, positioned at top of editor
- **Save** — `Cmd+S` writes local or remote via SCP; dirty indicator in tab
- **Close protection** — inline confirm (no `window.confirm`) for unsaved changes
- **Portal pattern** — editor survives split tree changes (same as terminals)

### Trigger System
- **Regex triggers** — watch terminal output for patterns, fire actions
- **Actions**: `notify` (toast or OS notification), `send_command` (write to PTY), `enable_auto_resume`
- **Variables** — capture groups mapped to named variables (`%varName`), persisted per tab
- **Variable interpolation** — used in tab titles, auto-resume commands, notification bodies
- **Default triggers** — Claude Code resume/session-id triggers built in, configurable

### Notifications
- **Three modes** — `auto` (in-app when focused, OS when not), `in_app`, `native`, `disabled`
- **Toast UI** — max 3 visible, 5s auto-dismiss, Tokyo Night styled
- **Sound alerts** — optional system sound on trigger notifications

### Notes
- **Per-tab notes** — markdown or plain text notes panel per terminal/editor tab
- **Workspace notes** — notes scoped to the whole workspace
- **Interactive checkboxes** — rendered in preview mode
- **Modes** — edit and preview; state persisted per tab

### Workspace Sidebar
- **Sort order** — default (drag and drop), alphabetical, or recent activity
- **Tab count** — optional display of tab count after workspace names
- **Recent workspaces** — collapsible section, toggleable

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New tab |
| `Cmd+W` | Close tab (or pane if last tab) |
| `Cmd+1–9` | Switch to tab |
| `Cmd+Shift+[` | Previous tab |
| `Cmd+Shift+]` | Next tab |
| `Cmd+Shift+T` | Duplicate tab |
| `Cmd+Shift+R` | Reload tab (duplicate + close) |
| `Cmd+D` | Split pane (duplicate tab) |
| `Cmd+N` | New workspace |
| `Cmd+O` | Open file in editor tab |
| `Cmd+S` | Save file (editor tabs) |
| `Cmd+F` | Find/replace (editor tabs) |
| `Cmd+,` | Preferences |
| `Cmd+/` | Help |
| `Cmd+Shift+N` | Notes panel toggle |

## Prerequisites

All platforms require:
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/)

### macOS
- macOS 13+
- Xcode Command Line Tools (`xcode-select --install`)

### Windows
- Windows 10/11
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++" workload
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10/11; bundled by the NSIS installer for end users)

### Linux
- WebKitGTK 4.1, GTK 3, libayatana-appindicator3 (see [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux))

## Development

```bash
# Install dependencies
npm install

# Full app dev (frontend + Rust backend)
npm run tauri:dev

# Frontend only (no Tauri)
npm run dev

# Type checking
npm run check

# Rust compilation check (run from src-tauri/)
cargo check
```

## Building

```bash
npm run tauri:build
```

Build output by platform:

| Platform | Format | Output path |
|----------|--------|-------------|
| macOS | DMG | `src-tauri/target/release/bundle/dmg/` |
| Windows | NSIS installer | `src-tauri/target/release/bundle/nsis/` |
| Linux | .deb | `src-tauri/target/release/bundle/deb/` |

### macOS post-build

After building on macOS, set the DMG volume icon:

```bash
./scripts/set-dmg-icon.sh
```

### CI

GitHub Actions workflows build automatically on push to `main` and on tags:
- `.github/workflows/build-linux.yml` — Ubuntu, produces `.deb`
- `.github/workflows/build-windows.yml` — Windows, produces NSIS `.exe` installer

## Project Structure

```
src/                          # Frontend (Svelte 5 / TypeScript)
├── routes/
│   ├── +layout.svelte        # App shell, keyboard shortcuts, modals
│   └── +page.svelte          # Main terminal/editor view, portal rendering
└── lib/
    ├── components/
    │   ├── editor/           # EditorPane (CodeMirror 6)
    │   ├── terminal/         # TerminalPane, TerminalTabs
    │   ├── workspace/        # WorkspaceSidebar
    │   └── pane/             # SplitPane
    ├── stores/               # Svelte 5 runes stores
    │   ├── workspaces.svelte.ts
    │   ├── terminals.svelte.ts
    │   ├── preferences.svelte.ts
    │   ├── triggers.svelte.ts
    │   ├── activity.svelte.ts
    │   ├── toasts.svelte.ts
    │   └── notificationDispatch.ts
    ├── utils/
    │   ├── editorTheme.ts    # Tokyo Night CodeMirror theme
    │   ├── filePathDetector.ts  # xterm.js link provider
    │   ├── languageDetect.ts    # Extension → language + CM6 loader
    │   ├── openFile.ts          # Orchestrates file open flow
    │   ├── shellIntegration.ts  # Remote shell hook snippets
    │   ├── promptPattern.ts     # PS1-like pattern matching
    │   └── ansi.ts              # ANSI escape stripping
    └── tauri/
        ├── commands.ts       # invoke() wrappers
        └── types.ts          # TypeScript interfaces

src-tauri/src/                # Backend (Rust)
├── lib.rs                    # App setup, command registration
├── commands/
│   ├── workspace.rs          # State CRUD
│   ├── editor.rs             # File read/write, SCP, editor tab creation
│   └── terminal.rs           # PTY spawn/write/resize/kill
├── state/
│   ├── workspace.rs          # Data structures
│   ├── app_state.rs          # Global state container
│   └── persistence.rs        # JSON file storage
└── pty/
    └── manager.rs            # PTY management, shell integration injection
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Svelte 5 (runes), SvelteKit, TypeScript |
| Backend | Rust, Tauri 2 |
| Terminal | xterm.js (FitAddon, SerializeAddon, WebLinksAddon) |
| Editor | CodeMirror 6 |
| PTY | portable-pty |
| State | parking_lot RwLock |

## Data Model

```
Workspace
├── id, name
├── panes: Pane[]
├── active_pane_id
├── split_root: SplitNode (binary tree)
└── notes: WorkspaceNote[]

Pane
├── id, name
├── tabs: Tab[]           # terminal or editor tabs
└── active_tab_id

Tab
├── id, name, custom_name
├── tab_type: 'terminal' | 'editor'
├── pty_id                # terminal tabs
├── editor_file           # editor tabs (path, remote info, language)
├── scrollback
├── notes, notes_open, notes_mode
└── trigger_variables

Trigger
├── pattern (regex), actions, variables
├── enabled, cooldown, workspaces scope
└── default_id            # links to built-in template

Preferences
├── font_size, font_family, cursor_style, cursor_blink
├── clone_*, notification_mode, shell_integration
├── prompt_patterns, triggers
└── workspace sidebar options
```

## Theme

Tokyo Night color scheme:

```css
--bg-dark:   #1a1b26   /* main background */
--bg-medium: #24283b   /* elevated surfaces */
--bg-light:  #414868   /* borders, hover */
--fg:        #c0caf5   /* primary text */
--fg-dim:    #565f89   /* secondary text */
--accent:    #7aa2f7   /* interactive elements */
```
