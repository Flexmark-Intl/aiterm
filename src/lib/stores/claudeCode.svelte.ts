import type { ClaudeCodeToolRequest, DiffContext, Workspace, Pane, Tab } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';
import { workspacesStore, navigateToTab } from '$lib/stores/workspaces.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { getEditorByFilePath, getEditorByTabId } from '$lib/stores/editorRegistry.svelte';
import { interpolateVariables, getVariables, setVariable, handleEnableAutoResume } from '$lib/stores/triggers.svelte';
import { CLAUDE_RESUME_COMMAND } from '$lib/triggers/defaults';
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
        case 'getActiveTab':
          result = handleGetActiveTab();
          break;
        case 'setTriggerVariable':
          result = await handleSetTriggerVariable(args as { tabId?: string; name: string; value: string | null });
          break;
        case 'getTriggerVariables':
          result = handleGetTriggerVariables(args as { tabId?: string });
          break;
        case 'setAutoResume':
          result = await handleSetAutoResume(args as { tabId?: string; enabled: boolean; command?: string; cwd?: string; sshCommand?: string; remoteCwd?: string });
          break;
        case 'getAutoResume':
          result = handleGetAutoResume(args as { tabId?: string });
          break;
        case 'findNotes':
          result = handleFindNotes();
          break;
        case 'getPreferences':
          result = handleGetPreferences(args as { query?: string });
          break;
        case 'setPreference':
          result = await handleSetPreference(args as { key: string; value: unknown });
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

  function handleGetActiveTab() {
    const ws = workspacesStore.workspaces.find(w => w.id === workspacesStore.activeWorkspaceId);
    if (!ws) return { error: 'No active workspace' };
    const pane = ws.panes.find(p => p.id === ws.active_pane_id);
    if (!pane) return { error: 'No active pane' };
    const tab = pane.tabs.find(t => t.id === pane.active_tab_id);
    if (!tab) return { error: 'No active tab' };
    return {
      workspace: { id: ws.id, name: ws.name },
      pane: { id: pane.id },
      tab: {
        id: tab.id,
        displayName: tabDisplayName(tab),
        tabType: tab.tab_type ?? 'terminal',
        hasNotes: !!tab.notes,
        notesOpen: !!tab.notes_open,
      },
    };
  }

  // --- Trigger variable tools ---

  async function handleSetTriggerVariable(args: { tabId?: string; name: string; value: string | null }) {
    const tab = resolveActiveTab(args.tabId);
    if ('error' in tab) return tab;
    await setVariable(tab.tab.id, args.name, args.value);
    return { success: true, tabId: tab.tab.id, name: args.name, value: args.value };
  }

  function handleGetTriggerVariables(args: { tabId?: string }) {
    const tab = resolveActiveTab(args.tabId);
    if ('error' in tab) return tab;
    const vars = getVariables(tab.tab.id);
    const result: Record<string, string> = {};
    if (vars) {
      for (const [k, v] of vars) result[k] = v;
    }
    return { tabId: tab.tab.id, variables: result };
  }

  // --- Auto-resume tools ---

  async function handleSetAutoResume(args: { tabId?: string; enabled: boolean; command?: string; cwd?: string; sshCommand?: string; remoteCwd?: string }) {
    const resolved = resolveActiveTab(args.tabId);
    if ('error' in resolved) return resolved;
    const { workspace, pane, tab } = resolved;

    if (!args.enabled) {
      await workspacesStore.disableAutoResume(workspace.id, pane.id, tab.id);
      return { success: true, tabId: tab.id, enabled: false };
    }

    // If all context fields are provided, set directly
    if (args.cwd !== undefined || args.sshCommand !== undefined || args.remoteCwd !== undefined) {
      const cmd = args.command ?? CLAUDE_RESUME_COMMAND;
      await workspacesStore.setTabAutoResumeContext(
        workspace.id, pane.id, tab.id,
        args.cwd ?? null, args.sshCommand ?? null, args.remoteCwd ?? null, cmd,
      );
      return { success: true, tabId: tab.id, enabled: true, command: cmd };
    }

    // Auto-detect PTY context (same as trigger-based enable)
    const cmd = args.command ?? CLAUDE_RESUME_COMMAND;
    await handleEnableAutoResume(tab.id, cmd);
    return { success: true, tabId: tab.id, enabled: true, command: cmd };
  }

  function handleGetAutoResume(args: { tabId?: string }) {
    const resolved = resolveActiveTab(args.tabId);
    if ('error' in resolved) return resolved;
    const { tab } = resolved;
    const hasConfig = !!(tab.auto_resume_command || tab.auto_resume_cwd || tab.auto_resume_ssh_command);
    return {
      tabId: tab.id,
      enabled: tab.auto_resume_enabled && hasConfig,
      configured: hasConfig,
      pinned: tab.auto_resume_pinned,
      command: tab.auto_resume_command ?? null,
      cwd: tab.auto_resume_cwd ?? null,
      sshCommand: tab.auto_resume_ssh_command ?? null,
      remoteCwd: tab.auto_resume_remote_cwd ?? null,
    };
  }

  function handleFindNotes() {
    const tabNotes: { tabId: string; displayName: string; workspace: string; notes: string; notesMode: string }[] = [];
    const workspaceNotes: { workspaceId: string; workspace: string; noteId: string; preview: string; mode: string | null }[] = [];

    for (const ws of workspacesStore.workspaces) {
      // Collect workspace-level notes
      for (const note of ws.workspace_notes) {
        workspaceNotes.push({
          workspaceId: ws.id,
          workspace: ws.name,
          noteId: note.id,
          preview: note.content.slice(0, 200),
          mode: note.mode ?? null,
        });
      }
      // Collect tab-level notes
      for (const pane of ws.panes) {
        for (const tab of pane.tabs) {
          if (tab.notes) {
            tabNotes.push({
              tabId: tab.id,
              displayName: tabDisplayName(tab),
              workspace: ws.name,
              notes: tab.notes.slice(0, 200),
              notesMode: tab.notes_mode ?? 'source',
            });
          }
        }
      }
    }

    return { tabNotes, workspaceNotes };
  }

  // --- Preferences tools ---

  interface PrefMeta {
    description: string;
    type: string;
    category: string;
    default: unknown;
    options?: string[];
    range?: [number, number];
    readOnly?: boolean;
  }

  const PREFERENCE_META: Record<string, PrefMeta> = {
    font_size: { description: 'Terminal font size in pixels', type: 'number', category: 'Terminal', default: 13, range: [10, 24] },
    font_family: { description: 'Terminal font family', type: 'string', category: 'Terminal', default: 'Menlo' },
    cursor_style: { description: 'Terminal cursor shape', type: 'string', category: 'Terminal', default: 'block', options: ['block', 'underline', 'bar'] },
    cursor_blink: { description: 'Whether the cursor blinks', type: 'boolean', category: 'Terminal', default: true },
    scrollback_limit: { description: 'Maximum scrollback lines per terminal', type: 'number', category: 'Terminal', default: 10000, range: [1000, 100000] },
    shell_title_integration: { description: 'Allow shell to set tab titles via OSC escape sequences', type: 'boolean', category: 'Terminal', default: false },
    shell_integration: { description: 'Enable OSC 133 shell integration for command detection', type: 'boolean', category: 'Terminal', default: false },
    file_link_action: { description: 'How file links in the terminal are activated', type: 'string', category: 'Terminal', default: 'modifier_click', options: ['modifier_click', 'single_click'] },
    windows_shell: { description: 'Default shell on Windows', type: 'string', category: 'Terminal', default: 'powershell', options: ['powershell', 'cmd'] },
    theme: { description: 'Color theme ID (built-in or custom)', type: 'string', category: 'Appearance', default: 'tokyo-night', options: ['tokyo-night', 'dracula', 'solarized-dark', 'solarized-light', 'nord', 'gruvbox-dark', 'monokai', 'catppuccin-mocha', 'one-dark', 'macos-pro'] },
    auto_save_interval: { description: 'Auto-save interval in seconds (0 to disable)', type: 'number', category: 'General', default: 10, range: [0, 300] },
    restore_session: { description: 'Restore tabs and workspaces on app restart', type: 'boolean', category: 'General', default: false },
    number_duplicated_tabs: { description: 'Prefix duplicated tab names with numbers (e.g. "2 My Tab")', type: 'boolean', category: 'Tabs', default: true },
    tab_button_style: { description: 'Tab close button visibility', type: 'string', category: 'Tabs', default: 'hover', options: ['hover', 'always'] },
    clone_cwd: { description: 'Copy working directory when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_scrollback: { description: 'Copy scrollback buffer when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_ssh: { description: 'Copy SSH session when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_history: { description: 'Copy shell history when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_notes: { description: 'Copy notes when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_auto_resume: { description: 'Copy auto-resume config when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    clone_variables: { description: 'Copy trigger variables when duplicating tabs', type: 'boolean', category: 'Tabs', default: true },
    notification_mode: { description: 'Notification delivery mode', type: 'string', category: 'Notifications', default: 'auto', options: ['auto', 'in_app', 'native', 'disabled'] },
    notify_min_duration: { description: 'Minimum command duration (seconds) before notifying on completion', type: 'number', category: 'Notifications', default: 30, range: [0, 300] },
    notification_sound: { description: 'Notification sound', type: 'string', category: 'Notifications', default: 'default', options: ['default', 'system', 'none'] },
    notification_volume: { description: 'Notification volume percentage', type: 'number', category: 'Notifications', default: 50, range: [0, 100] },
    toast_font_size: { description: 'Toast notification font size', type: 'number', category: 'Notifications', default: 14, range: [10, 24] },
    toast_width: { description: 'Toast notification width in pixels', type: 'number', category: 'Notifications', default: 400, range: [280, 600] },
    toast_duration: { description: 'Toast auto-dismiss duration in seconds', type: 'number', category: 'Notifications', default: 8, range: [3, 30] },
    notes_font_size: { description: 'Notes panel font size', type: 'number', category: 'Notes', default: 16, range: [10, 24] },
    notes_font_family: { description: 'Notes panel font family', type: 'string', category: 'Notes', default: 'Menlo' },
    notes_width: { description: 'Notes panel width in pixels', type: 'number', category: 'Notes', default: 320, range: [200, 600] },
    notes_word_wrap: { description: 'Wrap long lines in notes panel', type: 'boolean', category: 'Notes', default: true },
    notes_scope: { description: 'Default notes panel view', type: 'string', category: 'Notes', default: 'tab', options: ['tab', 'workspace'] },
    show_recent_workspaces: { description: 'Show recently used workspaces section in sidebar', type: 'boolean', category: 'Workspace', default: true },
    workspace_sort_order: { description: 'Workspace list sort order', type: 'string', category: 'Workspace', default: 'default', options: ['default', 'alphabetical', 'recent'] },
    show_workspace_tab_count: { description: 'Show tab count badges on workspace items', type: 'boolean', category: 'Workspace', default: false },
    claude_code_ide: { description: 'Enable Claude Code IDE integration (MCP server)', type: 'boolean', category: 'Integration', default: false },
    prompt_patterns: { description: 'Regex patterns for remote prompt/CWD detection', type: 'string[]', category: 'Terminal', default: [], readOnly: true },
    custom_themes: { description: 'User-created custom color themes', type: 'object[]', category: 'Appearance', default: [], readOnly: true },
    triggers: { description: 'Trigger rules for terminal pattern matching', type: 'object[]', category: 'Triggers', default: [], readOnly: true },
    hidden_default_triggers: { description: 'IDs of deleted default trigger templates', type: 'string[]', category: 'Triggers', default: [], readOnly: true },
  };

  // Maps snake_case keys to preferencesStore setters
  const PREFERENCE_SETTERS: Record<string, (v: any) => Promise<void>> = {
    font_size: (v) => preferencesStore.setFontSize(v),
    font_family: (v) => preferencesStore.setFontFamily(v),
    cursor_style: (v) => preferencesStore.setCursorStyle(v),
    cursor_blink: (v) => preferencesStore.setCursorBlink(v),
    scrollback_limit: (v) => preferencesStore.setScrollbackLimit(v),
    shell_title_integration: (v) => preferencesStore.setShellTitleIntegration(v),
    shell_integration: (v) => preferencesStore.setShellIntegration(v),
    file_link_action: (v) => preferencesStore.setFileLinkAction(v),
    windows_shell: (v) => preferencesStore.setWindowsShell(v),
    theme: (v) => preferencesStore.setTheme(v),
    auto_save_interval: (v) => preferencesStore.setAutoSaveInterval(v),
    restore_session: (v) => preferencesStore.setRestoreSession(v),
    number_duplicated_tabs: (v) => preferencesStore.setNumberDuplicatedTabs(v),
    tab_button_style: (v) => preferencesStore.setTabButtonStyle(v),
    clone_cwd: (v) => preferencesStore.setCloneCwd(v),
    clone_scrollback: (v) => preferencesStore.setCloneScrollback(v),
    clone_ssh: (v) => preferencesStore.setCloneSsh(v),
    clone_history: (v) => preferencesStore.setCloneHistory(v),
    clone_notes: (v) => preferencesStore.setCloneNotes(v),
    clone_auto_resume: (v) => preferencesStore.setCloneAutoResume(v),
    clone_variables: (v) => preferencesStore.setCloneVariables(v),
    notification_mode: (v) => preferencesStore.setNotificationMode(v),
    notify_min_duration: (v) => preferencesStore.setNotifyMinDuration(v),
    notification_sound: (v) => preferencesStore.setNotificationSound(v),
    notification_volume: (v) => preferencesStore.setNotificationVolume(v),
    toast_font_size: (v) => preferencesStore.setToastFontSize(v),
    toast_width: (v) => preferencesStore.setToastWidth(v),
    toast_duration: (v) => preferencesStore.setToastDuration(v),
    notes_font_size: (v) => preferencesStore.setNotesFontSize(v),
    notes_font_family: (v) => preferencesStore.setNotesFontFamily(v),
    notes_width: (v) => preferencesStore.setNotesWidth(v),
    notes_word_wrap: (v) => preferencesStore.setNotesWordWrap(v),
    notes_scope: (v) => preferencesStore.setNotesScope(v),
    show_recent_workspaces: (v) => preferencesStore.setShowRecentWorkspaces(v),
    workspace_sort_order: (v) => preferencesStore.setWorkspaceSortOrder(v),
    show_workspace_tab_count: (v) => preferencesStore.setShowWorkspaceTabCount(v),
    claude_code_ide: (v) => preferencesStore.setClaudeCodeIde(v),
  };

  // Maps snake_case keys to preferencesStore getters
  const PREFERENCE_GETTERS: Record<string, () => unknown> = {
    font_size: () => preferencesStore.fontSize,
    font_family: () => preferencesStore.fontFamily,
    cursor_style: () => preferencesStore.cursorStyle,
    cursor_blink: () => preferencesStore.cursorBlink,
    scrollback_limit: () => preferencesStore.scrollbackLimit,
    shell_title_integration: () => preferencesStore.shellTitleIntegration,
    shell_integration: () => preferencesStore.shellIntegration,
    file_link_action: () => preferencesStore.fileLinkAction,
    windows_shell: () => preferencesStore.windowsShell,
    theme: () => preferencesStore.theme,
    auto_save_interval: () => preferencesStore.autoSaveInterval,
    restore_session: () => preferencesStore.restoreSession,
    number_duplicated_tabs: () => preferencesStore.numberDuplicatedTabs,
    tab_button_style: () => preferencesStore.tabButtonStyle,
    clone_cwd: () => preferencesStore.cloneCwd,
    clone_scrollback: () => preferencesStore.cloneScrollback,
    clone_ssh: () => preferencesStore.cloneSsh,
    clone_history: () => preferencesStore.cloneHistory,
    clone_notes: () => preferencesStore.cloneNotes,
    clone_auto_resume: () => preferencesStore.cloneAutoResume,
    clone_variables: () => preferencesStore.cloneVariables,
    notification_mode: () => preferencesStore.notificationMode,
    notify_min_duration: () => preferencesStore.notifyMinDuration,
    notification_sound: () => preferencesStore.notificationSound,
    notification_volume: () => preferencesStore.notificationVolume,
    toast_font_size: () => preferencesStore.toastFontSize,
    toast_width: () => preferencesStore.toastWidth,
    toast_duration: () => preferencesStore.toastDuration,
    notes_font_size: () => preferencesStore.notesFontSize,
    notes_font_family: () => preferencesStore.notesFontFamily,
    notes_width: () => preferencesStore.notesWidth,
    notes_word_wrap: () => preferencesStore.notesWordWrap,
    notes_scope: () => preferencesStore.notesScope,
    show_recent_workspaces: () => preferencesStore.showRecentWorkspaces,
    workspace_sort_order: () => preferencesStore.workspaceSortOrder,
    show_workspace_tab_count: () => preferencesStore.showWorkspaceTabCount,
    claude_code_ide: () => preferencesStore.claudeCodeIde,
    prompt_patterns: () => preferencesStore.promptPatterns,
    custom_themes: () => preferencesStore.customThemes,
    triggers: () => preferencesStore.triggers,
    hidden_default_triggers: () => preferencesStore.hiddenDefaultTriggers,
  };

  function handleGetPreferences(args: { query?: string }) {
    const entries = Object.entries(PREFERENCE_META).map(([key, meta]) => {
      const getter = PREFERENCE_GETTERS[key];
      const entry: Record<string, unknown> = {
        key,
        value: getter ? getter() : undefined,
        description: meta.description,
        type: meta.type,
        category: meta.category,
        default: meta.default,
      };
      if (meta.options) entry.options = meta.options;
      if (meta.range) entry.range = meta.range;
      if (meta.readOnly) entry.readOnly = true;
      return entry;
    });

    if (args.query) {
      const q = args.query.toLowerCase();
      const filtered = entries.filter(e =>
        (e.key as string).includes(q) ||
        (e.description as string).toLowerCase().includes(q) ||
        (e.category as string).toLowerCase().includes(q)
      );
      return { preferences: filtered, query: args.query, total: entries.length, matched: filtered.length };
    }

    return { preferences: entries, total: entries.length };
  }

  async function handleSetPreference(args: { key: string; value: unknown }) {
    const meta = PREFERENCE_META[args.key];
    if (!meta) {
      return { error: `Unknown preference key: '${args.key}'. Use getPreferences to discover available keys.` };
    }
    if (meta.readOnly) {
      return { error: `Preference '${args.key}' is read-only and cannot be set via this tool.` };
    }

    const setter = PREFERENCE_SETTERS[args.key];
    if (!setter) {
      return { error: `No setter available for '${args.key}'.` };
    }

    // Type validation
    const expectedType = meta.type;
    const actualType = typeof args.value;
    if (expectedType === 'number' && actualType !== 'number') {
      return { error: `Expected number for '${args.key}', got ${actualType}.` };
    }
    if (expectedType === 'string' && actualType !== 'string') {
      return { error: `Expected string for '${args.key}', got ${actualType}.` };
    }
    if (expectedType === 'boolean' && actualType !== 'boolean') {
      return { error: `Expected boolean for '${args.key}', got ${actualType}.` };
    }

    // Options validation
    if (meta.options && !meta.options.includes(args.value as string)) {
      // For theme, also accept custom theme IDs
      if (args.key === 'theme') {
        const customIds = preferencesStore.customThemes.map((t: any) => t.id);
        if (!customIds.includes(args.value as string)) {
          return { error: `Invalid value for '${args.key}'. Valid options: ${[...meta.options, ...customIds].join(', ')}` };
        }
      } else {
        return { error: `Invalid value for '${args.key}'. Valid options: ${meta.options.join(', ')}` };
      }
    }

    // Range validation
    if (meta.range) {
      const num = args.value as number;
      if (num < meta.range[0] || num > meta.range[1]) {
        return { error: `Value for '${args.key}' must be between ${meta.range[0]} and ${meta.range[1]}.` };
      }
    }

    await setter(args.value);
    return { success: true, key: args.key, value: args.value };
  }

  /** Resolve a tab by ID or fall back to the active tab. Returns { workspace, pane, tab } or { error }. */
  function resolveActiveTab(tabId?: string): { workspace: Workspace; pane: Pane; tab: Tab } | { error: string } {
    if (tabId) {
      const loc = findTabLocation(tabId);
      if (!loc) return { error: `Tab not found: ${tabId}` };
      return loc;
    }
    const ws = workspacesStore.workspaces.find(w => w.id === workspacesStore.activeWorkspaceId);
    if (!ws) return { error: 'No active workspace' };
    const pane = ws.panes.find(p => p.id === ws.active_pane_id);
    if (!pane) return { error: 'No active pane' };
    const tab = pane.tabs.find(t => t.id === pane.active_tab_id);
    if (!tab) return { error: 'No active tab' };
    return { workspace: ws, pane, tab };
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
