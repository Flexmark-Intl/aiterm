import type { Terminal } from '@xterm/xterm';
import type { SplitDirection, SplitNode, Tab, Pane, Workspace } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { preferencesStore } from '$lib/stores/preferences.svelte';
import { getCompiledPatterns } from '$lib/utils/promptPattern';

/**
 * Extract the remote cwd from the terminal prompt using user-configured patterns.
 * Patterns are defined in preferences and compiled to regexes at runtime.
 */
function extractRemoteCwd(terminal: Terminal): string | null {
  const buffer = terminal.buffer.active;
  const cursorLine = buffer.baseY + buffer.cursorY;
  const patterns = getCompiledPatterns(preferencesStore.promptPatterns);
  if (patterns.length === 0) return null;

  for (let i = cursorLine; i >= Math.max(0, cursorLine - 5); i--) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true).trim();
    if (!text) continue;

    for (const re of patterns) {
      const match = text.match(re);
      if (match?.[1]) return match[1];
    }
  }

  return null;
}

function updateRatioInTree(node: SplitNode, splitId: string, ratio: number): SplitNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    children: [
      updateRatioInTree(node.children[0], splitId, ratio),
      updateRatioInTree(node.children[1], splitId, ratio),
    ],
  };
}

function createWorkspacesStore() {
  let workspaces = $state<Workspace[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let sidebarWidth = $state(180);
  let sidebarCollapsed = $state(false);

  const activeWorkspace = $derived(
    workspaces.find(w => w.id === activeWorkspaceId) ?? null
  );

  const activePane = $derived.by(() => {
    if (!activeWorkspace) return null;
    return activeWorkspace.panes.find(p => p.id === activeWorkspace.active_pane_id) ?? null;
  });

  const activeTab = $derived.by(() => {
    if (!activePane) return null;
    return activePane.tabs.find(t => t.id === activePane.active_tab_id) ?? null;
  });

  return {
    get workspaces() { return workspaces; },
    get activeWorkspaceId() { return activeWorkspaceId; },
    get activeWorkspace() { return activeWorkspace; },
    get activePane() { return activePane; },
    get activeTab() { return activeTab; },
    get sidebarWidth() { return sidebarWidth; },
    get sidebarCollapsed() { return sidebarCollapsed; },

    async load() {
      const data = await commands.getAppData();
      workspaces = data.workspaces;
      activeWorkspaceId = data.active_workspace_id;
      sidebarWidth = data.sidebar_width || 180;
      sidebarCollapsed = data.sidebar_collapsed ?? false;

      // Create default workspace if none exist
      if (workspaces.length === 0) {
        await this.createWorkspace('Default');
      }
    },

    setSidebarWidth(width: number) {
      sidebarWidth = Math.max(120, Math.min(400, width));
    },

    async saveSidebarWidth() {
      await commands.setSidebarWidth(sidebarWidth);
    },

    async toggleSidebar() {
      sidebarCollapsed = !sidebarCollapsed;
      await commands.setSidebarCollapsed(sidebarCollapsed);
    },

    async createWorkspace(name: string) {
      const workspace = await commands.createWorkspace(name);
      workspaces = [...workspaces, workspace];
      activeWorkspaceId = workspace.id;
      return workspace;
    },

    async deleteWorkspace(workspaceId: string) {
      await commands.deleteWorkspace(workspaceId);
      workspaces = workspaces.filter(w => w.id !== workspaceId);
      if (activeWorkspaceId === workspaceId) {
        activeWorkspaceId = workspaces[0]?.id ?? null;
      }
    },

    async renameWorkspace(workspaceId: string, name: string) {
      await commands.renameWorkspace(workspaceId, name);
      workspaces = workspaces.map(w =>
        w.id === workspaceId ? { ...w, name } : w
      );
    },

    async setActiveWorkspace(workspaceId: string) {
      await commands.setActiveWorkspace(workspaceId);
      activeWorkspaceId = workspaceId;
    },

    async splitPane(workspaceId: string, targetPaneId: string, direction: SplitDirection) {
      const pane = await commands.splitPane(workspaceId, targetPaneId, direction);
      // Reload workspace to get updated split_root from backend
      const data = await commands.getAppData();
      const ws = data.workspaces.find(w => w.id === workspaceId);
      if (ws) {
        workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
      }
      return pane;
    },

    async splitPaneWithContext(workspaceId: string, sourcePaneId: string, sourceTabId: string, direction: SplitDirection) {
      // 1. Gather context from the source terminal
      const instance = terminalsStore.get(sourceTabId);
      let scrollback: string | null = null;
      let cwd: string | null = null;
      let sshCommand: string | null = null;

      if (instance) {
        // Serialize current scrollback
        if (preferencesStore.cloneScrollback) {
          try {
            scrollback = instance.serializeAddon.serialize();
          } catch (e) {
            console.error('Failed to serialize scrollback for split:', e);
          }
        }

        // Get PTY info (cwd + SSH detection)
        if (preferencesStore.cloneCwd || preferencesStore.cloneSsh) {
          try {
            const info = await commands.getPtyInfo(instance.ptyId);
            cwd = preferencesStore.cloneCwd ? info.cwd : null;
            sshCommand = preferencesStore.cloneSsh ? info.foreground_command : null;
          } catch (e) {
            // PTY may already be gone — fall through with null
          }
        }
      }

      // 2. Create split (with scrollback pre-populated on new tab)
      const newPane = await commands.splitPane(workspaceId, sourcePaneId, direction, scrollback);

      // 2b. Name the new pane and tab properly
      const ws_current = workspaces.find(w => w.id === workspaceId);
      const paneCount = (ws_current?.panes.length ?? 0) + 1; // +1 for the newly created pane
      await commands.renamePane(workspaceId, newPane.id, `Pane ${paneCount}`);

      const sourcePane = ws_current?.panes.find(p => p.id === sourcePaneId);
      const sourceTab = sourcePane?.tabs.find(t => t.id === sourceTabId);
      const newTabId = newPane.tabs[0]?.id;
      if (sourceTab && newTabId) {
        await commands.renameTab(workspaceId, newPane.id, newTabId, sourceTab.name);
      }
      if (newTabId) {
        if (preferencesStore.cloneHistory) {
          try {
            await commands.copyTabHistory(sourceTabId, newTabId);
          } catch (e) {
            console.error('Failed to copy tab history:', e);
          }
        }

        // 4. Store split context for the new TerminalPane to consume on mount
        if (preferencesStore.cloneCwd || preferencesStore.cloneSsh) {
          // OSC 7 gives the most accurate cwd (works for both local and remote shells)
          const osc7Cwd = terminalsStore.getOsc(sourceTabId)?.cwd ?? null;

          let remoteCwd: string | null = null;
          if (sshCommand) {
            // SSH active: OSC 7 may be stale (from the local shell before SSH started)
            // or updated by the remote shell. Compare with the lsof-reported local cwd:
            // if they match, OSC 7 is stale → fall back to prompt heuristic.
            const isOsc7Stale = osc7Cwd === cwd;
            const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
            remoteCwd = osc7RemoteCwd ?? (instance ? extractRemoteCwd(instance.terminal) : null);
          } else if (preferencesStore.cloneCwd) {
            // No SSH: OSC 7 reports local cwd, can supplement lsof
            cwd = cwd ?? osc7Cwd;
          }

          if (cwd || sshCommand) {
            terminalsStore.setSplitContext(newTabId, { cwd, sshCommand, remoteCwd });
          }
        }
      }

      // 5. Reload workspace to get updated split_root
      const data = await commands.getAppData();
      const ws = data.workspaces.find(w => w.id === workspaceId);
      if (ws) {
        workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
      }
      return newPane;
    },

    async deletePane(workspaceId: string, paneId: string) {
      await commands.deletePane(workspaceId, paneId);
      // Reload workspace to get updated split_root from backend
      const data = await commands.getAppData();
      const ws = data.workspaces.find(w => w.id === workspaceId);
      if (ws) {
        workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
      }
    },

    async renamePane(workspaceId: string, paneId: string, name: string) {
      await commands.renamePane(workspaceId, paneId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p =>
              p.id === paneId ? { ...p, name } : p
            )
          };
        }
        return w;
      });
    },

    async setActivePane(workspaceId: string, paneId: string) {
      await commands.setActivePane(workspaceId, paneId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return { ...w, active_pane_id: paneId };
        }
        return w;
      });
    },

    async createTab(workspaceId: string, paneId: string, name: string) {
      const tab = await commands.createTab(workspaceId, paneId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: [...p.tabs, tab],
                  active_tab_id: tab.id
                };
              }
              return p;
            })
          };
        }
        return w;
      });
      return tab;
    },

    async deleteTab(workspaceId: string, paneId: string, tabId: string) {
      await commands.deleteTab(workspaceId, paneId, tabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                const oldIndex = p.tabs.findIndex(t => t.id === tabId);
                const newTabs = p.tabs.filter(t => t.id !== tabId);
                const newActiveId = p.active_tab_id === tabId
                  ? (newTabs[Math.min(oldIndex, newTabs.length - 1)]?.id ?? null)
                  : p.active_tab_id;
                return {
                  ...p,
                  tabs: newTabs,
                  active_tab_id: newActiveId
                };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    async renameTab(workspaceId: string, paneId: string, tabId: string, name: string, customName?: boolean) {
      await commands.renameTab(workspaceId, paneId, tabId, name, customName);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, name, ...(customName !== undefined ? { custom_name: customName } : {}) } : t
                  )
                };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    async setActiveTab(workspaceId: string, paneId: string, tabId: string) {
      await commands.setActiveTab(workspaceId, paneId, tabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return { ...p, active_tab_id: tabId };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    async setTabPtyId(workspaceId: string, paneId: string, tabId: string, ptyId: string) {
      await commands.setTabPtyId(workspaceId, paneId, tabId, ptyId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, pty_id: ptyId } : t
                  )
                };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    setSplitRatioLocal(workspaceId: string, splitId: string, ratio: number) {
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId && w.split_root) {
          return { ...w, split_root: updateRatioInTree(w.split_root, splitId, ratio) };
        }
        return w;
      });
    },

    async persistSplitRatio(workspaceId: string, splitId: string, ratio: number) {
      await commands.setSplitRatio(workspaceId, splitId, ratio);
    }
  };
}

export const workspacesStore = createWorkspacesStore();
