import { invoke } from '@tauri-apps/api/core';
import type { AppData, Layout, Preferences, Tab, Window, Workspace } from './types';

// Terminal commands
export async function spawnTerminal(ptyId: string, tabId: string, cols: number, rows: number): Promise<void> {
  return invoke('spawn_terminal', { ptyId, tabId, cols, rows });
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

export async function saveAppData(data: AppData): Promise<void> {
  return invoke('save_app_data', { data });
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

export async function createWindow(workspaceId: string, name: string): Promise<Window> {
  return invoke('create_window', { workspaceId, name });
}

export async function deleteWindow(workspaceId: string, windowId: string): Promise<void> {
  return invoke('delete_window', { workspaceId, windowId });
}

export async function renameWindow(workspaceId: string, windowId: string, name: string): Promise<void> {
  return invoke('rename_window', { workspaceId, windowId, name });
}

export async function createTab(workspaceId: string, windowId: string, name: string): Promise<Tab> {
  return invoke('create_tab', { workspaceId, windowId, name });
}

export async function deleteTab(workspaceId: string, windowId: string, tabId: string): Promise<void> {
  return invoke('delete_tab', { workspaceId, windowId, tabId });
}

export async function renameTab(workspaceId: string, windowId: string, tabId: string, name: string): Promise<void> {
  return invoke('rename_tab', { workspaceId, windowId, tabId, name });
}

export async function setActiveWorkspace(workspaceId: string): Promise<void> {
  return invoke('set_active_workspace', { workspaceId });
}

export async function setActiveWindow(workspaceId: string, windowId: string): Promise<void> {
  return invoke('set_active_window', { workspaceId, windowId });
}

export async function setActiveTab(workspaceId: string, windowId: string, tabId: string): Promise<void> {
  return invoke('set_active_tab', { workspaceId, windowId, tabId });
}

export async function setTabPtyId(workspaceId: string, windowId: string, tabId: string, ptyId: string): Promise<void> {
  return invoke('set_tab_pty_id', { workspaceId, windowId, tabId, ptyId });
}

export async function setLayout(layout: Layout): Promise<void> {
  return invoke('set_layout', { layout });
}

export async function setSidebarWidth(width: number): Promise<void> {
  return invoke('set_sidebar_width', { width });
}

export async function setWindowSizes(workspaceId: string, layout: Layout, sizes: Record<string, number>): Promise<void> {
  return invoke('set_window_sizes', { workspaceId, layout, sizes });
}

export async function setTabScrollback(workspaceId: string, windowId: string, tabId: string, scrollback: string | null): Promise<void> {
  return invoke('set_tab_scrollback', { workspaceId, windowId, tabId, scrollback });
}

export async function getPreferences(): Promise<Preferences> {
  return invoke('get_preferences');
}

export async function setPreferences(preferences: Preferences): Promise<void> {
  return invoke('set_preferences', { preferences });
}
