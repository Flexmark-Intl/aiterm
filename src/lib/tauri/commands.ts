import { invoke } from '@tauri-apps/api/core';
import type { AppData, DuplicateWorkspaceResult, Pane, Preferences, SplitDirection, Tab, WindowData, Workspace } from './types';

// Terminal commands
export async function spawnTerminal(ptyId: string, tabId: string, cols: number, rows: number, cwd?: string | null): Promise<void> {
  return invoke('spawn_terminal', { ptyId, tabId, cols, rows, cwd: cwd ?? null });
}

export interface PtyInfo {
  cwd: string | null;
  foreground_command: string | null;
}

/**
 * Strip previously-injected "-t" flag and "cd ... && exec $SHELL -l" remote
 * command from an SSH command retrieved from the process tree, so it doesn't
 * accumulate on each split/restore cycle.
 */
export function cleanSshCommand(cmd: string): string {
  if (!cmd.match(/^ssh\s/)) return cmd;
  // Remove our injected remote command (unquoted form from ps output)
  let cleaned = cmd.replace(/\s+cd\s+.*?&&\s+exec\s+\$?SHELL\s+-l\s*$/, '');
  // Also handle the single-quoted form
  cleaned = cleaned.replace(/\s+'cd\s+.*?&&\s+exec\s+\$?SHELL\s+-l'\s*$/, '');
  // Remove flags that buildSshCommand re-injects
  cleaned = cleaned.replace(/\s+-t(?=\s|$)/g, '');
  cleaned = cleaned.replace(/\s+-o\s+ControlMaster=\S+/g, '');
  // Remove any bare ControlMaster=... leftover (malformed from previous cycles)
  cleaned = cleaned.replace(/\s+ControlMaster=\S+/g, '');
  // Deduplicate single-letter flags (e.g. -x -C -x -C → -x -C)
  const parts = cleaned.split(/\s+/);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const part of parts) {
    if (/^-[a-zA-Z]$/.test(part)) {
      if (seen.has(part)) continue;
      seen.add(part);
    }
    deduped.push(part);
  }
  return deduped.join(' ');
}

export async function getPtyInfo(ptyId: string): Promise<PtyInfo> {
  const info: PtyInfo = await invoke('get_pty_info', { ptyId });
  if (info.foreground_command) {
    info.foreground_command = cleanSshCommand(info.foreground_command);
  }
  return info;
}

export async function writeTerminal(ptyId: string, data: number[]): Promise<void> {
  return invoke('write_terminal', { ptyId, data });
}

export async function resizeTerminal(ptyId: string, cols: number, rows: number): Promise<void> {
  return invoke('resize_terminal', { ptyId, cols, rows });
}

export async function killTerminal(ptyId: string): Promise<void> {
  return invoke('kill_terminal', { ptyId });
}

export async function readClipboardFilePaths(): Promise<string[]> {
  return invoke('read_clipboard_file_paths');
}

// Workspace commands
export async function getAppData(): Promise<AppData> {
  return invoke('get_app_data');
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return invoke('create_workspace', { name });
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  return invoke('delete_workspace', { workspaceId });
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  return invoke('rename_workspace', { workspaceId, name });
}

export async function splitPane(workspaceId: string, targetPaneId: string, direction: SplitDirection, scrollback?: string | null): Promise<Pane> {
  return invoke('split_pane', { workspaceId, targetPaneId, direction, scrollback: scrollback ?? null });
}

export async function deletePane(workspaceId: string, paneId: string): Promise<void> {
  return invoke('delete_pane', { workspaceId, paneId });
}

export async function renamePane(workspaceId: string, paneId: string, name: string): Promise<void> {
  return invoke('rename_pane', { workspaceId, paneId, name });
}

export async function createTab(workspaceId: string, paneId: string, name: string): Promise<Tab> {
  return invoke('create_tab', { workspaceId, paneId, name });
}

export async function deleteTab(workspaceId: string, paneId: string, tabId: string): Promise<void> {
  return invoke('delete_tab', { workspaceId, paneId, tabId });
}

export async function renameTab(workspaceId: string, paneId: string, tabId: string, name: string, customName?: boolean): Promise<void> {
  return invoke('rename_tab', { workspaceId, paneId, tabId, name, customName: customName ?? null });
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  return invoke('set_active_workspace', { workspaceId });
}

export async function setActivePane(workspaceId: string, paneId: string): Promise<void> {
  return invoke('set_active_pane', { workspaceId, paneId });
}

export async function setActiveTab(workspaceId: string, paneId: string, tabId: string): Promise<void> {
  return invoke('set_active_tab', { workspaceId, paneId, tabId });
}

