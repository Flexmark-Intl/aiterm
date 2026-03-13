# Triggers System

Triggers watch terminal output for regex patterns and fire actions. Configured in Preferences > Triggers.

## Architecture

- **Engine**: `src/lib/stores/triggers.svelte.ts` — `processOutput()` called from TerminalPane's PTY listener
- **Flow**: raw PTY bytes → redraw detection → ANSI-stripped → buffer (append or replace) → regex match → dedup check → fire
- **Match modes**: `regex` (default), `plain_text`, `variable` (evaluates variable-condition expressions)

## Variable Conditions

`src/lib/triggers/variableCondition.ts`: Expression parser supporting `a || b && c`, `!x`, `x == "value"`, `x != "value"`. Cached AST.

## Redraw Detection

Raw PTY data is tested for cursor-repositioning sequences (`\e[A`, `\e[H`, `\e[J`) before ANSI stripping. If detected, the buffer is **replaced** (not appended) with the current chunk's stripped text, since TUI redraws overwrite existing content.

## Dedup

Tracks last matched text + timestamp per trigger per tab. If the exact same text matches again within 10s (`DEDUP_WINDOW_MS`), the match is consumed from the buffer but the trigger doesn't fire. Prevents TUI apps (Claude Code / Ink) from re-triggering on redrawn content. On TUI redraws, the dedup timestamp is refreshed (`prev.ts = now`) so the window stays alive while redraws continue, but eventually expires for genuinely new matches.

## Auto-resume Suppression

Tabs with auto-resume commands use a 15s suppression window (vs 2s for normal tabs) before triggers start firing. This prevents false notifications from SSH + Claude auto-resume startup sequences.

## Buffer Consumption

Matched text is always consumed from the buffer, even when blocked by cooldown or dedup. This prevents stale matches from accumulating and re-firing after cooldown expires.

## Actions

- `notify` — dispatches via notification system
- `send_command` — writes to PTY
- `enable_auto_resume`
- `set_tab_state`

## Variables

Capture groups extracted into named variables (`%varName`), persisted per-tab via `trigger_variables`. `interpolateVariables(tabId, text)` replaces `%varName` tokens — used in tab titles, auto-resume commands, notification messages.

## Cooldown

Per-trigger per-tab, prevents rapid re-firing.

## Default Triggers

`src/lib/triggers/defaults.ts`: 6+ app-provided templates with stable `default_id`:
- `claude-resume` — captures `claude --resume` command
- `claude-session-id` — extracts UUID from `/status` output
- `claude-question` — detects "Do you want to proceed?" prompts
- `claude-plan-ready` — detects plan ready message
- `claude-compacting` — notifies during context compaction
- `claude-compaction-complete` — alerts when compaction finishes
- `claude-auto-resume` — variable-mode trigger for auto-resume enablement

Seeded on Preferences page mount via `seedDefaultTriggers()`. Users can edit; "Reset" restores template values. Deleted defaults tracked in `hidden_default_triggers`.
