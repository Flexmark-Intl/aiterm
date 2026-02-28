---
title: Terminal
description: Full-featured terminal emulator with xterm.js, scrollback persistence, and shell integration.
---

aiTerm's terminal is built on xterm.js with WebGL rendering, providing a fast and capable terminal experience.

## Core Features

- **xterm.js** — full terminal emulator with scrollback, selection, and WebGL rendering
- **Split panes** — horizontal and vertical splits, drag to resize, fully recursive binary tree layout
- **Multiple tabs** — per-pane tabs with activity indicators and completion detection
- **Scrollback persistence** — saves and restores terminal state across restarts
- **SSH session cloning** — split an SSH session to get a second shell at the same remote CWD
- **Multi-window** — open additional windows, duplicate windows with full tab context
- **Per-tab command history** — each tab maintains its own shell history, cloned tabs inherit it

## Shell Integration

aiTerm supports the FinalTerm protocol (OSC 133) for command start/finish detection:

- **Tab indicators** — completed (checkmark/cross), at-prompt (›), and activity dot
- **OSC 7** — directory tracking, including remote CWD awareness through SSH
- **OSC 8 file hyperlinks** — the `l` command wraps `ls` to emit clickable file links
- **Remote install** — one-liner session setup or permanent `~/.bashrc`/`~/.zshrc` installation

## Tab Names

Tabs auto-update from terminal titles (OSC 0/2), but you can override with your own name — or combine both. Rename a tab "billing API debug" and it stays that way even as the terminal title changes underneath.

## Deep Clone Everything

Duplicate a tab and get *everything*: scrollback history, CWD, SSH session, Claude resume command, tab name, notes, trigger variables. Or shallow clone for just the name and CWD. New tabs automatically inherit the workspace's most common working directory.

## Archive and Restore

Done with a session but not ready to lose it? Archive the tab. It disappears from your tab bar but preserves everything — scrollback, notes, trigger state. Restore it later and resume right where you left off.
