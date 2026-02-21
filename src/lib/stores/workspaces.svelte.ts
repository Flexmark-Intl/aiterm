import type { Terminal } from '@xterm/xterm';
import type { SplitDirection, SplitNode, Tab, Pane, Workspace, WorkspaceNote, EditorFileInfo, DiffContext } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { preferencesStore } from '$lib/stores/preferences.svelte';
import { activityStore } from '$lib/stores/activity.svelte';
import { getCompiledPatterns } from '$lib/utils/promptPattern';
import { error as logError } from '@tauri-apps/plugin-log';
import { getVariables } from '$lib/stores/triggers.svelte';
import { CLAUDE_RESUME_COMMAND } from '$lib/triggers/defaults';

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

/**
 * Compute a deduplicated name for a duplicated custom-named tab.
 * Strips leading "N " to get the base, finds the highest existing index
 * among all tab names in the workspace, and returns "N+1 base".
 */
function nextDuplicateName(sourceName: string, existingNames: string[]): string {
  const baseMatch = sourceName.match(/^(\d+)\s+(.+)$/);
  const baseName = baseMatch ? baseMatch[2] : sourceName;

  let maxIndex = 0;
  for (const name of existingNames) {
    if (name === baseName) {
      maxIndex = Math.max(maxIndex, 1);
    } else {
      const m = name.match(/^(\d+)\s+(.+)$/);
      if (m && m[2] === baseName) {
        maxIndex = Math.max(maxIndex, parseInt(m[1], 10));
      }
    }
  }

  if (maxIndex === 0) return sourceName;
  return `${maxIndex + 1} ${baseName}`;
}

/** Collect all tab names across all panes in a workspace. */
function allTabNames(ws: Workspace): string[] {
  return ws.panes.flatMap(p => p.tabs.map(t => t.name));
}

const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

