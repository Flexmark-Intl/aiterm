import { invoke } from '@tauri-apps/api/core';
import type { AppData, Pane, Preferences, SplitDirection, Tab, Workspace } from './types';

// Terminal commands
export async function spawnTerminal(ptyId: string, tabId: string, cols: number, rows: number, cwd?: string | null): Promise<void> {
  return invoke('spawn_terminal', { ptyId, tabId, cols, rows, cwd: cwd ?? null });
}

export interface PtyInfo {
  cwd: string | null;
  foreground_command: string | null;
}

export async function getPtyInfo(ptyId: string): Promise<PtyInfo> {
  return invoke('get_pty_info', { ptyId });
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

export async function renameTab(workspaceId: string, paneId: string, tabId: string, name: string): Promise<void> {
  return invoke('rename_tab', { workspaceId, paneId, tabId, name });
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

export async function setSplitRatio(workspaceId: string, splitId: string, ratio: number): Promise<void> {
  return invoke('set_split_ratio', { workspaceId, splitId, ratio });
}

export async function setTabScrollback(workspaceId: string, paneId: string, tabId: string, scrollback: string | null): Promise<void> {
  return invoke('set_tab_scrollback', { workspaceId, paneId, tabId, scrollback });
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