export async function setTabPtyId(workspaceId: string, paneId: string, tabId: string, ptyId: string): Promise<void> {
  return invoke('set_tab_pty_id', { workspaceId, paneId, tabId, ptyId });
}

export async function setSidebarWidth(width: number): Promise<void> {
  return invoke('set_sidebar_width', { width });
}

export async function setSidebarCollapsed(collapsed: boolean): Promise<void> {
  return invoke('set_sidebar_collapsed', { collapsed });
}

export async function setSplitRatio(workspaceId: string, splitId: string, ratio: number): Promise<void> {
  return invoke('set_split_ratio', { workspaceId, splitId, ratio });
}

export async function setTabScrollback(workspaceId: string, paneId: string, tabId: string, scrollback: string | null): Promise<void> {
  return invoke('set_tab_scrollback', { workspaceId, paneId, tabId, scrollback });
}

export async function setTabNotes(workspaceId: string, paneId: string, tabId: string, notes: string | null): Promise<void> {
  return invoke('set_tab_notes', { workspaceId, paneId, tabId, notes });
}

export async function setTabNotesOpen(workspaceId: string, paneId: string, tabId: string, open: boolean): Promise<void> {
  return invoke('set_tab_notes_open', { workspaceId, paneId, tabId, open });
}

export async function setTabNotesMode(workspaceId: string, paneId: string, tabId: string, notesMode: string | null): Promise<void> {
  return invoke('set_tab_notes_mode', { workspaceId, paneId, tabId, notesMode });
}

export async function reorderTabs(workspaceId: string, paneId: string, tabIds: string[]): Promise<void> {
  return invoke('reorder_tabs', { workspaceId, paneId, tabIds });
}

export async function reorderWorkspaces(workspaceIds: string[]): Promise<void> {
  return invoke('reorder_workspaces', { workspaceIds });
}

export async function duplicateWorkspaceCmd(
  workspaceId: string,
  position: number,
  tabContexts: TabContext[],
): Promise<DuplicateWorkspaceResult> {
  return invoke('duplicate_workspace', { workspaceId, position, tabContexts });
}

export async function getPreferences(): Promise<Preferences> {
  return invoke('get_preferences');
}

export async function setPreferences(preferences: Preferences): Promise<void> {
  return invoke('set_preferences', { preferences });
}

export async function copyTabHistory(sourceTabId: string, destTabId: string): Promise<void> {
  return invoke('copy_tab_history', { sourceTabId, destTabId });
}

export async function setTabRestoreContext(
  workspaceId: string,
  paneId: string,
  tabId: string,
  cwd: string | null,
  sshCommand: string | null,
  remoteCwd: string | null,
): Promise<void> {
  return invoke('set_tab_restore_context', { workspaceId, paneId, tabId, cwd, sshCommand, remoteCwd });
}

export async function setTabTriggerVariables(
  workspaceId: string,
  paneId: string,
  tabId: string,
  vars: Record<string, string>,
): Promise<void> {
  return invoke('set_tab_trigger_variables', { workspaceId, paneId, tabId, vars });
}

export async function getAllWorkspaces(): Promise<[string, string][]> {
  return invoke('get_all_workspaces');
}

export async function setTabAutoResumeContext(
  workspaceId: string,
  paneId: string,
  tabId: string,
  cwd: string | null,
  sshCommand: string | null,
  remoteCwd: string | null,
  command: string | null,
): Promise<void> {
  return invoke('set_tab_auto_resume_context', { workspaceId, paneId, tabId, cwd, sshCommand, remoteCwd, command });
}

// Sound commands
export async function listSystemSounds(): Promise<string[]> {
  return invoke('list_system_sounds');
}

export async function playSystemSound(name: string, volume: number): Promise<void> {
  return invoke('play_system_sound', { name, volume });
}

// Window commands
export async function getWindowData(): Promise<WindowData> {
  return invoke('get_window_data');
}

export async function createNewWindow(): Promise<string> {
  return invoke('create_window');
}

export interface TabContext {
  tab_id: string;
  scrollback: string | null;
  cwd: string | null;
  ssh_command: string | null;
  remote_cwd: string | null;
}

export async function duplicateWindow(tabContexts: TabContext[]): Promise<string> {
  return invoke('duplicate_window', { tabContexts });
}

export async function closeWindow(): Promise<void> {
  return invoke('close_window');
}

export async function resetWindow(): Promise<void> {
  return invoke('reset_window');
}

export async function getWindowCount(): Promise<number> {
  return invoke('get_window_count');
}

export async function openPreferencesWindow(): Promise<void> {
  return invoke('open_preferences_window');
}
