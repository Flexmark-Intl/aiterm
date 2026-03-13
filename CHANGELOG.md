# Changelog

## v1.7.1

- Fix blank Preferences and Help windows on Windows (SvelteKit trailingSlash routing)
- Fix auto-resume command migration to catch additional old command patterns

## v1.7.0 — Performance overhaul for heavy workloads

- Move terminal backend to alacritty_terminal — all VTE parsing and buffer management in Rust, xterm.js as thin renderer (~60fps ANSI frames)
- Move scrollback persistence from JSON state to SQLite (WAL mode) — crash-safe, state file drops from ~25MB to ~32KB
- Fix critical UTF-8 corruption in scrollback restore (multi-byte chars split into C1 control sequences)
- Reduce scrollback memory pressure with dirty tracking and staggered saves
- Add lazy terminal tab activation — only spawn PTYs when tab becomes active
- Add workspace suspend/resume with auto-suspend timeout, sidebar controls, and context menus
- Add Claude Code hooks integration — replace trigger-based tracking with HTTP hooks (PreToolUse, PostToolUse, PreCompact, SessionStart/End, Stop, Notification)
- Add SSH MCP bridge — reverse tunnel for remote IDE tools with ControlMaster mux support and bridge status indicator
- Add Streamable HTTP MCP transport (POST /mcp), replacing legacy SSE
- Add per-monitor-count window geometry persistence with auto-repositioning on monitor changes
- Add remote file watching via SSH stat polling with host batching and backoff
- Add Claude session MCP tools (getClaudeSessions) for multi-agent coordination
- Add third-party license generation for Rust and npm dependencies
- Add UI font size preference with proportional rem-based scaling
- Improve notification system: sequential toast countdown, window focus awareness, dual toast + OS when unfocused
- Migrate auto-resume from triggers to hooks with old pattern detection and auto-migration
- Fix Preferences and Help windows not loading in production builds (missing .html extension)

## v1.6.2

- Preserve PTY when moving tabs between workspaces (drag to another workspace keeps the running session)
- Add multi-window MCP awareness with AITERM_TAB_ID env var and per-window event routing
- Add listWindows MCP tool and windowId parameter to listWorkspaces
- Graceful MCP server shutdown on app exit to release TCP port
- Improve import preview grouping for multi-window backups

## v1.6.1

- Add app diagnostics MCP tools (getDiagnostics, readLogs) with PTY stats, memory tracking, and trigger counters
- Add import preview modal with workspace selection, overwrite/merge modes, and gz backup support
- Improve backup import with deep merge, visual highlights for merged items, and ordering preservation
- Add PTY diagnostics and fix PTY leak on HMR remount
- Fix Cmd+Shift+R reloading wrong window's tab in multi-window
- Fix notes panel input reset by untracking local state in sync effects

## v1.6.0

- Add state backup/import with automatic daily backups and manual export
- Add editor file watching — detect external changes and prompt to reload
- Overhaul auto-resume: pin settings per tab, SSH session replay, edit menu, Cmd+Opt+R shortcut
- Add `replay_auto_resume` trigger action and context menu option

## v1.5.0

- Add tab-level scoping to triggers for per-tab pattern matching
- Expose preferences via MCP tools, rename Panels to Tabs in preferences UI
- Fall back to persisted auto-resume SSH when live PTY has no SSH on reload
- Clear trigger buffer when suppression window ends to prevent stale matches
- Sync PTY size on tab visibility, expand remote tilde paths

## v1.4.4

- Let CodeMirror handle all keyboard shortcuts when editor/diff tabs are active
- Add Editor section to help window with VS Code-style shortcuts
- Flatten help panel sections to use headings instead of accordions
- Keep tab bar visible when all tabs are closed

## v1.4.3

- Add findNotes MCP tool to search all tabs and workspaces for notes in one call
- Add auto-resume and trigger variable MCP tools (setTriggerVariable, getTriggerVariables, setAutoResume, getAutoResume)
- New tabs inherit the most common CWD/SSH setup from sibling tabs in the pane
- Add number-duplicated-tabs preference to control numeric prefix on duplicated tab names
- New workspaces insert after the active workspace instead of appending to end
- Fix TUI redraw dedup timestamp refresh to prevent false trigger re-fires

## v1.4.2

- Manage WebGL contexts per-terminal visibility lifecycle to stay within browser context limits
- Fix modifier tab buttons resizing without hover
- Extend auto-resume trigger suppression to 15s for SSH + Claude startup

## v1.4.1

- Add WebGL renderer for GPU-accelerated terminal rendering

## v1.4.0

