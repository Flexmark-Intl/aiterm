import { workspacesStore } from '$lib/stores/workspaces.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { playBellSound } from '$lib/tauri/commands';

interface NavEntry {
  workspaceId: string;
  paneId: string;
  tabId: string;
}

const MAX_HISTORY = 50;

function createNavHistoryStore() {
  let history = $state<NavEntry[]>([]);
  let cursor = $state(-1);
  let navigating = false;

  function findTab(entry: NavEntry): boolean {
    const ws = workspacesStore.workspaces.find(w => w.id === entry.workspaceId);
    if (!ws) return false;
    const pane = ws.panes.find(p => p.id === entry.paneId);
    if (!pane) return false;
    return pane.tabs.some(t => t.id === entry.tabId);
  }

  async function navigateToEntry(entry: NavEntry) {
    const ws = workspacesStore.workspaces.find(w => w.id === entry.workspaceId);
    if (!ws) return;

    if (ws.suspended) {
      await workspacesStore.resumeWorkspace(entry.workspaceId);
    } else if (entry.workspaceId !== workspacesStore.activeWorkspaceId) {
      await workspacesStore.setActiveWorkspace(entry.workspaceId);
    }

    if (ws.active_pane_id !== entry.paneId) {
      await workspacesStore.setActivePane(entry.workspaceId, entry.paneId);
    }

    await workspacesStore.setActiveTab(entry.workspaceId, entry.paneId, entry.tabId);
    terminalsStore.focusTerminal(entry.tabId);
  }

  return {
    get canGoBack() { return cursor > 0; },
    get canGoForward() { return cursor < history.length - 1; },

    push(entry: NavEntry) {
      if (navigating) return;
      // Dedup: skip if same as current entry
      if (cursor >= 0 && history[cursor]?.tabId === entry.tabId) return;
      // Truncate forward stack
      history = history.slice(0, cursor + 1);
      history.push(entry);
      cursor = history.length - 1;
      // Cap size
      if (history.length > MAX_HISTORY) {
        history = history.slice(history.length - MAX_HISTORY);
        cursor = history.length - 1;
      }
    },

    async goBack() {
      if (cursor <= 0) { playBellSound(); return; }
      navigating = true;
      try {
        let target = cursor - 1;
        while (target >= 0 && !findTab(history[target])) {
          target--;
        }
        if (target >= 0) {
          cursor = target;
          await navigateToEntry(history[cursor]);
        } else {
          playBellSound();
        }
      } finally {
        navigating = false;
      }
    },

    async goForward() {
      if (cursor >= history.length - 1) { playBellSound(); return; }
      navigating = true;
      try {
        let target = cursor + 1;
        while (target < history.length && !findTab(history[target])) {
          target++;
        }
        if (target < history.length) {
          cursor = target;
          await navigateToEntry(history[cursor]);
        } else {
          playBellSound();
        }
      } finally {
        navigating = false;
      }
    },

    removeTab(tabId: string) {
      const currentId = cursor >= 0 ? history[cursor]?.tabId : null;
      history = history.filter(e => e.tabId !== tabId);
      // Recompute cursor
      if (currentId) {
        const newIdx = history.findIndex(e => e.tabId === currentId);
        cursor = newIdx >= 0 ? newIdx : Math.min(cursor, history.length - 1);
      } else {
        cursor = Math.min(cursor, history.length - 1);
      }
    },

    removeWorkspace(workspaceId: string) {
      const currentId = cursor >= 0 ? history[cursor]?.tabId : null;
      history = history.filter(e => e.workspaceId !== workspaceId);
      if (currentId) {
        const newIdx = history.findIndex(e => e.tabId === currentId);
        cursor = newIdx >= 0 ? newIdx : Math.min(cursor, history.length - 1);
      } else {
        cursor = Math.min(cursor, history.length - 1);
      }
    },
  };
}

export const navHistoryStore = createNavHistoryStore();
