import type { AppData, Layout, Tab, Pane, Workspace } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';

function createWorkspacesStore() {
  let workspaces = $state<Workspace[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let layout = $state<Layout>('horizontal');
  let sidebarWidth = $state(180);

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
    get layout() { return layout; },
    get sidebarWidth() { return sidebarWidth; },

    async load() {
      const data = await commands.getAppData();
      workspaces = data.workspaces;
      activeWorkspaceId = data.active_workspace_id;
      layout = data.layout || 'horizontal';
      sidebarWidth = data.sidebar_width || 180;

      // Create default workspace if none exist
      if (workspaces.length === 0) {
        await this.createWorkspace('Default');
      }
    },

    async setLayout(newLayout: Layout) {
      await commands.setLayout(newLayout);
      layout = newLayout;
    },

    setSidebarWidth(width: number) {
      sidebarWidth = Math.max(120, Math.min(400, width));
    },

    async saveSidebarWidth() {
      await commands.setSidebarWidth(sidebarWidth);
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

    async createPane(workspaceId: string, name: string) {
      const pane = await commands.createPane(workspaceId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: [...w.panes, pane],
            active_pane_id: pane.id
          };
        }
        return w;
      });
      return pane;
    },

    async deletePane(workspaceId: string, paneId: string) {
      await commands.deletePane(workspaceId, paneId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          const newPanes = w.panes.filter(p => p.id !== paneId);
          return {
            ...w,
            panes: newPanes,
            active_pane_id: w.active_pane_id === paneId
              ? newPanes[0]?.id ?? null
              : w.active_pane_id
          };
        }
        return w;
      });
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

    async renameTab(workspaceId: string, paneId: string, tabId: string, name: string) {
      await commands.renameTab(workspaceId, paneId, tabId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, name } : t
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
    }
  };
}

export const workspacesStore = createWorkspacesStore();
