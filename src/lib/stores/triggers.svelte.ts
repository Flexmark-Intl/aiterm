import { preferencesStore } from '$lib/stores/preferences.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { workspacesStore } from '$lib/stores/workspaces.svelte';
import { activityStore } from '$lib/stores/activity.svelte';
import { writeTerminal, setTabTriggerVariables, getPtyInfo, cleanSshCommand } from '$lib/tauri/commands';
import { stripAnsi } from '$lib/utils/ansi';
import { getCompiledTitlePatterns, getCompiledPatterns, extractDirFromTitle } from '$lib/utils/promptPattern';
import { dispatch } from './notificationDispatch';
import { error as logError } from '@tauri-apps/plugin-log';
import { parseCondition, evaluateCondition } from '$lib/triggers/variableCondition';
import type { Trigger, MatchMode } from '$lib/tauri/types';

const BUFFER_CAP = 4096;

// Detect TUI redraw sequences: cursor-up (\e[<n>A), cursor absolute position
// (\e[<row>;<col>H or \e[<row>;<col>f), and erase-display (\e[<n>J).
// Their presence means the terminal is overwriting existing content, not
// emitting new forward-flowing output.
const REDRAW_RE = /\x1b\[\d*[AHf]|\x1b\[\d+;\d+[Hf]|\x1b\[\d*J/;

// Per-tab sliding window buffer (ANSI-stripped, multiline)
const buffers = new Map<string, string>();

// Cooldown tracking: triggerId → tabId → lastFiredMs
const cooldowns = new Map<string, Map<string, number>>();

// Dedup tracking: triggerId → tabId → { text, timestamp }
// Prevents re-firing on identical matches from TUI redraws (e.g. Claude Code
// repaints "Enter to confirm" on every frame, producing the same stripped text).
// Dedup expires after DEDUP_WINDOW_MS so genuinely new identical matches can fire.
const DEDUP_WINDOW_MS = 10_000;
const lastMatches = new Map<string, Map<string, { text: string; ts: number }>>();

// Compiled regex cache: pattern string → RegExp (or null if invalid)
// Uses 's' (dotAll) flag so `.` matches newlines for multiline patterns
const regexCache = new Map<string, RegExp | null>();

// Runtime variable storage: tabId → Map<varName, value>
const variableMap = new Map<string, Map<string, string>>();

// Tabs where triggers should extract variables but NOT fire actions.
// Used during terminal restore/auto-resume to prevent old output from
// triggering notifications and commands.
const suppressedTabs = new Set<string>();

// Variable trigger transition tracking: triggerId → tabId → { result, varsSnapshot }
// Fires on false→true transition OR when condition stays true but variable values change.
const variableTransitions = new Map<string, Map<string, { result: boolean; snapshot: string }>>();

/** Deterministic snapshot of variable values for change detection. */
function varsSnapshot(vars: Map<string, string>): string {
  const entries = [...vars.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return entries.map(([k, v]) => `${k}=${v}`).join('\0');
}

/** Resolve the effective match mode for a trigger (migration compat). */
export function resolveMatchMode(trigger: { match_mode?: MatchMode | null; plain_text?: boolean }): MatchMode {
  if (trigger.match_mode) return trigger.match_mode;
  return trigger.plain_text ? 'plain_text' : 'regex';
}

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

/** Execute all actions for a trigger. Called by both regex and variable trigger paths. */
async function executeActions(
  trigger: { id: string; name: string; actions: { action_type: string; command: string | null; title: string | null; message: string | null; tab_state: string | null }[] },
  tabId: string,
) {
  for (const entry of trigger.actions) {
    if (entry.action_type === 'send_command' && entry.command) {
      const instance = terminalsStore.get(tabId);
      if (!instance) continue;
      try {
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
    } else if (entry.action_type === 'enable_auto_resume') {
      await handleEnableAutoResume(tabId, entry.command ?? '');
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

  // Skip actions during the post-mount suppression window (restore/auto-resume)
  if (suppressedTabs.has(tabId)) return;

  // Execute actions
  await executeActions(trigger, tabId);
}

/** Handle enable_auto_resume action: gather PTY info and set auto-resume context. */
async function handleEnableAutoResume(tabId: string, commandTemplate: string) {
  const instance = terminalsStore.get(tabId);
  if (!instance) return;
  try {
    const info = await getPtyInfo(instance.ptyId);
    const sshCmd = info.foreground_command ? cleanSshCommand(info.foreground_command) : null;
    const localCwd = info.cwd ?? null;
    let remoteCwd: string | null = null;

    if (sshCmd) {
      const oscState = terminalsStore.getOsc(tabId);
      const osc7Cwd = oscState?.cwd ?? null;
      const promptCwd = oscState?.promptCwd ?? null;
      const isOsc7Stale = osc7Cwd === localCwd;
      remoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : promptCwd ?? null;
    }

    const cmd = interpolateVariables(tabId, commandTemplate, true);
    await workspacesStore.setTabAutoResumeContext(
      instance.workspaceId, instance.paneId, tabId,
      localCwd, sshCmd, remoteCwd, cmd || null,
    );
  } catch (e) {
    logError(`enable_auto_resume failed for tab ${tabId}: ${e}`);
  }
}

/** Evaluate variable-mode triggers for a tab. Called after regex triggers finish. */
function evaluateVariableTriggers(tabId: string) {
  const triggers = preferencesStore.triggers;
  const wsId = getWorkspaceIdForTab(tabId);
  const vars = variableMap.get(tabId) ?? new Map<string, string>();

  for (const trigger of triggers) {
    if (!trigger.enabled || !trigger.pattern) continue;
    if (resolveMatchMode(trigger) !== 'variable') continue;

    // Workspace scope filter
    if (trigger.workspaces.length > 0 && wsId) {
      if (!trigger.workspaces.includes(wsId)) continue;
    }

    // Cooldown check
    if (!checkCooldown(trigger.id, tabId, trigger.cooldown)) continue;

    // Parse and evaluate condition
    let result: boolean;
    try {
      const node = parseCondition(trigger.pattern);
      result = evaluateCondition(node, vars);
    } catch {
      continue; // invalid condition — skip
    }

    // Build a snapshot of current variable values for change detection
    const snapshot = varsSnapshot(vars);

    // Get previous state
    let tabTransitions = variableTransitions.get(trigger.id);
    if (!tabTransitions) {
      tabTransitions = new Map();
      variableTransitions.set(trigger.id, tabTransitions);
    }
    const prev = tabTransitions.get(tabId);
    tabTransitions.set(tabId, { result, snapshot });

    // Fire on false→true transition, or when condition stays true but values changed
    const prevResult = prev?.result ?? false;
    if (result && (!prevResult || snapshot !== prev?.snapshot)) {
      markFired(trigger.id, tabId);
      if (!suppressedTabs.has(tabId)) executeActions(trigger, tabId);
    }
  }
}

/** Called from TerminalPane's pty-output listener with raw PTY bytes. */
export function processOutput(tabId: string, data: Uint8Array) {
  // Quick exit: no triggers configured
  if (!preferencesStore.triggers.length) return;

  const text = new TextDecoder().decode(data);
  const clean = stripAnsi(text).replace(/\r/g, '');

  // If the raw chunk contains cursor-repositioning sequences, the TUI is
  // redrawing existing content rather than emitting new output. Replace the
  // buffer with only this chunk so we don't re-match previously consumed text.
  const isRedraw = REDRAW_RE.test(text);
  let buffer = isRedraw ? clean : (buffers.get(tabId) ?? '') + clean;

  // Cap buffer to prevent unbounded growth
  if (buffer.length > BUFFER_CAP) {
    buffer = buffer.slice(-BUFFER_CAP);
  }

  const triggers = preferencesStore.triggers;
  const wsId = getWorkspaceIdForTab(tabId);

  for (const trigger of triggers) {
    if (!trigger.enabled || !trigger.pattern) continue;

    // Skip variable-mode triggers — they're evaluated after the regex loop
    if (resolveMatchMode(trigger) === 'variable') continue;

    // Workspace scope filter (by ID)
    if (trigger.workspaces.length > 0 && wsId) {
      if (!trigger.workspaces.includes(wsId)) continue;
    }

    const re = getRegex(trigger.pattern, resolveMatchMode(trigger) === 'plain_text');
    if (!re) continue;

    const match = buffer.match(re);
    if (match && match.index !== undefined) {
      const matchedText = match[0];

      // Always consume the matched portion from the buffer, even if we don't
      // fire (due to cooldown or dedup). This prevents the same text from
      // accumulating in the buffer and re-matching on every PTY chunk.
      buffer = buffer.slice(match.index + matchedText.length);

      // Cooldown check
      if (!checkCooldown(trigger.id, tabId, trigger.cooldown)) continue;

      // Dedup: if the exact same text was the last match for this trigger+tab
      // and we're still within the dedup window, don't fire again. This
      // prevents TUI apps (like Claude Code) from re-triggering on redrawn
      // content. The dedup expires after DEDUP_WINDOW_MS so genuinely new
      // identical matches (e.g. a second question) can still fire.
      const now = Date.now();
      const prev = lastMatches.get(trigger.id)?.get(tabId);
      if (prev && prev.text === matchedText && (now - prev.ts) < DEDUP_WINDOW_MS) {
        continue;
      }

      // Track matched text + timestamp for dedup
      let tabMap = lastMatches.get(trigger.id);
      if (!tabMap) {
        tabMap = new Map();
        lastMatches.set(trigger.id, tabMap);
      }
      tabMap.set(tabId, { text: matchedText, ts: now });

      fireTrigger(trigger, tabId, match);
    }
  }

  buffers.set(tabId, buffer);

  // Evaluate variable-mode triggers after all regex triggers have run
  // (variables may have been updated by regex trigger extractions above)
  evaluateVariableTriggers(tabId);
}

/** Called when a terminal is destroyed to clean up per-tab state. */
export function cleanupTab(tabId: string) {
  buffers.delete(tabId);
  variableMap.delete(tabId);
  suppressedTabs.delete(tabId);
  for (const tabMap of cooldowns.values()) {
    tabMap.delete(tabId);
  }
  for (const tabMap of lastMatches.values()) {
    tabMap.delete(tabId);
  }
  for (const tabMap of variableTransitions.values()) {
    tabMap.delete(tabId);
  }
}

/** Suppress action execution for a tab (variables still extracted).
 *  Call on mount to prevent restored/auto-resumed output from firing triggers. */
export function suppressTab(tabId: string) {
  suppressedTabs.add(tabId);
}

/** Re-enable action execution for a tab after the restore window. */
export function unsuppressTab(tabId: string) {
  suppressedTabs.delete(tabId);
}

/** Load persisted trigger variables into runtime map (called on mount).
 *  Seeds variable transition state without firing to prevent false positives on restart. */
export function loadTabVariables(tabId: string, vars: Record<string, string>) {
  if (!vars || !Object.keys(vars).length) return;
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) map.set(k, v);
  variableMap.set(tabId, map);
  notifyVarChange(tabId);

  // Seed variable transitions to prevent false-positive firing on app restart
  initializeVariableTransitions(tabId, map);
}

/** Seed variable transitions with current evaluation results (no firing). */
function initializeVariableTransitions(tabId: string, vars: Map<string, string>) {
  const triggers = preferencesStore.triggers;
  const snapshot = varsSnapshot(vars);
  for (const trigger of triggers) {
    if (!trigger.enabled || !trigger.pattern) continue;
    if (resolveMatchMode(trigger) !== 'variable') continue;

    try {
      const node = parseCondition(trigger.pattern);
      const result = evaluateCondition(node, vars);
      let tabMap = variableTransitions.get(trigger.id);
      if (!tabMap) {
        tabMap = new Map();
        variableTransitions.set(trigger.id, tabMap);
      }
      tabMap.set(tabId, { result, snapshot });
    } catch {
      // invalid condition — skip
    }
  }
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