function createWorkspacesStore() {
  let workspaces = $state<Workspace[]>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let sidebarWidth = $state(180);
  let sidebarCollapsed = $state(false);
  let lastSwitchedAt = $state<Map<string, number>>(new Map());
  // Frontend-only: set of tab IDs with notes panel visible
  let notesVisible = $state<Set<string>>(new Set());
  // Tick counter to force re-evaluation of recentWorkspaces when entries expire
  let _recentTick = $state(0);
  let _recentTimer: ReturnType<typeof setInterval> | null = null;

  const recentWorkspaces = $derived.by(() => {
    void _recentTick; // subscribe to tick for expiry re-evaluation
    const now = Date.now();
    return workspaces.filter(w => {
      if (w.id === activeWorkspaceId) return false;
      const ts = lastSwitchedAt.get(w.id);
      return ts != null && (now - ts) < RECENT_WINDOW_MS;
    });
  });

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
    get recentWorkspaces() { return recentWorkspaces; },
    get lastSwitchedAt() { return lastSwitchedAt; },

    reset() {
      workspaces = [];
      activeWorkspaceId = null;
    },

    async load() {
      const data = await commands.getWindowData();
      workspaces = data.workspaces;
      activeWorkspaceId = data.active_workspace_id;
      sidebarWidth = data.sidebar_width || 180;
      sidebarCollapsed = data.sidebar_collapsed ?? false;

      // Seed notesVisible from persisted notes_open state
      const seeded = new Set<string>();
      for (const ws of data.workspaces) {
        for (const pane of ws.panes) {
          for (const tab of pane.tabs) {
            if (tab.notes_open) seeded.add(tab.id);
          }
        }
      }
      notesVisible = seeded;

      // Migration: update old auto-resume commands to current version
      const OLD_RESUME_COMMANDS = [
        'if [ -n "%claudeSessionId" ]; then claude --resume %claudeSessionId; elif [ -n "%claudeResumeCommand" ]; then %claudeResumeCommand; else claude --continue; fi',
      ];
      for (const ws of workspaces) {
        for (const pane of ws.panes) {
          for (const tab of pane.tabs) {
            if (tab.auto_resume_command && OLD_RESUME_COMMANDS.includes(tab.auto_resume_command)) {
              tab.auto_resume_command = CLAUDE_RESUME_COMMAND;
              tab.auto_resume_remembered_command = CLAUDE_RESUME_COMMAND;
              await commands.setTabAutoResumeContext(
                ws.id, pane.id, tab.id,
                tab.auto_resume_cwd, tab.auto_resume_ssh_command,
                tab.auto_resume_remote_cwd, CLAUDE_RESUME_COMMAND,
              );
            }
          }
        }
      }

      // Create default workspace if none exist
      if (workspaces.length === 0) {
        await this.createWorkspace('Default');
      }

      // Start periodic tick to expire recent workspaces
      if (!_recentTimer) {
        _recentTimer = setInterval(() => { _recentTick++; }, 60_000);
      }

      // Keep local tab.last_cwd in sync with live OSC state and persist to backend
      terminalsStore.onOscChange((tabId, osc) => {
        const resolvedCwd = osc.cwd ?? osc.promptCwd;
        if (!resolvedCwd) return;
        for (const ws of workspaces) {
          for (const p of ws.panes) {
            const tab = p.tabs.find(t => t.id === tabId);
            if (tab && tab.last_cwd !== resolvedCwd) {
              tab.last_cwd = resolvedCwd;
              commands.setTabLastCwd(ws.id, p.id, tabId, resolvedCwd).catch(() => {});
              return;
            }
          }
        }
      });
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
      const oldIndex = workspaces.findIndex(w => w.id === workspaceId);
      await commands.deleteWorkspace(workspaceId);
      workspaces = workspaces.filter(w => w.id !== workspaceId);
      if (lastSwitchedAt.has(workspaceId)) {
        const updated = new Map(lastSwitchedAt);
        updated.delete(workspaceId);
        lastSwitchedAt = updated;
      }
      if (activeWorkspaceId === workspaceId) {
        // Activate adjacent: prefer previous, fall back to next
        const adjacentIndex = Math.min(oldIndex, workspaces.length - 1);
        activeWorkspaceId = workspaces[adjacentIndex]?.id ?? null;
      }
    },

    async renameWorkspace(workspaceId: string, name: string) {
      await commands.renameWorkspace(workspaceId, name);
      workspaces = workspaces.map(w =>
        w.id === workspaceId ? { ...w, name } : w
      );
    },

    async setActiveWorkspace(workspaceId: string) {
      // Record the workspace we're leaving as recently active
      if (activeWorkspaceId && activeWorkspaceId !== workspaceId) {
        const updated = new Map(lastSwitchedAt);
        updated.set(activeWorkspaceId, Date.now());
        lastSwitchedAt = updated;
      }
      await commands.setActiveWorkspace(workspaceId);
      activeWorkspaceId = workspaceId;
    },

    async splitPane(workspaceId: string, targetPaneId: string, direction: SplitDirection) {
      const pane = await commands.splitPane(workspaceId, targetPaneId, direction);
      // Reload workspace to get updated split_root from backend
      const data = await commands.getWindowData();
      const ws = data.workspaces.find(w => w.id === workspaceId);
      if (ws) {
        workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
      }
      return pane;
    },

    async splitPaneWithContext(workspaceId: string, sourcePaneId: string, sourceTabId: string, direction: SplitDirection) {
      // Look up source tab to determine its type
      const ws_current = workspaces.find(w => w.id === workspaceId);
      const sourcePane = ws_current?.panes.find(p => p.id === sourcePaneId);
      const sourceTab = sourcePane?.tabs.find(t => t.id === sourceTabId);

      // Editor tab: create a duplicate editor pane (no terminal context needed)
      if (sourceTab?.tab_type === 'editor' && sourceTab.editor_file) {
        const newPane = await commands.splitPane(workspaceId, sourcePaneId, direction, null, sourceTab.editor_file);

        // Copy notes
        const newTabId = newPane.tabs[0]?.id;
        if (newTabId) {
          if (preferencesStore.cloneNotes && sourceTab.notes) {
            await commands.setTabNotes(workspaceId, newPane.id, newTabId, sourceTab.notes);
          }
          if (preferencesStore.cloneNotes && sourceTab.notes_mode) {
            await commands.setTabNotesMode(workspaceId, newPane.id, newTabId, sourceTab.notes_mode);
          }
        }

        // Reload workspace to get updated split_root
        const data = await commands.getWindowData();
        const ws = data.workspaces.find(w => w.id === workspaceId);
        if (ws) {
          workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
        }
        return newPane;
      }

      // Terminal tab: gather context from the source terminal
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
            logError(`Failed to serialize scrollback for split: ${e}`);
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
      const paneCount = (ws_current?.panes.length ?? 0) + 1; // +1 for the newly created pane
      await commands.renamePane(workspaceId, newPane.id, `Pane ${paneCount}`);

      const newTabId = newPane.tabs[0]?.id;
      if (sourceTab && newTabId) {
        const tabName = sourceTab.custom_name && ws_current
          ? nextDuplicateName(sourceTab.name, allTabNames(ws_current))
          : sourceTab.name;
        await commands.renameTab(workspaceId, newPane.id, newTabId, tabName, sourceTab.custom_name);

        // Copy notes
        if (preferencesStore.cloneNotes && sourceTab.notes) {
          await commands.setTabNotes(workspaceId, newPane.id, newTabId, sourceTab.notes);
        }
        if (preferencesStore.cloneNotes && sourceTab.notes_mode) {
          await commands.setTabNotesMode(workspaceId, newPane.id, newTabId, sourceTab.notes_mode);
        }

        // Copy trigger variables
        if (preferencesStore.cloneVariables) {
          const srcVars = getVariables(sourceTabId);
          if (srcVars && srcVars.size > 0) {
            const plain: Record<string, string> = {};
            for (const [k, v] of srcVars) plain[k] = v;
            await commands.setTabTriggerVariables(workspaceId, newPane.id, newTabId, plain).catch(e =>
              logError(`Failed to copy trigger variables: ${e}`)
            );
          }
        }

        // Copy auto-resume settings
        if (preferencesStore.cloneAutoResume && (sourceTab.auto_resume_cwd || sourceTab.auto_resume_ssh_command || sourceTab.auto_resume_command)) {
          await this.setTabAutoResumeContext(
            workspaceId, newPane.id, newTabId,
            sourceTab.auto_resume_cwd,
            sourceTab.auto_resume_ssh_command,
            sourceTab.auto_resume_remote_cwd,
            sourceTab.auto_resume_command,
          );
        }
      }
      if (newTabId) {
        if (preferencesStore.cloneHistory) {
          try {
            await commands.copyTabHistory(sourceTabId, newTabId);
          } catch (e) {
            logError(`Failed to copy tab history: ${e}`);
          }
        }

        // 4. Store split context for the new TerminalPane to consume on mount
        if (preferencesStore.cloneCwd || preferencesStore.cloneSsh) {
          // OSC 7 gives the most accurate cwd (works for both local and remote shells)
          const oscState = terminalsStore.getOsc(sourceTabId);
          const osc7Cwd = oscState?.cwd ?? null;
          const promptCwd = oscState?.promptCwd ?? null;

          let remoteCwd: string | null = null;
          if (sshCommand) {
            // SSH active: OSC 7 may be stale (from the local shell before SSH started)
            // or updated by the remote shell. Compare with the lsof-reported local cwd:
            // if they match, OSC 7 is stale → fall back to promptCwd then buffer scan.
            const isOsc7Stale = osc7Cwd === cwd;
            const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
            remoteCwd = osc7RemoteCwd ?? promptCwd ?? (instance ? extractRemoteCwd(instance.terminal) : null);
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
      const data = await commands.getWindowData();
      const ws = data.workspaces.find(w => w.id === workspaceId);
      if (ws) {
        workspaces = workspaces.map(w => w.id === workspaceId ? ws : w);
      }
      return newPane;
    },

    async deletePane(workspaceId: string, paneId: string) {
      await commands.deletePane(workspaceId, paneId);
      // Reload workspace to get updated split_root from backend
      const data = await commands.getWindowData();
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
      const pane = workspaces.flatMap(w => w.panes).find(p => p.id === paneId);
      const afterTabId = pane?.active_tab_id ?? undefined;
      const tab = await commands.createTab(workspaceId, paneId, name, afterTabId);

      // Open new tab at the most common CWD among sibling terminal tabs
      const ws = workspaces.find(w => w.id === workspaceId);
      if (ws) {
        const cwdCounts = new Map<string, number>();
        for (const p of ws.panes) {
          for (const t of p.tabs) {
            if (t.tab_type !== 'terminal' || !t.last_cwd) continue;
            cwdCounts.set(t.last_cwd, (cwdCounts.get(t.last_cwd) ?? 0) + 1);
          }
        }
        let bestCwd: string | null = null;
        let bestCount = 0;
        for (const [cwd, count] of cwdCounts) {
          if (count > bestCount) { bestCwd = cwd; bestCount = count; }
        }
        if (bestCwd) {
          terminalsStore.setSplitContext(tab.id, { cwd: bestCwd, sshCommand: null, remoteCwd: null });
        }
      }

      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                const insertIdx = afterTabId
                  ? p.tabs.findIndex(t => t.id === afterTabId) + 1
                  : p.tabs.length;
                const newTabs = [...p.tabs];
                newTabs.splice(insertIdx >= 0 ? insertIdx : p.tabs.length, 0, tab);
                return {
                  ...p,
                  tabs: newTabs,
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

    async createEditorTab(workspaceId: string, paneId: string, name: string, fileInfo: EditorFileInfo) {
      // Find the active tab so the new tab is inserted right after it
      const pane = workspaces.flatMap(w => w.panes).find(p => p.id === paneId);
      const afterTabId = pane?.active_tab_id ?? undefined;
      const tab = await commands.createEditorTab(workspaceId, paneId, name, fileInfo, afterTabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                // Insert directly after the currently active tab
                const activeIdx = p.tabs.findIndex(t => t.id === p.active_tab_id);
                const insertIdx = activeIdx === -1 ? p.tabs.length : activeIdx + 1;
                const newTabs = [...p.tabs];
                newTabs.splice(insertIdx, 0, tab);
                return {
                  ...p,
                  tabs: newTabs,
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

    async createDiffTab(workspaceId: string, paneId: string, name: string, diffContext: DiffContext, afterTabId?: string | null) {
      const tab = await commands.createDiffTab(workspaceId, paneId, name, diffContext, afterTabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                const activeIdx = p.tabs.findIndex(t => t.id === (afterTabId ?? p.active_tab_id));
                const insertIdx = activeIdx === -1 ? p.tabs.length : activeIdx + 1;
                const newTabs = [...p.tabs];
                newTabs.splice(insertIdx, 0, tab);
                return {
                  ...p,
                  tabs: newTabs,
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
      // Migrate tab notes to workspace if enabled
      if (preferencesStore.migrateTabNotes) {
        const ws = workspaces.find(w => w.id === workspaceId);
        const pane = ws?.panes.find(p => p.id === paneId);
        const tab = pane?.tabs.find(t => t.id === tabId);
        if (tab?.notes?.trim()) {
          try {
            const note = await commands.addWorkspaceNote(workspaceId, tab.notes, tab.notes_mode ?? null);
            if (ws) {
              ws.workspace_notes = [...ws.workspace_notes, note];
            }
          } catch (e) {
            logError(`Failed to migrate tab notes: ${e}`);
          }
        }
      }
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
                  ? (newTabs[oldIndex > 0 ? oldIndex - 1 : 0]?.id ?? null)
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

    async archiveTab(workspaceId: string, paneId: string, tabId: string, displayName: string) {
      const ws = workspaces.find(w => w.id === workspaceId);
      const pane = ws?.panes.find(p => p.id === paneId);
      const tab = pane?.tabs.find(t => t.id === tabId);
      if (!tab) return;

      // Gather context
      const { scrollback, cwd, sshCommand } = await this._gatherTabContext(tabId);

      // Detect remote cwd
      let remoteCwd: string | null = null;
      if (sshCommand) {
        const instance = terminalsStore.get(tabId);
        const oscState = terminalsStore.getOsc(tabId);
        const osc7Cwd = oscState?.cwd ?? null;
        const promptCwd = oscState?.promptCwd ?? null;
        const isOsc7Stale = osc7Cwd === cwd;
        const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
        remoteCwd = osc7RemoteCwd ?? promptCwd ?? null;
      }

      // Skip note migration — archived tabs preserve their notes and restore them intact

      await commands.archiveTab(workspaceId, paneId, tabId, displayName, scrollback, cwd, sshCommand, remoteCwd);

      // Build the archived tab object for local state
      const archivedTab: Tab = {
        ...tab,
        name: displayName,
        custom_name: true,
        pty_id: null,
        scrollback,
        restore_cwd: cwd,
        restore_ssh_command: sshCommand,
        restore_remote_cwd: remoteCwd,
        archived_at: new Date().toISOString(),
      };

      // Update local state
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            archived_tabs: [...w.archived_tabs, archivedTab],
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                const oldIndex = p.tabs.findIndex(t => t.id === tabId);
                const newTabs = p.tabs.filter(t => t.id !== tabId);
                const newActiveId = p.active_tab_id === tabId
                  ? (newTabs[oldIndex > 0 ? oldIndex - 1 : 0]?.id ?? null)
                  : p.active_tab_id;
                return { ...p, tabs: newTabs, active_tab_id: newActiveId };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    async restoreArchivedTab(workspaceId: string, tabId: string) {
      const ws = workspaces.find(w => w.id === workspaceId);
      if (!ws) return;

      // Find active pane
      const pane = ws.panes.find(p => p.id === ws.active_pane_id) ?? ws.panes[0];
      if (!pane) return;

      const tab = await commands.restoreArchivedTab(workspaceId, pane.id, tabId);

      // Update local state
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            archived_tabs: w.archived_tabs.filter(t => t.id !== tabId),
            panes: w.panes.map(p => {
              if (p.id === pane.id) {
                return { ...p, tabs: [tab, ...p.tabs], active_tab_id: tab.id };
              }
              return p;
            })
          };
        }
        return w;
      });
    },

    async deleteArchivedTab(workspaceId: string, tabId: string) {
      await commands.deleteArchivedTab(workspaceId, tabId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return { ...w, archived_tabs: w.archived_tabs.filter(t => t.id !== tabId) };
        }
        return w;
      });
    },

    async reorderTabs(workspaceId: string, paneId: string, tabIds: string[]) {
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                const reordered = tabIds
                  .map(id => p.tabs.find(t => t.id === id))
                  .filter((t): t is Tab => t !== undefined);
                return { ...p, tabs: reordered };
              }
              return p;
            })
          };
        }
        return w;
      });
      await commands.reorderTabs(workspaceId, paneId, tabIds);
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

    async setTabAutoResumeContext(workspaceId: string, paneId: string, tabId: string, cwd: string | null, sshCommand: string | null, remoteCwd: string | null, command: string | null = null) {
      await commands.setTabAutoResumeContext(workspaceId, paneId, tabId, cwd, sshCommand, remoteCwd, command);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, auto_resume_cwd: cwd, auto_resume_ssh_command: sshCommand, auto_resume_remote_cwd: remoteCwd, auto_resume_command: command, ...(command != null ? { auto_resume_remembered_command: command } : {}) } : t
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
    },

    /**
     * Gather terminal context (scrollback, cwd, SSH, history) for a source tab.
     * Shared by splitPaneWithContext, moveTabToWorkspace, and copyTabToWorkspace.
     */
    async _gatherTabContext(sourceTabId: string) {
      const instance = terminalsStore.get(sourceTabId);
      let scrollback: string | null = null;
      let cwd: string | null = null;
      let sshCommand: string | null = null;

      if (instance) {
        if (preferencesStore.cloneScrollback) {
          try {
            scrollback = instance.serializeAddon.serialize();
          } catch (e) {
            logError(`Failed to serialize scrollback: ${e}`);
          }
        }

        if (preferencesStore.cloneCwd || preferencesStore.cloneSsh) {
          try {
            const info = await commands.getPtyInfo(instance.ptyId);
            cwd = preferencesStore.cloneCwd ? info.cwd : null;
            sshCommand = preferencesStore.cloneSsh ? info.foreground_command : null;
          } catch (e) {
            // PTY may already be gone
          }
        }
      }

      return { instance, scrollback, cwd, sshCommand };
    },

    /**
     * Store split context (cwd/SSH) for a newly created tab so TerminalPane
     * consumes it on mount.
     */
    _storeSplitContext(sourceTabId: string, newTabId: string, cwd: string | null, sshCommand: string | null, instance: { terminal: import('@xterm/xterm').Terminal } | undefined) {
      if (!preferencesStore.cloneCwd && !preferencesStore.cloneSsh) return;

      const oscState = terminalsStore.getOsc(sourceTabId);
      const osc7Cwd = oscState?.cwd ?? null;
      const promptCwd = oscState?.promptCwd ?? null;

      let remoteCwd: string | null = null;
      if (sshCommand) {
        const isOsc7Stale = osc7Cwd === cwd;
        const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
        remoteCwd = osc7RemoteCwd ?? promptCwd ?? (instance ? extractRemoteCwd(instance.terminal) : null);
      } else if (preferencesStore.cloneCwd) {
        cwd = cwd ?? osc7Cwd;
      }

      if (cwd || sshCommand) {
        terminalsStore.setSplitContext(newTabId, { cwd, sshCommand, remoteCwd });
      }
    },

    /**
     * Copy a tab to another workspace (clone with context, keep source).
     */
    async copyTabToWorkspace(sourceWsId: string, sourcePaneId: string, sourceTabId: string, targetWsId: string) {
      const sourceWs = workspaces.find(w => w.id === sourceWsId);
      const sourcePane = sourceWs?.panes.find(p => p.id === sourcePaneId);
      const sourceTab = sourcePane?.tabs.find(t => t.id === sourceTabId);
      if (!sourceTab) return;

      // Gather context from source
      const { instance, scrollback, cwd, sshCommand } = await this._gatherTabContext(sourceTabId);

      // Create tab in target workspace's first pane, preserving original active tab
      const targetWs = workspaces.find(w => w.id === targetWsId);
      if (!targetWs || targetWs.panes.length === 0) return;
      const targetPane = targetWs.panes[0];
      const previousActiveTabId = targetPane.active_tab_id;

      const tabName = sourceTab.custom_name
        ? nextDuplicateName(sourceTab.name, allTabNames(targetWs))
        : sourceTab.name;
      const newTab = await commands.createTab(targetWsId, targetPane.id, tabName);

      // Restore the previously active tab (createTab sets the new one as active)
      if (previousActiveTabId) {
        await commands.setActiveTab(targetWsId, targetPane.id, previousActiveTabId);
      }

      // Set scrollback on the new tab
      if (scrollback) {
        await commands.setTabScrollback(targetWsId, targetPane.id, newTab.id, scrollback);
      }

      // Copy custom name
      if (sourceTab.custom_name) {
        await commands.renameTab(targetWsId, targetPane.id, newTab.id, tabName, true);
      }

      // Copy history
      if (preferencesStore.cloneHistory) {
        try {
          await commands.copyTabHistory(sourceTabId, newTab.id);
        } catch (e) {
          logError(`Failed to copy tab history: ${e}`);
        }
      }

      // Copy notes
      if (preferencesStore.cloneNotes && sourceTab.notes) {
        await commands.setTabNotes(targetWsId, targetPane.id, newTab.id, sourceTab.notes);
      }
      if (preferencesStore.cloneNotes && sourceTab.notes_mode) {
        await commands.setTabNotesMode(targetWsId, targetPane.id, newTab.id, sourceTab.notes_mode);
      }

      // Copy trigger variables
      if (preferencesStore.cloneVariables) {
        const srcVars = getVariables(sourceTabId);
        if (srcVars && srcVars.size > 0) {
          const plain: Record<string, string> = {};
          for (const [k, v] of srcVars) plain[k] = v;
          await commands.setTabTriggerVariables(targetWsId, targetPane.id, newTab.id, plain).catch(e =>
            logError(`Failed to copy trigger variables: ${e}`)
          );
        }
      }

      // Copy auto-resume settings
      if (preferencesStore.cloneAutoResume && (sourceTab.auto_resume_cwd || sourceTab.auto_resume_ssh_command || sourceTab.auto_resume_command)) {
        await this.setTabAutoResumeContext(
          targetWsId, targetPane.id, newTab.id,
          sourceTab.auto_resume_cwd,
          sourceTab.auto_resume_ssh_command,
          sourceTab.auto_resume_remote_cwd,
          sourceTab.auto_resume_command,
        );
      }

      // Store split context for the new terminal
      this._storeSplitContext(sourceTabId, newTab.id, cwd, sshCommand, instance);

      // Mark as unreviewed activity so the tab shows the activity dot
      activityStore.markActive(newTab.id);

      // Reload all workspaces
      const data = await commands.getWindowData();
      workspaces = data.workspaces;
    },

    /**
     * Move a tab to another workspace (delete source, create in target).
     */
    async moveTabToWorkspace(sourceWsId: string, sourcePaneId: string, sourceTabId: string, targetWsId: string) {
      // Copy first, then delete source
      await this.copyTabToWorkspace(sourceWsId, sourcePaneId, sourceTabId, targetWsId);

      // Delete source tab (or pane if last tab)
      const sourceWs = workspaces.find(w => w.id === sourceWsId);
      const sourcePane = sourceWs?.panes.find(p => p.id === sourcePaneId);
      if (!sourcePane) return;

      const sourceTab = sourcePane.tabs.find(t => t.id === sourceTabId);
      if (!sourceTab) return; // already gone

      if (sourcePane.tabs.length <= 1) {
        // Last tab — delete the pane (if not last pane)
        if (sourceWs && sourceWs.panes.length > 1) {
          await commands.deletePane(sourceWsId, sourcePaneId);
        } else {
          // Last pane in workspace — just delete the tab and create a fresh one
          await commands.deleteTab(sourceWsId, sourcePaneId, sourceTabId);
          await commands.createTab(sourceWsId, sourcePaneId, 'Terminal 1');
        }
      } else {
        await commands.deleteTab(sourceWsId, sourcePaneId, sourceTabId);
      }

      // Reload all workspaces to reflect deletions
      const data = await commands.getWindowData();
      workspaces = data.workspaces;
    },

    async reorderWorkspaces(workspaceIds: string[]) {
      const reordered = workspaceIds
        .map(id => workspaces.find(w => w.id === id))
        .filter((w): w is Workspace => w !== undefined);
      workspaces = reordered;
      await commands.reorderWorkspaces(workspaceIds);
    },

    async duplicateWorkspace(sourceWorkspaceId: string, insertIndex: number) {
      const ws = workspaces.find(w => w.id === sourceWorkspaceId);
      if (!ws) return;

      // 1. Gather context for all tabs in source workspace
      const tabContexts: commands.TabContext[] = [];
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          const ctx = await this._gatherTabContext(tab.id);

          let remoteCwd: string | null = null;
          if (ctx.sshCommand && ctx.instance) {
            const oscState = terminalsStore.getOsc(tab.id);
            const osc7Cwd = oscState?.cwd ?? null;
            const promptCwd = oscState?.promptCwd ?? null;
            const isOsc7Stale = osc7Cwd === ctx.cwd;
            const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
            remoteCwd = osc7RemoteCwd ?? promptCwd ?? extractRemoteCwd(ctx.instance.terminal);
          }

          tabContexts.push({
            tab_id: tab.id,
            scrollback: ctx.scrollback,
            cwd: ctx.cwd,
            ssh_command: ctx.sshCommand,
            remote_cwd: remoteCwd,
          });
        }
      }

      // 2. Duplicate on backend (deep-clones with new IDs, applies scrollback)
      const result = await commands.duplicateWorkspaceCmd(sourceWorkspaceId, insertIndex, tabContexts);

      // 3. Copy shell history for each tab pair
      if (preferencesStore.cloneHistory) {
        for (const [oldTabId, newTabId] of Object.entries(result.tab_id_map)) {
          try {
            await commands.copyTabHistory(oldTabId, newTabId);
          } catch (e) {
            // ignore — history may not exist
          }
        }
      }

      // 4. Rename duplicate workspace
      const dupName = nextDuplicateName(ws.name, workspaces.map(w => w.name));
      await commands.renameWorkspace(result.workspace.id, dupName);

      // 5. Reload all workspaces to get consistent state
      const data = await commands.getWindowData();
      workspaces = data.workspaces;
    },

    async duplicateTab(workspaceId: string, paneId: string, tabId: string, opts?: { shallow?: boolean }) {
      const ws = workspaces.find(w => w.id === workspaceId);
      const pane = ws?.panes.find(p => p.id === paneId);
      const sourceTab = pane?.tabs.find(t => t.id === tabId);
      if (!sourceTab) return;

      const shallow = opts?.shallow ?? false;

      // 1. Gather context from source terminal
      const { instance, scrollback, cwd, sshCommand } = await this._gatherTabContext(tabId);

      // 2. Compute duplicate name with incrementing index for custom names
      const dupName = sourceTab.custom_name
        ? nextDuplicateName(sourceTab.name, allTabNames(ws!))
        : sourceTab.name;

      // 3. Create new tab (appended at end)
      const newTab = await commands.createTab(workspaceId, paneId, dupName);

      // 4. Copy custom name if source had one
      if (sourceTab.custom_name) {
        await commands.renameTab(workspaceId, paneId, newTab.id, dupName, true);
      }

      // 5. Set scrollback (skip in shallow mode)
      if (!shallow && scrollback) {
        await commands.setTabScrollback(workspaceId, paneId, newTab.id, scrollback);
      }

      // 6. Copy history
      if (preferencesStore.cloneHistory) {
        try {
          await commands.copyTabHistory(tabId, newTab.id);
        } catch (e) {
          logError(`Failed to copy tab history: ${e}`);
        }
      }

      // 7. Copy notes (skip in shallow mode)
      if (!shallow && preferencesStore.cloneNotes && sourceTab.notes) {
        await commands.setTabNotes(workspaceId, paneId, newTab.id, sourceTab.notes);
      }
      if (!shallow && preferencesStore.cloneNotes && sourceTab.notes_mode) {
        await commands.setTabNotesMode(workspaceId, paneId, newTab.id, sourceTab.notes_mode);
      }

      // 7c. Copy trigger variables (always in shallow mode, pref-gated in full mode)
      if (shallow || preferencesStore.cloneVariables) {
        const srcVars = getVariables(tabId);
        if (srcVars && srcVars.size > 0) {
          const plain: Record<string, string> = {};
          for (const [k, v] of srcVars) plain[k] = v;
          await commands.setTabTriggerVariables(workspaceId, paneId, newTab.id, plain).catch(e =>
            logError(`Failed to copy trigger variables: ${e}`)
          );
        }
      }

      // 7d. Copy auto-resume settings (skip in shallow mode)
      if (!shallow && preferencesStore.cloneAutoResume && (sourceTab.auto_resume_cwd || sourceTab.auto_resume_ssh_command || sourceTab.auto_resume_command)) {
        await this.setTabAutoResumeContext(
          workspaceId, paneId, newTab.id,
          sourceTab.auto_resume_cwd,
          sourceTab.auto_resume_ssh_command,
          sourceTab.auto_resume_remote_cwd,
          sourceTab.auto_resume_command,
        );
      }

      // 8. Store split context for the new TerminalPane to consume on mount
      this._storeSplitContext(tabId, newTab.id, cwd, sshCommand, instance);

      // 9. Reorder to place new tab right after source
      const currentIds = pane!.tabs.map(t => t.id);
      const sourceIndex = currentIds.indexOf(tabId);
      // newTab.id was appended at end by createTab; move it after source
      const reordered = currentIds.filter(id => id !== newTab.id);
      reordered.splice(sourceIndex + 1, 0, newTab.id);
      await commands.reorderTabs(workspaceId, paneId, reordered);

      // 10. Switch to the new tab
      await commands.setActiveTab(workspaceId, paneId, newTab.id);

      // 11. Reload workspace state
      const data = await commands.getWindowData();
      const updatedWs = data.workspaces.find(w => w.id === workspaceId);
      if (updatedWs) {
        workspaces = workspaces.map(w => w.id === workspaceId ? updatedWs : w);
      }
    },

    async reloadTab(workspaceId: string, paneId: string, tabId: string) {
      const ws = workspaces.find(w => w.id === workspaceId);
      const pane = ws?.panes.find(p => p.id === paneId);
      const sourceTab = pane?.tabs.find(t => t.id === tabId);
      if (!ws || !pane || !sourceTab) return;

      // Remember exact name and position before duplication
      const tabName = sourceTab.name;
      const isCustom = sourceTab.custom_name;
      const sourceIndex = pane.tabs.findIndex(t => t.id === tabId);

      // Deep duplicate: clones scrollback, CWD, SSH, notes, history, auto-resume, variables
      await this.duplicateTab(workspaceId, paneId, tabId);

      // Reload state to get the new tab
      const freshData = await commands.getWindowData();
      const freshWs = freshData.workspaces.find(w => w.id === workspaceId);
      const freshPane = freshWs?.panes.find(p => p.id === paneId);
      if (!freshWs || !freshPane) return;

      // Find the new tab (duplicateTab places it right after source)
      const newTab = freshPane.tabs[sourceIndex + 1];
      if (!newTab) return;

      // Mark split context so auto-resume command fires on mount (reload = full restore)
      const splitCtx = terminalsStore.consumeSplitContext(newTab.id);
      if (splitCtx) {
        terminalsStore.setSplitContext(newTab.id, { ...splitCtx, fireAutoResume: true });
      }

      // Restore exact name (duplicateTab may have appended " (2)" for custom names)
      if (isCustom) {
        await commands.renameTab(workspaceId, paneId, newTab.id, tabName, true);
      }

      // Move new tab into the old tab's position and delete the old one
      const currentIds = freshPane.tabs.map(t => t.id);
      const reordered = currentIds.filter(id => id !== newTab.id);
      reordered.splice(sourceIndex, 0, newTab.id);
      reordered.splice(reordered.indexOf(tabId), 1);
      await commands.reorderTabs(workspaceId, paneId, reordered);

      await commands.setActiveTab(workspaceId, paneId, newTab.id);
      await commands.deleteTab(workspaceId, paneId, tabId);

      // Final state reload
      const data = await commands.getWindowData();
      const updatedWs = data.workspaces.find(w => w.id === workspaceId);
      if (updatedWs) {
        workspaces = workspaces.map(w => w.id === workspaceId ? updatedWs : w);
      }
    },

    async duplicateWindow() {
      // Gather context for ALL terminals in current window
      const tabContexts: commands.TabContext[] = [];

      for (const ws of workspaces) {
        for (const pane of ws.panes) {
          for (const tab of pane.tabs) {
            const ctx = await this._gatherTabContext(tab.id);

            // Also detect remote cwd
            let remoteCwd: string | null = null;
            if (ctx.sshCommand && ctx.instance) {
              const oscState = terminalsStore.getOsc(tab.id);
              const osc7Cwd = oscState?.cwd ?? null;
              const promptCwd = oscState?.promptCwd ?? null;
              const isOsc7Stale = osc7Cwd === ctx.cwd;
              const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
              remoteCwd = osc7RemoteCwd ?? promptCwd ?? extractRemoteCwd(ctx.instance.terminal);
            }

            tabContexts.push({
              tab_id: tab.id,
              scrollback: ctx.scrollback,
              cwd: ctx.cwd,
              ssh_command: ctx.sshCommand,
              remote_cwd: remoteCwd,
            });
          }
        }
      }

      await commands.duplicateWindow(tabContexts);
    },

    toggleNotes(tabId: string) {
      const updated = new Set(notesVisible);
      const isOpen = !updated.has(tabId);
      if (isOpen) {
        updated.add(tabId);
      } else {
        updated.delete(tabId);
      }
      notesVisible = updated;

      // Persist notes_open to backend
      for (const ws of workspaces) {
        for (const pane of ws.panes) {
          const tab = pane.tabs.find(t => t.id === tabId);
          if (tab) {
            tab.notes_open = isOpen;
            commands.setTabNotesOpen(ws.id, pane.id, tabId, isOpen);
            return;
          }
        }
      }
    },

    isNotesVisible(tabId: string) {
      return notesVisible.has(tabId);
    },


    async setTabNotes(workspaceId: string, paneId: string, tabId: string, notes: string | null) {
      await commands.setTabNotes(workspaceId, paneId, tabId, notes);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, notes } : t
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

    async addWorkspaceNote(workspaceId: string, content: string, mode: string | null): Promise<WorkspaceNote | null> {
      try {
        const note = await commands.addWorkspaceNote(workspaceId, content, mode);
        workspaces = workspaces.map(w => {
          if (w.id === workspaceId) {
            return { ...w, workspace_notes: [...w.workspace_notes, note] };
          }
          return w;
        });
        return note;
      } catch (e) {
        logError(`Failed to add workspace note: ${e}`);
        return null;
      }
    },

    async updateWorkspaceNote(workspaceId: string, noteId: string, content: string, mode: string | null) {
      await commands.updateWorkspaceNote(workspaceId, noteId, content, mode);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            workspace_notes: w.workspace_notes.map(n =>
              n.id === noteId ? { ...n, content, mode, updated_at: new Date().toISOString() } : n
            )
          };
        }
        return w;
      });
    },

    async deleteWorkspaceNote(workspaceId: string, noteId: string) {
      await commands.deleteWorkspaceNote(workspaceId, noteId);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return { ...w, workspace_notes: w.workspace_notes.filter(n => n.id !== noteId) };
        }
        return w;
      });
    },

    async setTabNotesMode(workspaceId: string, paneId: string, tabId: string, notesMode: string | null) {
      await commands.setTabNotesMode(workspaceId, paneId, tabId, notesMode);
      workspaces = workspaces.map(w => {
        if (w.id === workspaceId) {
          return {
            ...w,
            panes: w.panes.map(p => {
              if (p.id === paneId) {
                return {
                  ...p,
                  tabs: p.tabs.map(t =>
                    t.id === tabId ? { ...t, notes_mode: notesMode } : t
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
  };
}

export const workspacesStore = createWorkspacesStore();
