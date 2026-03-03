import type { ClaudeCodeToolRequest, DiffContext, Workspace, Pane, Tab } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';
import { workspacesStore, navigateToTab } from '$lib/stores/workspaces.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { getEditorByFilePath, getEditorByTabId } from '$lib/stores/editorRegistry.svelte';
import { interpolateVariables } from '$lib/stores/triggers.svelte';
import { preferencesStore } from '$lib/stores/preferences.svelte';
import { stripAnsi } from '$lib/utils/ansi';
import { error as logError, info as logInfo } from '@tauri-apps/plugin-log';

export interface PendingSelection {
  startLine?: number;
  endLine?: number;
  startText?: string;
  endText?: string;
}

export interface SelectionInfo {
  text: string;
  filePath: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
    isEmpty: boolean;
  };
}

function createClaudeCodeStore() {
  let connected = $state(false);
  let latestSelection = $state<SelectionInfo | null>(null);
  const pendingSelections = new Map<string, PendingSelection>();

  async function handleToolRequest(req: ClaudeCodeToolRequest): Promise<void> {
    const { request_id, tool, arguments: args } = req;
    logInfo(`Claude Code tool request: ${tool} (${request_id})`);
    try {
      let result: unknown;
      switch (tool) {
        case 'getOpenEditors':
          result = handleGetOpenEditors();
          break;
        case 'getWorkspaceFolders':
          result = handleGetWorkspaceFolders();
          break;
        case 'getDiagnostics':
          result = { diagnostics: [] };
          break;
        case 'checkDocumentDirty':
          result = handleCheckDocumentDirty(args as { filePath: string });
          break;
        case 'saveDocument':
          result = await handleSaveDocument(args as { filePath: string });
          break;
        case 'getCurrentSelection':
        case 'getLatestSelection':
          result = handleGetSelection();
          break;
        case 'openFile':
          result = await handleOpenFile(args as {
            filePath: string;
            startLine?: number;
            endLine?: number;
            startText?: string;
            endText?: string;
          });
          break;
        case 'openDiff':
          // openDiff is blocking -- do NOT respond here, DiffPane responds later
          await handleOpenDiff(request_id, args as {
            old_file_path?: string;
            new_file_path: string;
            new_file_contents: string;
            tab_name?: string;
          });
          return;
        case 'closeAllDiffTabs':
          await handleCloseAllDiffTabs(request_id);
          return;
        case 'listWorkspaces':
          result = handleListWorkspaces();
          break;
        case 'switchTab':
          result = await handleSwitchTab(args as { tabId: string });
          break;
        case 'getTabNotes':
          result = handleGetTabNotes(args as { tabId?: string });
          break;
        case 'setTabNotes':
          result = await handleSetTabNotes(args as { tabId?: string; notes: string | null; mode?: string });
          break;
        case 'listWorkspaceNotes':
          result = handleListWorkspaceNotes(args as { workspaceId?: string });
          break;
        case 'readWorkspaceNote':
          result = handleReadWorkspaceNote(args as { workspaceId?: string; noteId: string });
          break;
        case 'writeWorkspaceNote':
          result = await handleWriteWorkspaceNote(args as { workspaceId?: string; noteId?: string; content: string; mode?: string | null });
          break;
        case 'deleteWorkspaceNote':
          result = await handleDeleteWorkspaceNote(args as { workspaceId?: string; noteId: string });
          break;
        case 'moveNote':
          result = await handleMoveNote(args as { direction: string; tabId?: string; workspaceId?: string; noteId?: string; force?: boolean });
          break;
        case 'getTabContext':
          result = handleGetTabContext(args as { tabIds?: string[]; lines?: number });
          break;
        case 'openNotesPanel':
          result = handleOpenNotesPanel(args as { open?: boolean });
          break;
        case 'setNotesScope':
          result = await handleSetNotesScope(args as { scope: string });
          break;
        default:
          result = { error: `Unknown tool: ${tool}` };
      }
      await commands.claudeCodeRespond(request_id, result);
    } catch (err) {
      logError(`Claude Code tool error: ${err}`);
      await commands.claudeCodeRespond(request_id, { error: String(err) });
    }
  }

  function handleGetOpenEditors() {
    const tabs: unknown[] = [];
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          if (tab.tab_type === 'editor' && tab.editor_file) {
            const registryEntry = getEditorByFilePath(tab.editor_file.file_path);
            tabs.push({
              uri: `file://${tab.editor_file.file_path}`,
              isActive: tab.id === pane.active_tab_id && ws.id === workspacesStore.activeWorkspaceId,
              label: tab.name,
              languageId: tab.editor_file.language ?? 'plaintext',
              isDirty: registryEntry?.entry.isDirty ?? false,
            });
          }
        }
      }
    }
    return { tabs };
  }

  function handleGetWorkspaceFolders() {
    const folders: { name: string; uri: string; path: string }[] = [];
    const seenPaths = new Set<string>();

    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          if (tab.tab_type === 'terminal' && tab.pty_id) {
            const oscState = terminalsStore.getOsc(tab.id);
            const cwd = oscState?.cwd;
            if (cwd && !seenPaths.has(cwd)) {
              seenPaths.add(cwd);
              folders.push({
                name: cwd.split('/').pop() || cwd,
                uri: `file://${cwd}`,
                path: cwd,
              });
            }
          }
        }
      }
    }

    const rootPath = folders[0]?.path ?? null;
    return { folders, rootPath };
  }

  function handleCheckDocumentDirty(args: { filePath: string }) {
    const found = getEditorByFilePath(args.filePath);
    if (!found) {
      return { success: false, filePath: args.filePath, message: 'Document not open' };
    }
    return { success: true, filePath: args.filePath, isDirty: found.entry.isDirty };
  }

  async function handleSaveDocument(args: { filePath: string }) {
    const found = getEditorByFilePath(args.filePath);
    if (!found) {
      return { success: false, filePath: args.filePath, message: 'Document not open' };
    }
    document.dispatchEvent(new CustomEvent('editor-save', { detail: { tabId: found.tabId } }));
    return { success: true, filePath: args.filePath, saved: true };
  }

  function handleGetSelection() {
    if (latestSelection) return latestSelection;
    return {
      text: '',
      filePath: '',
      selection: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        isEmpty: true,
      },
    };
  }

  async function handleOpenFile(args: {
    filePath: string;
    startLine?: number;
    endLine?: number;
    startText?: string;
    endText?: string;
  }) {
    const { filePath, startLine, endLine, startText, endText } = args;

    // Check if file is already open
    let existingTabId: string | null = null;
    let existingWorkspaceId: string | null = null;
    let existingPaneId: string | null = null;

    outer: for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          if (tab.tab_type === 'editor' && tab.editor_file?.file_path === filePath) {
            existingTabId = tab.id;
            existingWorkspaceId = ws.id;
            existingPaneId = pane.id;
            break outer;
          }
        }
      }
    }

    if (existingTabId && existingWorkspaceId && existingPaneId) {
      await workspacesStore.setActiveTab(existingWorkspaceId, existingPaneId, existingTabId);
      if (startLine !== undefined || startText) {
        pendingSelections.set(existingTabId, { startLine, endLine, startText, endText });
      }
    } else {
      const ws = workspacesStore.activeWorkspace;
      const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
      if (!ws || !pane) {
        return { success: false, message: 'No active pane' };
      }

      const fileName = filePath.split('/').pop() ?? filePath;
      const { detectLanguageFromPath } = await import('$lib/utils/languageDetect');
      const language = detectLanguageFromPath(filePath);

      const tab = await workspacesStore.createEditorTab(ws.id, pane.id, fileName, {
        file_path: filePath,
        is_remote: false,
        remote_ssh_command: null,
        remote_path: null,
        language,
      });

      if (startLine !== undefined || startText) {
        pendingSelections.set(tab.id, { startLine, endLine, startText, endText });
      }
    }

    return { success: true, filePath };
  }

  async function handleOpenDiff(requestId: string, args: {
    old_file_path?: string;
    new_file_path: string;
    new_file_contents: string;
    tab_name?: string;
  }) {
    const filePath = args.old_file_path ?? args.new_file_path;
    const tabName = args.tab_name ?? `Diff: ${filePath.split('/').pop()}`;
    const newContent = args.new_file_contents;

    // Read old content
    let oldContent = '';
    try {
      const result = await commands.readFile(filePath);
      oldContent = result.content;
    } catch {
      // File doesn't exist yet -- empty old content
    }

    const ws = workspacesStore.activeWorkspace;
    const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
    if (!ws || !pane) {
      await commands.claudeCodeRespond(requestId, { error: 'No active pane' });
      return;
    }

    const diffContext: DiffContext = {
      request_id: requestId,
      file_path: filePath,
      old_content: oldContent,
      new_content: newContent,
      tab_name: tabName,
    };

    const afterTabId = pane.active_tab_id;
    await workspacesStore.createDiffTab(ws.id, pane.id, tabName, diffContext, afterTabId);
  }

  async function handleCloseAllDiffTabs(requestId: string) {
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        for (const tab of [...pane.tabs]) {
          if (tab.tab_type === 'diff' && tab.diff_context) {
            if (tab.diff_context.request_id !== requestId) {
              await commands.claudeCodeRespond(tab.diff_context.request_id, { result: 'DIFF_REJECTED' });
            }
            await workspacesStore.deleteTab(ws.id, pane.id, tab.id);
          }
        }
      }
    }
    await commands.claudeCodeRespond(requestId, { success: true });
  }

  // --- Helpers ---

  function findTabLocation(tabId: string): { workspace: Workspace; pane: Pane; tab: Tab } | null {
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        const tab = pane.tabs.find(t => t.id === tabId);
        if (tab) return { workspace: ws, pane, tab };
      }
    }
    return null;
  }

  function resolveWorkspace(workspaceId?: string): Workspace | null {
    if (workspaceId) return workspacesStore.workspaces.find(ws => ws.id === workspaceId) ?? null;
    return workspacesStore.activeWorkspace;
  }

  /** Compute the display name for any tab type (terminal, editor, diff). */
  function tabDisplayName(tab: Tab): string {
    if (tab.tab_type === 'terminal') {
      const oscTitle = terminalsStore.getOsc(tab.id)?.title;
      if (tab.custom_name) {
        let result = tab.name;
        if (oscTitle) {
          if (result.includes('%title')) result = result.replace('%title', oscTitle);
        }
        if (result.includes('%')) {
          result = interpolateVariables(tab.id, result, true);
        }
        return result;
      }
      return oscTitle ?? tab.name;
    }
    return tab.name;
  }

  // --- Navigation tools ---

  function handleListWorkspaces() {
    return {
      workspaces: workspacesStore.workspaces.map(ws => ({
        id: ws.id,
        name: ws.name,
        isActive: ws.id === workspacesStore.activeWorkspaceId,
        noteCount: ws.workspace_notes.length,
        panes: ws.panes.map(pane => ({
          id: pane.id,
          name: pane.name,
          isActive: pane.id === ws.active_pane_id,
          tabs: pane.tabs.map(tab => ({
            id: tab.id,
            displayName: tabDisplayName(tab),
            tabType: tab.tab_type ?? 'terminal',
            isActive: tab.id === pane.active_tab_id,
            hasNotes: !!tab.notes,
          })),
        })),
      })),
    };
  }

  async function handleSwitchTab(args: { tabId: string }) {
    const loc = findTabLocation(args.tabId);
    if (!loc) return { error: `Tab not found: ${args.tabId}` };
    await navigateToTab(args.tabId);
    return { success: true, tabId: args.tabId, workspace: loc.workspace.name, displayName: tabDisplayName(loc.tab) };
  }

  // --- Tab notes tools ---

  function handleGetTabNotes(args: { tabId?: string }) {
    let tab: Tab | undefined;
    let wsId: string | undefined;
    let paneId: string | undefined;

    if (args.tabId) {
      const loc = findTabLocation(args.tabId);
      if (!loc) return { error: `Tab not found: ${args.tabId}` };
      tab = loc.tab;
      wsId = loc.workspace.id;
      paneId = loc.pane.id;
    } else {
      const ws = workspacesStore.activeWorkspace;
      const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
      tab = pane?.tabs.find(t => t.id === pane.active_tab_id);
      if (!ws || !pane || !tab) return { error: 'No active tab' };
      wsId = ws.id;
      paneId = pane.id;
    }

    return {
      tabId: tab.id,
      displayName: tabDisplayName(tab),
      notes: tab.notes ?? null,
      notesMode: tab.notes_mode ?? null,
    };
  }

  async function handleSetTabNotes(args: { tabId?: string; notes: string | null; mode?: string }) {
    let tab: Tab | undefined;
    let wsId: string;
    let paneId: string;

    if (args.tabId) {
      const loc = findTabLocation(args.tabId);
      if (!loc) return { error: `Tab not found: ${args.tabId}` };
      tab = loc.tab;
      wsId = loc.workspace.id;
      paneId = loc.pane.id;
    } else {
      const ws = workspacesStore.activeWorkspace;
      const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
      tab = pane?.tabs.find(t => t.id === pane.active_tab_id);
      if (!ws || !pane || !tab) return { error: 'No active tab' };
      wsId = ws.id;
      paneId = pane.id;
    }

    const notes = args.notes === '' ? null : args.notes;
    await workspacesStore.setTabNotes(wsId, paneId, tab.id, notes);
    if (args.mode) {
      await workspacesStore.setTabNotesMode(wsId, paneId, tab.id, args.mode);
    }
    return { success: true, tabId: tab.id };
  }

  // --- Workspace notes tools ---

  function handleListWorkspaceNotes(args: { workspaceId?: string }) {
    const ws = resolveWorkspace(args.workspaceId);
    if (!ws) return { error: `Workspace not found${args.workspaceId ? `: ${args.workspaceId}` : ''}` };

    return {
      workspaceId: ws.id,
      workspaceName: ws.name,
      notes: ws.workspace_notes.map(note => ({
        id: note.id,
        preview: note.content.length > 100 ? note.content.slice(0, 100) + '...' : note.content,
        mode: note.mode ?? null,
        created_at: note.created_at,
        updated_at: note.updated_at,
      })),
    };
  }

  function handleReadWorkspaceNote(args: { workspaceId?: string; noteId: string }) {
    const ws = resolveWorkspace(args.workspaceId);
    if (!ws) return { error: `Workspace not found${args.workspaceId ? `: ${args.workspaceId}` : ''}` };

    const note = ws.workspace_notes.find(n => n.id === args.noteId);
    if (!note) return { error: `Note not found: ${args.noteId}` };

    return {
      id: note.id,
      content: note.content,
      mode: note.mode ?? null,
      created_at: note.created_at,
      updated_at: note.updated_at,
    };
  }

  async function handleWriteWorkspaceNote(args: { workspaceId?: string; noteId?: string; content: string; mode?: string | null }) {
    const ws = resolveWorkspace(args.workspaceId);
    if (!ws) return { error: `Workspace not found${args.workspaceId ? `: ${args.workspaceId}` : ''}` };

    if (args.noteId) {
      // Update existing
      const note = ws.workspace_notes.find(n => n.id === args.noteId);
      if (!note) return { error: `Note not found: ${args.noteId}` };
      await workspacesStore.updateWorkspaceNote(ws.id, args.noteId, args.content, args.mode ?? note.mode ?? null);
      return { success: true, noteId: args.noteId, action: 'updated' };
    } else {
      // Create new
      const note = await workspacesStore.addWorkspaceNote(ws.id, args.content, args.mode ?? null);
      if (!note) return { error: 'Failed to create note' };
      return { success: true, noteId: note.id, action: 'created' };
    }
  }

  async function handleDeleteWorkspaceNote(args: { workspaceId?: string; noteId: string }) {
    const ws = resolveWorkspace(args.workspaceId);
    if (!ws) return { error: `Workspace not found${args.workspaceId ? `: ${args.workspaceId}` : ''}` };

    const note = ws.workspace_notes.find(n => n.id === args.noteId);
    if (!note) return { error: `Note not found: ${args.noteId}` };

    await workspacesStore.deleteWorkspaceNote(ws.id, args.noteId);
    return { success: true, noteId: args.noteId };
  }

  // --- Move note tool ---

  async function handleMoveNote(args: { direction: string; tabId?: string; workspaceId?: string; noteId?: string; force?: boolean }) {
    const force = args.force ?? false;

    if (args.direction === 'tab_to_workspace') {
      // Resolve tab
      let tab: Tab;
      let wsId: string;
      let paneId: string;
      if (args.tabId) {
        const loc = findTabLocation(args.tabId);
        if (!loc) return { error: `Tab not found: ${args.tabId}` };
        tab = loc.tab;
        wsId = args.workspaceId ?? loc.workspace.id;
        paneId = loc.pane.id;
      } else {
        const ws = workspacesStore.activeWorkspace;
        const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
        tab = pane?.tabs.find(t => t.id === pane.active_tab_id) as Tab;
        if (!ws || !pane || !tab) return { error: 'No active tab' };
        wsId = args.workspaceId ?? ws.id;
        paneId = pane.id;
      }

      if (!tab.notes?.trim()) return { error: 'Tab has no notes to move' };

      // Create workspace note from tab content
      const note = await workspacesStore.addWorkspaceNote(wsId, tab.notes, tab.notes_mode ?? null);
      if (!note) return { error: 'Failed to create workspace note' };

      // Clear tab notes
      await workspacesStore.setTabNotes(wsId, paneId, tab.id, null);

      // Switch notes panel to workspace list view
      await preferencesStore.setNotesScope('workspace');

      return { success: true, direction: 'tab_to_workspace', noteId: note.id, tabId: tab.id };

    } else if (args.direction === 'workspace_to_tab') {
      if (!args.noteId) return { error: 'noteId is required for workspace_to_tab' };

      // Resolve workspace + note
      const ws = resolveWorkspace(args.workspaceId);
      if (!ws) return { error: `Workspace not found${args.workspaceId ? `: ${args.workspaceId}` : ''}` };
      const note = ws.workspace_notes.find(n => n.id === args.noteId);
      if (!note) return { error: `Note not found: ${args.noteId}` };

      // Resolve tab
      let tab: Tab;
      let paneId: string;
      const tabWsId = ws.id;
      if (args.tabId) {
        const loc = findTabLocation(args.tabId);
        if (!loc) return { error: `Tab not found: ${args.tabId}` };
        tab = loc.tab;
        paneId = loc.pane.id;
      } else {
        const pane = ws.panes.find(p => p.id === ws.active_pane_id);
        tab = pane?.tabs.find(t => t.id === pane.active_tab_id) as Tab;
        if (!pane || !tab) return { error: 'No active tab' };
        paneId = pane.id;
      }

      // Check for conflict
      if (tab.notes?.trim() && !force) {
        return {
          error: 'Tab already has notes. Set force: true to overwrite, or read both notes first to merge manually.',
          existingTabNotes: tab.notes.length > 100 ? tab.notes.slice(0, 100) + '...' : tab.notes,
        };
      }

      // Move: set tab notes from workspace note content, then delete workspace note
      await workspacesStore.setTabNotes(tabWsId, paneId, tab.id, note.content);
      if (note.mode) {
        await workspacesStore.setTabNotesMode(tabWsId, paneId, tab.id, note.mode);
      }
      await workspacesStore.deleteWorkspaceNote(ws.id, args.noteId);

      // Switch notes panel to tab view
      await preferencesStore.setNotesScope('tab');

      return { success: true, direction: 'workspace_to_tab', noteId: args.noteId, tabId: tab.id };

    } else {
      return { error: `Invalid direction: ${args.direction}. Must be 'tab_to_workspace' or 'workspace_to_tab'.` };
    }
  }

  // --- Tab context tool ---

  function getTerminalText(tabId: string, lineCount: number): string | null {
    const instance = terminalsStore.get(tabId);
    if (instance?.terminal) {
      // Live terminal — extract from xterm.js buffer
      const buffer = instance.terminal.buffer.active;
      const totalLines = buffer.baseY + buffer.cursorY + 1;
      const startLine = Math.max(0, totalLines - lineCount);
      const lines: string[] = [];
      for (let i = startLine; i < totalLines; i++) {
        const line = buffer.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      return lines.join('\n').trimEnd() || null;
    }

    // Unmounted terminal — use persisted scrollback
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        const tab = pane.tabs.find(t => t.id === tabId);
        if (tab?.scrollback) {
          const plain = stripAnsi(tab.scrollback);
          const allLines = plain.split('\n');
          return allLines.slice(-lineCount).join('\n').trimEnd() || null;
        }
      }
    }
    return null;
  }

  function getEditorText(tabId: string, lineCount: number): string | null {
    const entry = getEditorByTabId(tabId);
    if (entry?.view) {
      const doc = entry.view.state.doc;
      const totalLines = doc.lines;
      const startLine = Math.max(1, totalLines - lineCount + 1);
      const from = doc.line(startLine).from;
      return doc.sliceString(from).trimEnd() || null;
    }
    return null;
  }

  function handleGetTabContext(args: { tabIds?: string[]; lines?: number }) {
    const lineCount = args.lines ?? 50;

    // Collect all tabs across workspaces
    const allTabs: { tab: Tab; workspace: Workspace; pane: Pane }[] = [];
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          allTabs.push({ tab, workspace: ws, pane });
        }
      }
    }

    // Decide which tabs to include
    let targetTabs: typeof allTabs;
    if (args.tabIds && args.tabIds.length > 0) {
      const idSet = new Set(args.tabIds);
      targetTabs = allTabs.filter(t => idSet.has(t.tab.id));
    } else if (allTabs.length < 10) {
      targetTabs = allTabs;
    } else {
      return {
        error: `Too many tabs (${allTabs.length}) to return all context. Use listWorkspaces to find candidates, then pass specific tabIds.`,
        totalTabs: allTabs.length,
      };
    }

    const results = targetTabs.map(({ tab, workspace, pane }) => {
      const tabType = tab.tab_type ?? 'terminal';
      let content: string | null = null;

      if (tabType === 'terminal') {
        content = getTerminalText(tab.id, lineCount);
      } else if (tabType === 'editor') {
        content = getEditorText(tab.id, lineCount);
      }
      // diff tabs: no context extraction needed

      return {
        tabId: tab.id,
        displayName: tabDisplayName(tab),
        tabType,
        workspace: workspace.name,
        workspaceId: workspace.id,
        pane: pane.name,
        isActive: tab.id === pane.active_tab_id && workspace.id === workspacesStore.activeWorkspaceId,
        hasNotes: !!tab.notes,
        ...(tab.editor_file ? { filePath: tab.editor_file.file_path } : {}),
        content,
      };
    });

    return { tabs: results, lineCount };
  }

  // --- Notes panel tools ---

  function handleOpenNotesPanel(args: { open?: boolean }) {
    const ws = workspacesStore.activeWorkspace;
    const pane = ws?.panes.find(p => p.id === ws.active_pane_id);
    const tab = pane?.tabs.find(t => t.id === pane.active_tab_id);
    if (!tab) return { error: 'No active tab' };

    const isVisible = workspacesStore.isNotesVisible(tab.id);
    const shouldOpen = args.open ?? !isVisible;

    if (shouldOpen !== isVisible) {
      workspacesStore.toggleNotes(tab.id);
    }

    return { success: true, tabId: tab.id, open: shouldOpen, scope: preferencesStore.notesScope };
  }

  async function handleSetNotesScope(args: { scope: string }) {
    if (args.scope !== 'tab' && args.scope !== 'workspace') {
      return { error: `Invalid scope: ${args.scope}. Must be 'tab' or 'workspace'.` };
    }
    await preferencesStore.setNotesScope(args.scope);
    return { success: true, scope: args.scope };
  }

  function updateSelection(info: SelectionInfo) {
    latestSelection = info;
    commands.claudeCodeNotifySelection({
      jsonrpc: '2.0',
      method: 'notifications/selection_changed',
      params: info,
    }).catch(() => {});
  }

  function setConnected(value: boolean) {
    connected = value;
    logInfo(`Claude Code IDE ${value ? 'connected' : 'disconnected'}`);
  }

  function getPendingSelection(tabId: string): PendingSelection | undefined {
    return pendingSelections.get(tabId);
  }

  function clearPendingSelection(tabId: string): void {
    pendingSelections.delete(tabId);
  }

  return {
    get connected() { return connected; },
    get latestSelection() { return latestSelection; },
    handleToolRequest,
    updateSelection,
    setConnected,
    getPendingSelection,
    clearPendingSelection,
  };
}

export const claudeCodeStore = createClaudeCodeStore();
