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
  // MRU-ordered list. Front (index 0) is the most recently activated tab.
  // Entries are unique by tabId.
  let history = $state<NavEntry[]>([]);
  // Pointer into `history` during a Cmd+[/] walk. 0 = on current tab.
  // The list itself stays stable during a walk so back/forward don't oscillate.
  let walkIndex = $state(0);
  let navigating = false;

  function findTab(entry: NavEntry): boolean {
    const ws = workspacesStore.workspaces.find(w => w.id === entry.workspaceId);
    if (!ws) return false;
    const pane = ws.panes.find(p => p.id === entry.paneId);
    if (!pane) return false;
    const tab = pane.tabs.find(t => t.id === entry.tabId);
    if (!tab) return false;
    const isTerminal = tab.tab_type === 'terminal' || !tab.tab_type;
    if (isTerminal && !terminalsStore.get(entry.tabId)) return false;
    return true;
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
    get canGoBack() { return walkIndex < history.length - 1; },
    get canGoForward() { return walkIndex > 0; },

    push(entry: NavEntry) {
      if (navigating) return;

      // If the user had walked back and is now doing a real navigation,
      // commit the walked-to tab by promoting it to the front before
      // processing this push. This preserves the walked-to tab in MRU order.
      if (walkIndex > 0 && walkIndex < history.length) {
        const walked = history[walkIndex];
        // If the new entry is the walked-to tab itself, treat the whole
        // thing as a commit-in-place (remove+unshift below handles it).
        if (walked.tabId !== entry.tabId) {
          history = [walked, ...history.slice(0, walkIndex), ...history.slice(walkIndex + 1)];
        }
      }
      walkIndex = 0;

      // Dedup: remove any existing entry for this tab, then unshift to front.
      const filtered = history.filter(e => e.tabId !== entry.tabId);
      filtered.unshift(entry);
      if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY;
      history = filtered;
    },

    async goBack() {
      if (walkIndex >= history.length - 1) { playBellSound(); return; }
      navigating = true;
      try {
        let target = walkIndex + 1;
        while (target < history.length && !findTab(history[target])) {
          target++;
        }
        if (target < history.length) {
          walkIndex = target;
          await navigateToEntry(history[walkIndex]);
        } else {
          playBellSound();
        }
      } finally {
        navigating = false;
      }
    },

    async goForward() {
      if (walkIndex <= 0) { playBellSound(); return; }
      navigating = true;
      try {
        let target = walkIndex - 1;
        while (target > 0 && !findTab(history[target])) {
          target--;
        }
        walkIndex = target;
        await navigateToEntry(history[walkIndex]);
      } finally {
        navigating = false;
      }
    },

    /**
     * Return the best entry to land on after closing `tabId`.
     * If the user is mid-walk on the closed tab, prefer continuing the walk
     * (next-back, then next-forward) so Cmd+[/] still work from where they were.
     * Otherwise fall back to MRU.
     */
    peekBackForClose(tabId: string, isValid?: (entry: NavEntry) => boolean): NavEntry | null {
      const matches = (e: NavEntry) => e.tabId !== tabId && (!isValid || isValid(e));
      if (walkIndex > 0 && history[walkIndex]?.tabId === tabId) {
        for (let i = walkIndex + 1; i < history.length; i++) {
          if (matches(history[i])) return history[i];
        }
        for (let i = walkIndex - 1; i >= 0; i--) {
          if (matches(history[i])) return history[i];
        }
      }
      for (let i = 0; i < history.length; i++) {
        if (matches(history[i])) return history[i];
      }
      return null;
    },

    /** Return the most recent MRU entry pointing at a live tab, or null. */
    peekMostRecent(isValid?: (entry: NavEntry) => boolean): NavEntry | null {
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        if (isValid && !isValid(entry)) continue;
        if (!findTab(entry)) continue;
        return entry;
      }
      return null;
    },

    /**
     * Remove `tabId` from history. If `anchorTabId` is given, point walkIndex
     * at that entry's new position so the walk continues from there. Otherwise
     * keep walkIndex on the previously walked-to tab if still present, else 0.
     */
    removeTab(tabId: string, anchorTabId?: string) {
      const currentId = anchorTabId ?? history[walkIndex]?.tabId ?? null;
      history = history.filter(e => e.tabId !== tabId);
      if (currentId && currentId !== tabId) {
        const newIdx = history.findIndex(e => e.tabId === currentId);
        walkIndex = newIdx >= 0 ? newIdx : 0;
      } else {
        walkIndex = 0;
      }
    },

    removeWorkspace(workspaceId: string) {
      const currentId = history[walkIndex]?.tabId ?? null;
      const currentWs = history[walkIndex]?.workspaceId ?? null;
      history = history.filter(e => e.workspaceId !== workspaceId);
      if (currentId && currentWs !== workspaceId) {
        const newIdx = history.findIndex(e => e.tabId === currentId);
        walkIndex = newIdx >= 0 ? newIdx : 0;
      } else {
        walkIndex = 0;
      }
    },
  };
}

export const navHistoryStore = createNavHistoryStore();
