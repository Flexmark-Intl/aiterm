import type { EditorFileInfo } from '$lib/tauri/types';
import { detectLanguageFromPath } from './languageDetect';
import { terminalsStore } from '$lib/stores/terminals.svelte';
import { workspacesStore } from '$lib/stores/workspaces.svelte';
import { getPtyInfo } from '$lib/tauri/commands';
import { error as logError } from '@tauri-apps/plugin-log';

/**
 * Open a file from a terminal context.
 * Creates the editor tab immediately — EditorPane handles loading and errors.
 */
export async function openFileFromTerminal(
  workspaceId: string,
  paneId: string,
  tabId: string,
  filePath: string,
) {
  try {
    const instance = terminalsStore.get(tabId);
    if (!instance) return;

    // Get PTY info for SSH detection and local cwd
    const ptyInfo = await getPtyInfo(instance.ptyId);
    const sshCommand = ptyInfo.foreground_command;
    const isRemote = !!sshCommand;

    // Resolve relative paths
    let resolvedPath = filePath;
    if (!filePath.startsWith('/') && !filePath.startsWith('~')) {
      if (isRemote) {
        const oscState = terminalsStore.getOsc(tabId);
        const remoteCwd = oscState?.cwd ?? oscState?.promptCwd;
        if (remoteCwd) {
          resolvedPath = remoteCwd.endsWith('/') ? remoteCwd + filePath : remoteCwd + '/' + filePath;
        }
      } else {
        if (ptyInfo.cwd) {
          resolvedPath = ptyInfo.cwd.endsWith('/') ? ptyInfo.cwd + filePath : ptyInfo.cwd + '/' + filePath;
        }
      }
    }

    const language = detectLanguageFromPath(resolvedPath);
    const fileName = resolvedPath.split('/').pop() ?? resolvedPath;

    const fileInfo: EditorFileInfo = {
      file_path: resolvedPath,
      is_remote: isRemote,
      remote_ssh_command: isRemote ? sshCommand! : null,
      remote_path: isRemote ? resolvedPath : null,
      language,
    };

    // Create tab immediately — EditorPane shows loading state and handles errors
    await workspacesStore.createEditorTab(workspaceId, paneId, fileName, fileInfo);
  } catch (e) {
    logError(`Failed to open file: ${e}`);
  }
}
