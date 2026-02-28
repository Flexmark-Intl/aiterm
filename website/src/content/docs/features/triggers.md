---
title: Triggers & Automation
description: Regex triggers that watch terminal output and fire actions — notifications, commands, and variable capture.
---

Triggers watch your terminal output for patterns and fire actions automatically. They're the backbone of aiTerm's Claude Code integration, but work for any terminal workflow.

## How Triggers Work

1. Terminal output is stripped of ANSI escape codes
2. Output is buffered per-tab (with TUI redraw detection)
3. Regex patterns are tested against the buffer
4. Matching text fires configured actions
5. Matched text is consumed from the buffer

## Match Modes

- **Regex** — full regular expression matching (default)
- **Plain text** — simple substring matching
- **Variable condition** — evaluates expressions using captured variables

### Variable Conditions

Expression parser supporting complex conditions:

```
sessionId && !resumed
status == "waiting"
a || b && c
x != "done"
```

Operators: `&&`, `||`, `!`, `==`, `!=`

## Actions

| Action | Description |
|--------|-------------|
| `notify` | Send a notification (toast or OS notification) |
| `send_command` | Write a command to the PTY |
| `enable_auto_resume` | Enable auto-resume for the tab |
| `set_tab_state` | Set the tab's state indicator |

## Variables

Capture groups in regex patterns can be mapped to named variables:

- Variables are persisted per-tab in `trigger_variables`
- Referenced with `%varName` syntax
- Used in tab titles, auto-resume commands, notification messages
- Cloned when duplicating tabs

## Built-in Triggers

aiTerm ships with default triggers for Claude Code workflows:

| Trigger | Purpose |
|---------|---------|
| `claude-resume` | Captures `claude --resume` command |
| `claude-session-id` | Extracts UUID from `/status` output |
| `claude-question` | Detects "Do you want to proceed?" prompts |
| `claude-plan-ready` | Detects plan ready message |
| `claude-compacting` | Notifies during context compaction |
| `claude-compaction-complete` | Alerts when compaction finishes |
| `claude-auto-resume` | Variable-mode trigger for auto-resume |

Default triggers are seeded automatically and can be customized or deleted. Deleted defaults are tracked so they don't reappear.

## Notifications

Triggers can fire notifications through aiTerm's three-mode notification system:

- **Auto** (default) — in-app toasts when window is focused, OS notifications when not
- **In-app** — always show in-app toasts
- **Native** — always use OS notifications
- **Disabled** — no notifications

Notifications support deep-linking — clicking a toast or OS notification navigates to the source workspace and tab. Sound alerts are configurable with volume control.
