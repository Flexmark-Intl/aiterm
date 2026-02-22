import type { Trigger, MatchMode } from '$lib/tauri/types';

/** Shared Claude resume command — used by auto-resume presets and the claude-auto-resume trigger. */
export const CLAUDE_RESUME_COMMAND = 'if [ -n "%claudeSessionId" ]; then claude --resume %claudeSessionId; elif [ -n "%claudeResumeCommand" ]; then eval %claudeResumeCommand; else claude --continue; fi';

/** App-provided default trigger templates. Keyed by stable default_id. */
export const DEFAULT_TRIGGERS: Record<string, Omit<Trigger, 'id' | 'enabled' | 'workspaces' | 'default_id'> & { match_mode?: MatchMode }> = {
  'claude-resume': {
    name: 'Claude Resume',
    description: 'Captures the claude --resume command and session ID when Claude Code exits. Useful for setting up auto-resume to reconnect to the same session.',
    pattern: 'Resume this session with:.*?(claude --resume (?:"[^"\\n]+"|([^\\s"\\n]+)))',
    actions: [
      { action_type: 'notify', command: null, title: null, message: 'Captured: %claudeResumeCommand', tab_state: null },
    ],
    cooldown: 1,
    variables: [
      { name: 'claudeResumeCommand', group: 1 },
      { name: 'claudeSessionId', group: 2 },
    ],
    plain_text: false,
  },
  'claude-session-id': {
    name: 'Claude Session ID',
    description: 'Captures the session UUID from Claude Code\'s /status command when run. Useful for when you want to setup a resume command based on the Session ID.',
    pattern: 'Session\\s*ID:\\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    actions: [
      { action_type: 'notify', command: null, title: null, message: 'Captured: claudeSessionId `%claudeSessionId`', tab_state: null },
    ],
    cooldown: 0.3,
    variables: [
      { name: 'claudeSessionId', group: 1 },
    ],
    plain_text: false,
  },
  'claude-question': {
    name: 'Claude Asking Question',
    description: 'Detects when Claude Code stops to ask a question or request confirmation. Sends a notification and sets the tab to "question" state.',
    pattern: '(Do you want to proceed?|Do you want to make this edit|Enter to confirm \u00b7 Esc to cancel)',
    actions: [
      { action_type: 'notify', command: null, title: null, message: 'Claude needs your attention.', tab_state: null },
      { action_type: 'set_tab_state', command: null, title: null, message: null, tab_state: 'question' },
    ],
    cooldown: 0.3,
    variables: [],
    plain_text: true,
  },
  'claude-plan-ready': {
    name: 'Claude Plan Ready',
    description: 'Detects when Claude has a plan ready for review. Sets the tab to "alert" state and sends a notification so you know to switch back.',
    pattern: 'has written up a plan and is ready to execute',
    actions: [
      { action_type: 'set_tab_state', command: null, title: null, message: null, tab_state: 'alert' },
      { action_type: 'notify', command: null, title: null, message: 'Claude has a plan ready for review', tab_state: null },
    ],
    cooldown: 0.3,
    variables: [],
    plain_text: true,
  },
  'claude-compacting': {
    name: 'Claude Compacting',
    description: 'Notifies when Claude Code is compacting the conversation context.',
    pattern: 'Compacting conversation\u2026',
    actions: [
      { action_type: 'notify', command: null, title: null, message: 'Claude is compacting...', tab_state: null },
    ],
    cooldown: 0.3,
    variables: [],
    plain_text: true,
  },
  'claude-compaction-complete': {
    name: 'Claude Compaction Complete',
    description: 'Sets the tab to "alert" state when conversation compaction finishes.',
    pattern: 'Conversation compacted',
    actions: [
      { action_type: 'set_tab_state', command: null, title: null, message: null, tab_state: 'alert' },
    ],
    cooldown: 0.3,
    variables: [],
    plain_text: true,
  },
  'claude-auto-resume': {
    name: 'Claude Auto-Resume',
    description: 'Automatically enables auto-resume when a Claude session ID or resume command is captured.',
    match_mode: 'variable',
    pattern: 'claudeSessionId || claudeResumeCommand',
    actions: [
      { action_type: 'enable_auto_resume', command: CLAUDE_RESUME_COMMAND, title: null, message: null, tab_state: null },
    ],
    cooldown: 5,
    variables: [],
    plain_text: false,
  },
};

/**
 * Seed default triggers into an existing trigger list.
 * Returns the updated list if changes were made, or null if no changes needed.
 */
export function seedDefaultTriggers(
  existing: Trigger[],
  hiddenIds: string[],
  enableAll = false,
): Trigger[] | null {
  let list = [...existing];
  let changed = false;

  for (const [defaultId, tmpl] of Object.entries(DEFAULT_TRIGGERS)) {
    if (hiddenIds.includes(defaultId)) continue;

    const linked = list.find(t => t.default_id === defaultId);
    if (linked) {
      // Auto-update unmodified defaults to latest template values
      if (!linked.user_modified) {
        linked.name = tmpl.name;
        linked.description = tmpl.description ?? null;
        linked.pattern = tmpl.pattern;
        linked.cooldown = tmpl.cooldown;
        linked.plain_text = tmpl.plain_text;
        linked.match_mode = tmpl.match_mode ?? null;
        linked.actions = structuredClone(tmpl.actions);
        linked.variables = structuredClone(tmpl.variables);
        changed = true;
      }
      continue;
    }

    // Adopt existing trigger that matches by name
    const match = list.find(t => !t.default_id && t.name === tmpl.name);
    if (match) {
      match.default_id = defaultId;
      if (!match.description && tmpl.description) {
        match.description = tmpl.description;
      }
      changed = true;
      continue;
    }

    // Seed new default trigger
    list = [{
      id: crypto.randomUUID(),
      ...structuredClone(tmpl),
      enabled: enableAll,
      workspaces: [],
      default_id: defaultId,
    }, ...list];
    changed = true;
  }

  return changed ? list : null;
}
