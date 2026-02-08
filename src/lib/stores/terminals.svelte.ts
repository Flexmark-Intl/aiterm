import type { Terminal } from '@xterm/xterm';
import type { SerializeAddon } from '@xterm/addon-serialize';
import { setTabScrollback } from '$lib/tauri/commands';

interface TerminalInstance {
  terminal: Terminal;
  ptyId: string;
  serializeAddon: SerializeAddon;
  workspaceId: string;
  paneId: string;
  tabId: string;
}

function createTerminalsStore() {
  let instances = $state<Map<string, TerminalInstance>>(new Map());
  let _shuttingDown = false;

  return {
    get instances() { return instances; },
    get shuttingDown() { return _shuttingDown; },

    register(
      tabId: string,
      terminal: Terminal,
      ptyId: string,
      serializeAddon: SerializeAddon,
      workspaceId: string,
      paneId: string
    ) {
      instances = new Map(instances);
      instances.set(tabId, { terminal, ptyId, serializeAddon, workspaceId, paneId, tabId });
    },

    unregister(tabId: string) {
      instances = new Map(instances);
      instances.delete(tabId);
    },

    get(tabId: string): TerminalInstance | undefined {
      return instances.get(tabId);
    },

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
