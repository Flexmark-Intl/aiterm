# Changelog

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