- Add workspace, tab, and notes MCP tools with tab context discovery for Claude Code integration
- Add Cmd+/ passthrough to CodeMirror for toggle comment in editor tabs
- UI polish: tab button modes, workspace badges, IconButton fixes, delete confirmation
- Fix editor tab dirty indicator not clearing after save

## v1.3.4

- Convert Help from modal to standalone window with sidebar navigation
- Add About aiTerm dialog with credits and copyright
- Add Help menu with Report Bug and Feature Request links
- Add Preferences and Help buttons to sidebar footer

## v1.3.3

- Default file link click behavior to Cmd/Ctrl+Click, add Alt/Opt+Click option
- Fix auto-resume trigger overwriting custom commands; tab button now appends instead of replacing
- Fix invisible delete workspace button on hover
- Pin Linux CI to Ubuntu 22.04 for broader compatibility

## v1.3.2

- Fix Claude Code refusing to launch inside aiTerm ("cannot be launched inside another Claude Code session")

## v1.3.1

- Fix claude-resume trigger not matching session names that contain escaped quotes

## v1.3.0

- Add PDF viewer for editor tabs with page navigation
- Add markdown preview toggle for editor tabs with word wrap support
- Add file-type icons on editor/diff tabs (code, image, PDF, markdown)
- Add editor tab archive support with categorized dropdown (terminals, editors, diffs)
- Add editor tab reload and dirty indicator for unsaved changes
- Add OS notification deep-linking: clicking a notification navigates to the source tab
- Add file link click behavior preference (click, Cmd+click, or disabled)
- Add `COLORTERM=truecolor` to remote shell integration snippets
- Improve editor search match and selection visibility
- Fix editor horizontal scroll by constraining terminal-slot width
- Fix markdown relative image paths in preview mode
- Use `aiTermDev` as display name in dev builds for IDE integration

## v1.2.4

- Migrate existing auto-resume tabs to include SSH/CWD context on load
- Repair pre-interpolated auto-resume commands that contained stale variable values

## v1.2.3

- Fix auto-resume SSH context loss and show connection info in prompt

## v1.2.2

- Auto-update unmodified default triggers on app load when templates change
- Suppress trigger actions during post-mount scrollback restore
- Make file path detection always active with pre-compiled regex
- Restrict CI builds to version tags only

## v1.2.1

- Fix variable triggers not re-firing when captured values change
- Skip trigger variable cloning on shallow tab duplicates
- Persist OSC title as tab name so restarts show last-known title
- Include version in CI artifact names for Linux and Windows builds

## v1.2.0

- Add tab archiving: soft-close tabs with restore, sorted by recency with relative timestamps
- Add dynamic editor/diff themes based on active terminal theme
- Add Windows shell selection preference and prompt patterns
- Add auto-resume command migration for existing tabs
- New tabs open at the most common CWD among workspace tabs
- Switch to newly duplicated tab after clone
- Extract reusable IconButton, Button, and StatusDot components
- Add themed tooltip support to StatusDot and IDE Connected indicator
- Add copy button and text selection to editor error messages
- Adapt logo brightness for light themes
- Fix Solarized Light theme colors
- Fix DiffPane scroll/layout, viewport locking, and trigger dedup
- Fix legacy language modes not loading in production builds
- Fix Windows PTY lag, hang on quit, multi-window freeze, and close button
- Fix Linux process introspection: use `/proc` for CWD, correct `ps` flags
- Isolate dev/production MCP server registration in `~/.claude.json`
- Preserve original tab name through archive/restore cycle

## v1.1.0

- Add Claude Code IDE integration: WebSocket server for open-file/open-diff commands, connected status in sidebar
- Add diff editor tab using CodeMirror merge view
- Add Linux and Windows bundling support with platform guards
- Add GitHub Actions CI workflow for cross-platform builds
- Add NSIS installer config for Windows
- Add workspace `default_command` preference
- Default to PowerShell on Windows, skip shell integration hooks
- Gate Unix-specific PTY code (`lsof`, `ps`, shell hooks) with `#[cfg(unix)]`
- Gate macOS-specific window APIs (hidden title, title bar style) to macOS only
- Add editor registry for cross-component editor instance access

## v1.0.0

