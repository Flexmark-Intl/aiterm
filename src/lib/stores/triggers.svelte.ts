import { preferencesStore } from '$lib/stores/preferences.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { workspacesStore } from '$lib/stores/workspaces.svelte';
import { activityStore } from '$lib/stores/activity.svelte';
import { writeTerminal, setTabTriggerVariables } from '$lib/tauri/commands';
import { stripAnsi } from '$lib/utils/ansi';
import { getCompiledTitlePatterns, extractDirFromTitle } from '$lib/utils/promptPattern';
import { dispatch } from './notificationDispatch';
import { error as logError } from '@tauri-apps/plugin-log';

const BUFFER_CAP = 4096;

// Per-tab sliding window buffer (ANSI-stripped, multiline)
const buffers = new Map<string, string>();

// Cooldown tracking: triggerId → tabId → lastFiredMs
const cooldowns = new Map<string, Map<string, number>>();

// Compiled regex cache: pattern string → RegExp (or null if invalid)
// Uses 's' (dotAll) flag so `.` matches newlines for multiline patterns
const regexCache = new Map<string, RegExp | null>();

// Runtime variable storage: tabId → Map<varName, value>
const variableMap = new Map<string, Map<string, string>>();

// Change listeners for reactive UI updates
type VarChangeCallback = (tabId: string, vars: Map<string, string>) => void;
const varChangeListeners = new Set<VarChangeCallback>();

/** Escape a plain-text fragment: metacharacters escaped, whitespace → \s*. */
function escapePlainSegment(text: string): string {
  return text
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\?\s+/g, '\\s*');
}

/**
 * Build a hybrid regex source from a plain-text pattern.
 * Alternation groups like (foo|bar) are preserved as regex alternation
 * using non-capturing groups (?:...|...), while everything else is escaped.
 * Each alternative inside parens still gets plain-text treatment.
 */
function buildHybridSource(pattern: string): string {
  let result = '';
  let i = 0;

  while (i < pattern.length) {
    if (pattern[i] === '(') {
      const close = pattern.indexOf(')', i + 1);
      if (close === -1) {
        // Unmatched paren — escape rest as literal
        result += escapePlainSegment(pattern.slice(i));
        break;
      }
      const inner = pattern.slice(i + 1, close);
      if (inner.includes('|')) {
        // Alternation group — preserve structure, escape each alternative
        const alternatives = inner.split('|');
        result += '(?:' + alternatives.map(a => escapePlainSegment(a)).join('|') + ')';
      } else {
        // No alternation — treat parens + content as literal
        result += escapePlainSegment(pattern.slice(i, close + 1));
      }
      i = close + 1;
    } else {
      const nextParen = pattern.indexOf('(', i);
      const end = nextParen === -1 ? pattern.length : nextParen;
      result += escapePlainSegment(pattern.slice(i, end));
      i = end;
    }
  }

  return result;
}

function getRegex(pattern: string, plainText = false): RegExp | null {
  const cacheKey = plainText ? `__pt__${pattern}` : pattern;
  if (regexCache.has(cacheKey)) return regexCache.get(cacheKey)!;
  try {
    let src = pattern;
    if (plainText) {
      // Hybrid plain-text mode: escape metacharacters and convert whitespace
      // to \s* for TUI gap tolerance, but preserve (a|b) alternation groups.
      src = buildHybridSource(pattern);
    }
    const re = new RegExp(src, 's');
    regexCache.set(cacheKey, re);
    return re;
  } catch {
    regexCache.set(cacheKey, null);
    return null;
  }
}

function getWorkspaceIdForTab(tabId: string): string | null {
  const instance = terminalsStore.get(tabId);
  return instance?.workspaceId ?? null;
}

/** Get the raw OSC title set by the running program. */
function getOscTitle(tabId: string): string {
  return terminalsStore.getOsc(tabId)?.title ?? '';
}

/** Get the tab's stored name from workspace data. */
function getTabName(tabId: string): string {
  const instance = terminalsStore.get(tabId);
  if (instance) {
    const ws = workspacesStore.workspaces.find(w => w.id === instance.workspaceId);
    const tab = ws?.panes.flatMap(p => p.tabs).find(t => t.id === tabId);
    if (tab) return tab.name;
  }
  return 'Terminal';
}

