export interface ShellState {
  state: 'prompt' | 'completed' | 'running';
  exitCode?: number;
}

function createActivityStore() {
  let active = $state<Set<string>>(new Set());
  let shellStates = $state<Map<string, ShellState>>(new Map());

  return {
    hasActivity(tabId: string): boolean {
      return active.has(tabId);
    },

    /** Check if any tab in the given list has activity. */
    hasAnyActivity(tabIds: string[]): boolean {
      for (const id of tabIds) {
        if (active.has(id)) return true;
      }
      return false;
    },

    markActive(tabId: string) {
      if (active.has(tabId)) return;
      active = new Set(active);
      active.add(tabId);
    },

    clearActive(tabId: string) {
      if (!active.has(tabId)) return;
      active = new Set(active);
      active.delete(tabId);
    },

    getShellState(tabId: string): ShellState | undefined {
      return shellStates.get(tabId);
    },

    setShellState(tabId: string, state: 'prompt' | 'completed' | 'running' | null, exitCode?: number) {
      if (state === null) {
        if (!shellStates.has(tabId)) return;
        shellStates = new Map(shellStates);
        shellStates.delete(tabId);
        return;
      }
      if (state === 'prompt') {
        // Only set prompt if not already showing completed (completed has priority)
        const current = shellStates.get(tabId);
        if (current?.state === 'completed') return;
      }
      shellStates = new Map(shellStates);
      shellStates.set(tabId, { state, exitCode });
    },

    clearShellState(tabId: string) {
      if (!shellStates.has(tabId)) return;
      shellStates = new Map(shellStates);
      shellStates.delete(tabId);
    },
  };
}

export const activityStore = createActivityStore();
