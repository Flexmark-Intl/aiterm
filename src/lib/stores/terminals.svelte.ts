import type { Terminal } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';
import type { SearchAddon } from '@xterm/addon-search';
import { setTabScrollback, killTerminal } from '$lib/tauri/commands';
import { error as logError } from '@tauri-apps/plugin-log';

/**
 * Per-terminal state collected from OSC escape sequences.
 *
 * Supported:
 *   OSC 0/2 — title (shown in tab)
 *   OSC 7   — cwd   (used for split cloning)
 *
 * Future candidates:
 *   OSC 9   — desktop notification when a command finishes
 *   OSC 133 — shell integration (prompt/command boundaries)
 */
export interface OscState {
  title: string | null;
  cwd: string | null;
  /** Hostname from the OSC 7 URL — used to distinguish local vs remote cwd. */
  cwdHost: string | null;
}

interface TerminalInstance {
  terminal: Terminal;
  ptyId: string;
  serializeAddon: SerializeAddon;
  searchAddon: SearchAddon;
  workspaceId: string;
  paneId: string;
  tabId: string;
  osc: OscState;
}

export interface SplitContext {
  cwd: string | null;
  sshCommand: string | null;
  remoteCwd: string | null;
}

function createTerminalsStore() {
  let instances = $state<Map<string, TerminalInstance>>(new Map());
  let searchVisibleFor = $state<string | null>(null);
  let _shuttingDown = false;
  const splitContexts = new Map<string, SplitContext>();
  // Listeners notified when any terminal's OSC state changes
  const oscListeners = new Set<(tabId: string, osc: OscState) => void>();

  function emitOscChange(tabId: string, osc: OscState) {
    for (const fn of oscListeners) fn(tabId, osc);
  }

  return {
    get instances() { return instances; },
    get shuttingDown() { return _shuttingDown; },
    get searchVisibleFor() { return searchVisibleFor; },

    setSplitContext(tabId: string, ctx: SplitContext) {
      splitContexts.set(tabId, ctx);
    },

    consumeSplitContext(tabId: string): SplitContext | undefined {
      const ctx = splitContexts.get(tabId);
      if (ctx) splitContexts.delete(tabId);
      return ctx;
    },

    register(
      tabId: string,
      terminal: Terminal,
      ptyId: string,
      serializeAddon: SerializeAddon,
      searchAddon: SearchAddon,
      workspaceId: string,
      paneId: string
    ) {
      instances = new Map(instances);
      instances.set(tabId, {
        terminal, ptyId, serializeAddon, searchAddon,
        workspaceId, paneId, tabId,
        osc: { title: null, cwd: null, cwdHost: null },
      });
    },

    unregister(tabId: string) {
      instances = new Map(instances);
      instances.delete(tabId);
    },

    get(tabId: string): TerminalInstance | undefined {
      return instances.get(tabId);
    },

    // --- OSC state ---

    updateOsc(tabId: string, patch: Partial<OscState>) {
      const instance = instances.get(tabId);
      if (!instance) return;
      Object.assign(instance.osc, patch);
      emitOscChange(tabId, instance.osc);
    },

    getOsc(tabId: string): OscState | undefined {
      return instances.get(tabId)?.osc;
    },

    onOscChange(fn: (tabId: string, osc: OscState) => void): () => void {
      oscListeners.add(fn);
      return () => oscListeners.delete(fn);
    },

    // --- terminal actions ---

    focusTerminal(tabId: string) {
      const instance = instances.get(tabId);
      if (instance) {
        instance.terminal.focus();
      }
    },

    async clearTerminal(tabId: string) {
      const instance = instances.get(tabId);
      if (!instance) return;
      // Clear xterm's scrollback buffer while keeping the current screen (prompt) visible.
      instance.terminal.clear();
      // Serialize the now-empty state and persist it, so auto-save
      // and saveAllScrollback don't re-save stale content
      const scrollback = instance.serializeAddon.serialize();
      await setTabScrollback(instance.workspaceId, instance.paneId, instance.tabId, scrollback);
    },

    showSearch(tabId: string) {
      searchVisibleFor = tabId;
    },

    hideSearch(tabId: string) {
      if (searchVisibleFor === tabId) {
        searchVisibleFor = null;
      }
      const instance = instances.get(tabId);
      if (instance) {
        instance.searchAddon.clearDecorations();
        instance.terminal.focus();
      }
    },

    toggleSearch(tabId: string) {
      if (searchVisibleFor === tabId) {
        this.hideSearch(tabId);
      } else {
        this.showSearch(tabId);
      }
    },

    findNext(tabId: string, query: string) {
      const instance = instances.get(tabId);
      if (instance && query) {
        instance.searchAddon.findNext(query);
      }
    },

    findPrevious(tabId: string, query: string) {
      const instance = instances.get(tabId);
      if (instance && query) {
        instance.searchAddon.findPrevious(query);
      }
    },

    async killAllTerminals(): Promise<void> {
      const ptyIds = [...instances.values()].map(i => i.ptyId);
      await Promise.allSettled(
        ptyIds.map(id => killTerminal(id).catch(e => logError(`killAll: ${id} failed: ${e}`)))
      );
    },

    async saveAllScrollback(): Promise<void> {
      _shuttingDown = true;

      // Serialize all terminals synchronously first to avoid interleaving
      const toSave: { workspaceId: string; paneId: string; tabId: string; scrollback: string }[] = [];
      for (const [tabId, instance] of instances) {
        try {
          // Skip serialization when a full-screen app (nano, vim, less, etc.)
          // is using the alternate screen buffer — that content isn't useful
          // for restore and produces artifacts like baked-in nano UI.
          if (instance.terminal.buffer.active.type === 'alternate') continue;
          const scrollback = instance.serializeAddon.serialize();
          toSave.push({
            workspaceId: instance.workspaceId,
            paneId: instance.paneId,
            tabId: instance.tabId,
            scrollback,
          });
        } catch (e) {
          logError(`saveAllScrollback: FAILED ${tabId} - ${e}`);
        }
      }

      // Now send all saves to backend
      const results = await Promise.allSettled(
        toSave.map(({ workspaceId, paneId, tabId, scrollback }) =>
          setTabScrollback(workspaceId, paneId, tabId, scrollback)
        )
      );
      for (const r of results) {
        if (r.status === 'rejected') logError(`Failed to save scrollback: ${r.reason}`);
      }
    }
  };
}

export const terminalsStore = createTerminalsStore();