/** Compute the full display name as shown in the tab header (custom name with interpolation). */
function getTabDisplayName(tabId: string): string {
  const instance = terminalsStore.get(tabId);
  if (!instance) return 'Terminal';
  const ws = workspacesStore.workspaces.find(w => w.id === instance.workspaceId);
  const tab = ws?.panes.flatMap(p => p.tabs).find(t => t.id === tabId);
  if (!tab) return 'Terminal';

  const oscTitle = terminalsStore.getOsc(tabId)?.title;

  if (tab.custom_name) {
    let result = tab.name;
    if (oscTitle) {
      if (result.includes('%title')) result = result.replace('%title', oscTitle);
      if (result.includes('%dir')) {
        const patterns = getCompiledTitlePatterns(preferencesStore.promptPatterns);
        result = result.replace('%dir', extractDirFromTitle(oscTitle, patterns));
      }
    }
    if (result.includes('%')) {
      result = interpolateVariables(tabId, result, true);
    }
    return result;
  }
  return oscTitle ?? tab.name;
}

function checkCooldown(triggerId: string, tabId: string, cooldownSecs: number): boolean {
  const now = Date.now();
  const tabMap = cooldowns.get(triggerId);
  if (tabMap) {
    const lastFired = tabMap.get(tabId);
    if (lastFired && now - lastFired < cooldownSecs * 1000) return false;
  }
  return true;
}

function markFired(triggerId: string, tabId: string) {
  let tabMap = cooldowns.get(triggerId);
  if (!tabMap) {
    tabMap = new Map();
    cooldowns.set(triggerId, tabMap);
  }
  tabMap.set(tabId, Date.now());
}

function notifyVarChange(tabId: string) {
  const vars = variableMap.get(tabId) ?? new Map();
  for (const cb of varChangeListeners) {
    cb(tabId, vars);
  }
}

function extractAndStoreVariables(
  tabId: string,
  match: RegExpMatchArray,
  variables: { name: string; group: number; template?: string }[],
) {
  if (!variables.length) return;

  let vars = variableMap.get(tabId);
  if (!vars) {
    vars = new Map();
    variableMap.set(tabId, vars);
  }

  let changed = false;
  for (const v of variables) {
    const raw = match[v.group];
    if (raw === undefined) continue;
    const value = v.template ? v.template.replace(/%/g, raw) : raw;
    if (vars.get(v.name) !== value) {
      vars.set(v.name, value);
      changed = true;
    }
  }

  if (changed) {
    notifyVarChange(tabId);
    // Persist to backend
    const instance = terminalsStore.get(tabId);
    if (instance) {
      const plain: Record<string, string> = {};
      for (const [k, val] of vars) plain[k] = val;
      setTabTriggerVariables(instance.workspaceId, instance.paneId, tabId, plain)
        .catch(e => logError(`Failed to persist trigger variables: ${e}`));
    }
  }
}

async function fireTrigger(
  trigger: { id: string; name: string; actions: { action_type: string; command: string | null; title: string | null; message: string | null; tab_state: string | null }[]; variables: { name: string; group: number; template?: string }[] },
  tabId: string,
  match: RegExpMatchArray,
) {
  markFired(trigger.id, tabId);

  // Extract variables (always, independent of actions)
  extractAndStoreVariables(tabId, match, trigger.variables);

  // Execute each action
  for (const entry of trigger.actions) {
    if (entry.action_type === 'send_command' && entry.command) {
      const instance = terminalsStore.get(tabId);
      if (!instance) continue;
      try {
        // Interpolate %varName in command from tab's variables
        let cmd = entry.command;
        const vars = variableMap.get(tabId);
        if (vars) {
          cmd = cmd.replace(/%(\w+)/g, (m, name) => vars.has(name) ? vars.get(name)! : m);
        }
        const bytes = Array.from(new TextEncoder().encode(cmd + '\n'));
        await writeTerminal(instance.ptyId, bytes);
      } catch (e) {
        logError(`Trigger "${trigger.name}" failed to send command: ${e}`);
      }
    } else if (entry.action_type === 'notify') {
      try {
        const vars = variableMap.get(tabId);
        const interpolate = (text: string) => text.replace(/%([\w]+)/g, (m: string, name: string) => {
          if (name === 'title') return getOscTitle(tabId);
          if (name === 'tab') return getTabName(tabId);
          if (name === 'tabtitle') return getTabDisplayName(tabId);
          return vars?.has(name) ? vars.get(name)! : m;
        });
        const title = interpolate(entry.title || '%tabtitle');
        const body = interpolate(entry.message || '');
        await dispatch(title, body, 'info', { tabId });
      } catch (e) {
        logError(`Trigger "${trigger.name}" notification failed: ${e}`);
      }
    } else if (entry.action_type === 'set_tab_state') {
      const state = (entry.tab_state || 'alert') as import('$lib/tauri/types').TabStateName;
      activityStore.setTabState(tabId, state);
    }
  }
}

