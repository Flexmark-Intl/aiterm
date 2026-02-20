import type { ClaudeCodeToolRequest, DiffContext } from '$lib/tauri/types';
import * as commands from '$lib/tauri/commands';
import { workspacesStore } from '$lib/stores/workspaces.svelte';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { getEditorByFilePath } from '$lib/stores/editorRegistry';
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
