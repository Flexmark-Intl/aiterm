# TODO — Unhandled OSC Escape Sequences

OSC (Operating System Command) sequences are sent by shells and programs to communicate metadata to the terminal emulator. We currently handle OSC 0/2 (title) and OSC 7 (cwd). Below are the remaining useful sequences we could support.

## High Priority

### OSC 133 — Shell Integration (Semantic Prompts)
FinalTerm / iTerm2 protocol. Marks prompt, command, and output boundaries:
- `\e]133;A\e\\` — Prompt start
- `\e]133;B\e\\` — Command start (user pressed Enter)
- `\e]133;C\e\\` — Command output start
- `\e]133;D;exitcode\e\\` — Command finished with exit code

**Use cases:**
- Select entire command output with one click/shortcut
- Scroll between prompts (Cmd+Up/Down like iTerm2)
- Dim or collapse previous command outputs
- Show exit code badge on failed commands
- "Re-run last command" feature
- Accurate command timing

### OSC 9 — Desktop Notifications (iTerm2)
`\e]9;message\e\\` — Trigger a system notification.

**Use cases:**
- Notify when a long-running command finishes (e.g. `make && echo -e '\e]9;Build done\e\\'`)
- Could auto-detect long commands and notify on completion (paired with OSC 133)

### OSC 52 — Clipboard Access
`\e]52;c;base64data\e\\` — Read/write system clipboard.

**Use cases:**
- Programs like tmux, vim, or remote SSH sessions can copy to the local clipboard
- Should prompt user for permission (security-sensitive)

## Medium Priority

### OSC 8 — Hyperlinks
`\e]8;params;uri\e\\text\e]8;;\e\\` — Inline clickable hyperlinks.

Already partially handled by xterm.js `WebLinksAddon` (URL auto-detection), but OSC 8 allows programs to emit explicit hyperlinks with custom display text (e.g. `git log --format` with clickable commit hashes). Would need `@xterm/addon-web-links` configuration or a custom handler.

### OSC 1 — Icon Name
`\e]1;name\e\\` — Sets the icon name (separate from window title).

Low effort to add (same as OSC 0/2), but limited practical use in a tab-based terminal. Could show as a tooltip or secondary label.

### OSC 4 — Color Palette
`\e]4;index;color\e\\` — Change or query a palette color (0–255).

**Use cases:**
- Programs that customize terminal colors (e.g. base16-shell)
- Query support lets programs detect the current theme

### OSC 10/11/12 — Foreground/Background/Cursor Color
- `\e]10;color\e\\` — Set/query foreground color
- `\e]11;color\e\\` — Set/query background color
- `\e]12;color\e\\` — Set/query cursor color

**Use cases:**
- Theme-aware programs can query current colors and adapt
- Programs like `vivid` set LS_COLORS based on background luminance

### OSC 104/110/111/112 — Reset Colors
Reset palette or foreground/background/cursor to defaults. Companion to OSC 4/10/11/12.

## Low Priority

### OSC 1337 — iTerm2 Proprietary
iTerm2-specific extensions. Most useful subset:
- **Inline images:** `\e]1337;File=...:\e\\` — Display images inline in the terminal (used by `imgcat`)
- **Badges:** `\e]1337;SetBadgeFormat=base64\e\\` — Persistent label on the terminal (e.g. "production")
- **Marks:** `\e]1337;SetMark\e\\` — Scrollback bookmark
- **User vars:** `\e]1337;SetUserVar=key=base64value\e\\` — Arbitrary key-value metadata

### OSC 777 — rxvt-unicode Notifications
`\e]777;notify;title;body\e\\` — Desktop notification (alternative to OSC 9).

### OSC 99 — Kitty Notifications
Kitty terminal notification protocol. More structured than OSC 9.