- Add CodeMirror 6 editor tabs: open files from terminal output or via `Cmd+O`, syntax highlighting for 30+ languages
- Add image preview in editor tabs with zoom controls for local and remote files
- Add OSC 8 file hyperlinks: `l` shell function emits clickable file links in terminal
- Add variable-match triggers with condition expressions (`&&`, `||`, `!`, `==`, `!=`)
- Add `enable_auto_resume` trigger action for automatic Claude Code auto-resume
- Add Claude Code integration modal with default triggers for session management
- Add workspace-level notes alongside tab-level notes
- Add workspace sidebar preferences: sort order, tab count display, recent workspaces toggle
- Add notification sounds for trigger alerts
- Add deeper OSC integration and tab state indicators
- Remove prompt indicator from tabs; gate completion indicator on minimum duration
- Close tab now selects previous (left) tab instead of next
- Editor tabs support split pane via `Cmd+D`
- File path link provider only active while `Cmd/Ctrl` held
- Strip orphaned SGR 4 underline from serialized scrollback
- `Cmd+O` file dialog defaults to active terminal CWD

## v0.9.0

- Add trigger system: watch terminal output for regex patterns, fire actions (notify, send command)
- Add trigger variables: capture groups extracted into named variables with `%varName` interpolation
- Add default triggers for Claude Code (`claude-resume`, `claude-session-id`)
- Overhaul notification system: three modes (auto, in-app, native, disabled) with in-app toast UI
- Add reusable Toggle, Select, and InlineConfirm components
- Add trigger management UI in Preferences
- Fix tab rename incorrectly setting `custom_name` when exiting edit mode without changes

## v0.8.3

- Redesign tab styling: full border for active tab, colored underline for activity indicators

## v0.8.2

- Persist notes panel open/closed state per tab across sessions
- Fix titlebar window dragging when notes panel is open

## v0.8.1

- Add centered workspace name to macOS title bar
- Improve notes panel: interactive checkboxes in rendered mode, better default styling and contrast

## v0.8.0

- Add notes panel per tab with source/rendered mode toggle
- Add notes preferences (font size, font family, width, word wrap)
- Add `Cmd+Shift+N` keyboard shortcut to toggle notes panel
- Show indicator dot on tabs with notes content

## v0.7.1

- Add macOS menu items for Preferences, Reload All Windows, and Reload Current Window
- Add recent workspaces section to sidebar
- Add `%title` support for tab names via clickable URLs
- Ignore small PTY writes for tab activity detection

## v0.7.0

- Add auto-resume support for local (non-SSH) terminals
- Rename internal "pin" terminology to "auto-resume" (backward-compatible)
- Add `Cmd+R` keyboard shortcut to toggle auto-resume
- Add auto-resume command prompt as textarea with autogrow and manual resize
- Persist remembered auto-resume command across enable/disable cycles
- Add `Cmd+click` on duplicate tab button to skip scrollback
- Replace duplicate tab SVG icon with Unicode character
- Add changelog modal (click version number in sidebar)

## v0.6.0

- Fix SSH `ControlMaster auto` causing "socket already exists" warnings on restore
- Add tab rename UX improvements (double-click to rename, clear to reset)
- Add Tauri MCP bridge for dev automation (feature-gated, excluded from production)

## v0.5.0

- Internal release (no user-facing changes)

## v0.4.0

- Add OSC 133 shell integration for command completion detection
- Add tab indicators: completed (checkmark/cross), prompt, activity dot
- Add preferences window with shell integration settings
- Add remote shell integration install command (permanent, writes to rc file)
- Remove running spinner (unreliable with interactive programs like SSH, vim)
- Fix remote OSC 133 sequence handling

## v0.3.1

- Add workspace activity indicator in sidebar
- Fix terminals killed on workspace switch (lazy activation pattern)
- Fix terminal re-attachment after split tree changes
- Fix alternate screen artifacts in restored scrollback
- Add DMG icon stamping and limit bundle to DMG-only

## v0.3.0

- Add multi-window support with independent workspaces per window
- Add session restore (persist and restore terminal state across app restarts)
- Add structured logging with tauri-plugin-log
- Isolate dev/production data directories
- Add drag tab to workspace and custom theme editor
- Add built-in theme system with 10 themes
- Add sidebar collapse
- Add tab drag/drop reordering and shell title integration
- Add configurable duplication preferences for split pane cloning
- Add OSC 7 support for accurate cwd detection on split
- Add custom prompt patterns for remote cwd detection
- Add iTerm2-style recursive split panes with context cloning
- Add file drag-drop and clipboard file paste
- Add find-in-terminal (Cmd+F) and font zoom (Cmd+/-)
- Add right-click context menu with iTerm2-style Cmd+C/V
- Add background tab activity indicator
- Add app icon, titlebar logo, loading screen, and favicon
- Fix data-loss bugs, resource leaks, and security issues

## v0.1.0

- Initial release: Tauri-based terminal emulator with workspace organization
- Workspaces, panes, tabs
- xterm.js terminal with fit, serialize, and web-links addons
- Scrollback persistence
