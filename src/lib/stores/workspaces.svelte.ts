import type { AppData, Layout, Tab, Window, Workspace } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';

function createWorkspacesStore() {
  let workspaces = $state<Workspace[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let layout = $state<Layout>('horizontal');
  let sidebarWidth = $state(180);

  const activeWorkspace = $derived(
    workspaces.find(w => w.id === activeWorkspaceId) ?? null
  );

  const activeWindow = $derived.by(() => {
    if (!activeWorkspace) return null;
    return activeWorkspace.windows.find(w => w.id === activeWorkspace.active_window_id) ?? null;
  });

  const activeTab = $derived.by(() => {
    if (!activeWindow) return null;
    return activeWindow.tabs.find(t => t.id === activeWindow.active_tab_id) ?? null;
  });

  return {
    get workspaces() { return workspaces; },
    get activeWorkspaceId() { return activeWorkspaceId; },
    get activeWorkspace() { return activeWorkspace; },
    get activeWindow() { return activeWindow; },
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

    async createWindow(workspaceId: string, name: string) {
      const window = await commands.createWindow(workspaceId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: [...w.windows, window],
            active_window_id: window.id
          };
        }
        return w;
      });
      return window;
    },

    async deleteWindow(workspaceId: string, windowId: string) {
      await commands.deleteWindow(workspaceId, windowId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          const newWindows = w.windows.filter(win => win.id !== windowId);
          return {
            ...w,
            windows: newWindows,
            active_window_id: w.active_window_id === windowId
              ? newWindows[0]?.id ?? null
              : w.active_window_id
          };
        }
        return w;
      });
    },

    async renameWindow(workspaceId: string, windowId: string, name: string) {
      await commands.renameWindow(workspaceId, windowId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win =>
              win.id === windowId ? { ...win, name } : win
            )
          };
        }
        return w;
      });
    },

    async setActiveWindow(workspaceId: string, windowId: string) {
      await commands.setActiveWindow(workspaceId, windowId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return { ...w, active_window_id: windowId };
        }
        return w;
      });
    },

    async createTab(workspaceId: string, windowId: string, name: string) {
      const tab = await commands.createTab(workspaceId, windowId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                return {
                  ...win,
                  tabs: [...win.tabs, tab],
                  active_tab_id: tab.id
                };
              }
              return win;
            })
          };
        }
        return w;
      });
      return tab;
    },

    async deleteTab(workspaceId: string, windowId: string, tabId: string) {
      await commands.deleteTab(workspaceId, windowId, tabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                const oldIndex = win.tabs.findIndex(t => t.id === tabId);
                const newTabs = win.tabs.filter(t => t.id !== tabId);
                const newActiveId = win.active_tab_id === tabId
                  ? (newTabs[Math.min(oldIndex, newTabs.length - 1)]?.id ?? null)
                  : win.active_tab_id;
                return {
                  ...win,
                  tabs: newTabs,
                  active_tab_id: newActiveId
                };
              }
              return win;
            })
          };
        }
        return w;
      });
    },

    async renameTab(workspaceId: string, windowId: string, tabId: string, name: string) {
      await commands.renameTab(workspaceId, windowId, tabId, name);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                return {
                  ...win,
                  tabs: win.tabs.map(t =>
                    t.id === tabId ? { ...t, name } : t
                  )
                };
              }
              return win;
            })
          };
        }
        return w;
      });
    },

    async setActiveTab(workspaceId: string, windowId: string, tabId: string) {
      await commands.setActiveTab(workspaceId, windowId, tabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                return { ...win, active_tab_id: tabId };
              }
              return win;
            })
          };
        }
        return w;
      });
    },

    async setTabPtyId(workspaceId: string, windowId: string, tabId: string, ptyId: string) {
      await commands.setTabPtyId(workspaceId, windowId, tabId, ptyId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            windows: w.windows.map(win => {
              if (win.id === windowId) {
                return {
                  ...win,
                  tabs: win.tabs.map(t =>
                    t.id === tabId ? { ...t, pty_id: ptyId } : t
                  )
                };
              }
              return win;
            })
          };
        }
        return w;
      });
    }
  };
}

export const workspacesStore = createWorkspacesStore();
