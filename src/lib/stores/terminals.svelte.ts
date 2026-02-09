import type { Terminal } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';
import type { SearchAddon } from '@xterm/addon-search';
import { setTabScrollback, setTabRestoreContext, getPtyInfo } from '$lib/tauri/commands';
import { getCompiledPatterns } from '$lib/utils/promptPattern';

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
      // Clear scrollback buffer but keep current viewport (prompt stays visible)
      instance.terminal.write('\x1b[3J');
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

    /**
     * Save restore context (cwd, SSH, remote cwd) for all terminals.
     * Called during shutdown when restore_session preference is enabled.
     */
    async saveAllRestoreContext(promptPatterns: string[]): Promise<void> {
      const compiledPatterns = getCompiledPatterns(promptPatterns);

      const saves: Promise<void>[] = [];
      for (const [, instance] of instances) {
        saves.push((async () => {
          let cwd: string | null = null;
          let sshCommand: string | null = null;
          let remoteCwd: string | null = null;

          try {
            const info = await getPtyInfo(instance.ptyId);
            cwd = info.cwd;
            sshCommand = info.foreground_command;
          } catch {
            // PTY may already be gone
          }

          // Determine remote cwd using same logic as split cloning
          const osc7Cwd = instance.osc.cwd;
          if (sshCommand) {
            const isOsc7Stale = osc7Cwd === cwd;
            const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
            if (osc7RemoteCwd) {
              remoteCwd = osc7RemoteCwd;
            } else {
              // Fall back to prompt pattern extraction
              const buffer = instance.terminal.buffer.active;
              const cursorLine = buffer.baseY + buffer.cursorY;
              for (let i = cursorLine; i >= Math.max(0, cursorLine - 5); i--) {
                const line = buffer.getLine(i);
                if (!line) continue;
                const text = line.translateToString(true).trim();
                if (!text) continue;
                for (const re of compiledPatterns) {
                  const match = text.match(re);
                  if (match?.[1]) { remoteCwd = match[1]; break; }
                }
                if (remoteCwd) break;
              }
            }
          } else {
            // No SSH: OSC 7 supplements lsof cwd
            cwd = cwd ?? osc7Cwd;
          }

          await setTabRestoreContext(
            instance.workspaceId, instance.paneId, instance.tabId,
            cwd, sshCommand, remoteCwd,
          );
        })());
      }

      await Promise.allSettled(saves);
    },

    async saveAllScrollback(): Promise<void> {
      _shuttingDown = true;

      // Serialize all terminals synchronously first to avoid interleaving
      const toSave: { workspaceId: string; paneId: string; tabId: string; scrollback: string }[] = [];
      for (const [tabId, instance] of instances) {
        try {
          const scrollback = instance.serializeAddon.serialize();
          toSave.push({
            workspaceId: instance.workspaceId,
            paneId: instance.paneId,
            tabId: instance.tabId,
            scrollback,
          });
        } catch (e) {
          console.error(`saveAllScrollback: FAILED ${tabId} -`, e);
        }
      }

      // Now send all saves to backend
      const results = await Promise.allSettled(
        toSave.map(({ workspaceId, paneId, tabId, scrollback }) =>
          setTabScrollback(workspaceId, paneId, tabId, scrollback)
        )
      );
      for (const r of results) {
        if (r.status === 'rejected') console.error('Failed to save scrollback:', r.reason);
      }
    }
  };
}

export const terminalsStore = createTerminalsStore();
