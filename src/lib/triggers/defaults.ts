import type { Trigger, MatchMode } from '$lib/tauri/types';

/** Shared Claude resume command — used by auto-resume presets and hooks-based auto-resume. */
export const CLAUDE_RESUME_COMMAND = 'claude --resume %claudeSessionId "/aiterm init"';

/** App-provided default trigger templates. Keyed by stable default_id. */
export const DEFAULT_TRIGGERS: Record<string, Omit<Trigger, 'id' | 'enabled' | 'workspaces' | 'tabs' | 'default_id'> & { match_mode?: MatchMode }> = {
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
      tabs: [],
      default_id: defaultId,
    }, ...list];
    changed = true;
  }

  return changed ? list : null;
}
