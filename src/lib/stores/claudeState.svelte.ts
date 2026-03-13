import { listen } from '@tauri-apps/api/event';
import { info as logInfo } from '@tauri-apps/plugin-log';
import { setVariable, handleEnableAutoResume } from './triggers.svelte';
import { dispatch } from './notificationDispatch';
import { CLAUDE_RESUME_COMMAND } from '$lib/triggers/defaults';

/**
 * Claude Code session state per tab, driven by hook events.
 *
 * State machine:
 *   SessionStart → active (thinking)
 *   UserPromptSubmit → active (thinking)
 *   Stop → idle (waiting for user input)
 *   Notification(idle_prompt) → idle
 *   Notification(permission_prompt) → permission
 *   SessionEnd → (removed)
 */

export type ClaudeState = 'active' | 'idle' | 'permission';

export interface ClaudeTabSession {
  sessionId: string;
  state: ClaudeState;
}

function createClaudeStateStore() {
  // tabId → session info
  let sessions = $state<Map<string, ClaudeTabSession>>(new Map());
  const unlisteners: (() => void)[] = [];

  function setState(tabId: string, sessionId: string, state: ClaudeState) {
    const current = sessions.get(tabId);
    if (current?.sessionId === sessionId && current?.state === state) return;
    sessions = new Map(sessions);
    sessions.set(tabId, { sessionId, state });
  }

  function removeSession(tabId: string) {
    if (!sessions.has(tabId)) return;
    sessions = new Map(sessions);
    sessions.delete(tabId);
  }

  return {
    /** Get Claude state for a tab, if a Claude session is active there. */
    getState(tabId: string): ClaudeTabSession | undefined {
      return sessions.get(tabId);
    },

    /** Check if any tab in the list has a Claude session needing attention. */
    hasAttention(tabIds: string[]): boolean {
      for (const id of tabIds) {
        const s = sessions.get(id);
        if (s?.state === 'permission') return true;
      }
      return false;
    },

    /** Check if any tab in the list has an active Claude session. */
    hasActive(tabIds: string[]): boolean {
      for (const id of tabIds) {
        if (sessions.has(id)) return true;
      }
      return false;
    },

    async init() {
      const u1 = await listen<{ session_id: string; tab_id: string }>('claude-hook-session-start', (e) => {
        const { session_id, tab_id } = e.payload;
        if (!tab_id) return;
        setState(tab_id, session_id, 'active');
        logInfo(`Claude state: session ${session_id.slice(0, 8)} started → tab ${tab_id.slice(0, 8)} = active`);
      });
      unlisteners.push(u1);

      const u2 = await listen<{ session_id: string; tab_id: string | null }>('claude-hook-session-end', (e) => {
        const { tab_id } = e.payload;
        if (!tab_id) return;
        removeSession(tab_id);
        logInfo(`Claude state: session ended → tab ${tab_id.slice(0, 8)} removed`);
      });
      unlisteners.push(u2);

      const u3 = await listen<{ session_id: string; tab_id: string | null }>('claude-hook-stop', (e) => {
        const { session_id, tab_id } = e.payload;
        if (!tab_id) return;
        setState(tab_id, session_id, 'idle');
      });
      unlisteners.push(u3);

      const u4 = await listen<{ session_id: string; tab_id: string | null }>('claude-hook-user-prompt', (e) => {
        const { session_id, tab_id } = e.payload;
        if (!tab_id) return;
        setState(tab_id, session_id, 'active');
      });
      unlisteners.push(u4);

      const u5 = await listen<{ session_id: string; tab_id: string | null; notification_type: string }>('claude-hook-notification', (e) => {
        const { session_id, tab_id, notification_type } = e.payload;
        if (!tab_id) return;
        if (notification_type === 'permission_prompt') {
          setState(tab_id, session_id, 'permission');
          dispatch('Claude Code', 'Needs permission approval', 'info', { tabId: tab_id });
        } else if (notification_type === 'idle_prompt') {
          setState(tab_id, session_id, 'idle');
          dispatch('Claude Code', 'Waiting for input', 'info', { tabId: tab_id });
        }
      });
      unlisteners.push(u5);

      // initSession sets claudeSessionId trigger variable and enables auto-resume directly
      const u6 = await listen<{ tab_id: string; session_id: string }>('claude-init-session', (e) => {
        const { tab_id, session_id } = e.payload;
        if (!tab_id || !session_id) return;
        setVariable(tab_id, 'claudeSessionId', session_id);
        handleEnableAutoResume(tab_id, CLAUDE_RESUME_COMMAND);
        logInfo(`Claude init: set claudeSessionId for tab ${tab_id.slice(0, 8)} = ${session_id.slice(0, 8)}`);
      });
      unlisteners.push(u6);
    },

    destroy() {
      for (const u of unlisteners) u();
      unlisteners.length = 0;
    },
  };
}

export const claudeStateStore = createClaudeStateStore();