/** Called from TerminalPane's pty-output listener with raw PTY bytes. */
export function processOutput(tabId: string, data: Uint8Array) {
  // Quick exit: no triggers configured
  if (!preferencesStore.triggers.length) return;

  const text = new TextDecoder().decode(data);
  const clean = stripAnsi(text).replace(/\r/g, '');
  let buffer = (buffers.get(tabId) ?? '') + clean;

  // Cap buffer to prevent unbounded growth
  if (buffer.length > BUFFER_CAP) {
    buffer = buffer.slice(-BUFFER_CAP);
  }

  const triggers = preferencesStore.triggers;
  const wsId = getWorkspaceIdForTab(tabId);

  for (const trigger of triggers) {
    if (!trigger.enabled || !trigger.pattern) continue;

    // Workspace scope filter (by ID)
    if (trigger.workspaces.length > 0 && wsId) {
      if (!trigger.workspaces.includes(wsId)) continue;
    }

    // Cooldown check
    if (!checkCooldown(trigger.id, tabId, trigger.cooldown)) continue;

    const re = getRegex(trigger.pattern, trigger.plain_text);
    if (!re) continue;

    const match = buffer.match(re);
    if (match && match.index !== undefined) {
      fireTrigger(trigger, tabId, match);
      // Consume matched portion from buffer to prevent re-matching
      buffer = buffer.slice(match.index + match[0].length);
    }
  }

  buffers.set(tabId, buffer);
}

/** Called when a terminal is destroyed to clean up per-tab state. */
export function cleanupTab(tabId: string) {
  buffers.delete(tabId);
  variableMap.delete(tabId);
  for (const tabMap of cooldowns.values()) {
    tabMap.delete(tabId);
  }
}

/** Load persisted trigger variables into runtime map (called on mount). */
export function loadTabVariables(tabId: string, vars: Record<string, string>) {
  if (!vars || !Object.keys(vars).length) return;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) map.set(k, v);
  variableMap.set(tabId, map);
  notifyVarChange(tabId);
}

/** Get a single variable value for a tab. */
export function getVariable(tabId: string, name: string): string | undefined {
  return variableMap.get(tabId)?.get(name);
}

/** Get all variables for a tab. */
export function getVariables(tabId: string): Map<string, string> | undefined {
  return variableMap.get(tabId);
}

/** Clear all trigger variables for a tab (runtime + persisted). */
export function clearTabVariables(tabId: string) {
  variableMap.delete(tabId);
  notifyVarChange(tabId);
  const instance = terminalsStore.get(tabId);
  if (instance) {
    setTabTriggerVariables(instance.workspaceId, instance.paneId, tabId, {})
      .catch(e => logError(`Failed to clear trigger variables: ${e}`));
  }
}

/** Subscribe to variable changes. Returns unsubscribe function. */
export function onVariablesChange(cb: VarChangeCallback): () => void {
  varChangeListeners.add(cb);
  return () => { varChangeListeners.delete(cb); };
}

/** Interpolate %varName references in a string from tab's trigger variables.
 *  When clearUnresolved is true, unmatched %varName tokens are replaced with empty strings
 *  (useful for shell conditionals like `[ -n "%var" ]`). */
export function interpolateVariables(tabId: string, text: string, clearUnresolved = false): string {
  const vars = variableMap.get(tabId);
  if (!text.includes('%')) return text;
  return text.replace(/%(\w+)/g, (m, name) => {
    if (vars?.has(name)) return vars.get(name)!;
    return clearUnresolved ? '' : m;
  });
}
