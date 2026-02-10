import { activityStore } from './activity.svelte';
import { preferencesStore } from './preferences.svelte';
import { workspacesStore } from './workspaces.svelte';
import { terminalsStore } from './terminals.svelte';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { info as logInfo } from '@tauri-apps/plugin-log';

/** Tracks when each tab's command started (for duration check). */
const commandStartTimes = new Map<string, number>();

function isTabVisible(tabId: string): boolean {
  const ws = workspacesStore.activeWorkspace;
  if (!ws) return false;
  const pane = ws.panes.find(p => p.active_tab_id === tabId);
  if (!pane) return false;
  return pane.id === ws.active_pane_id;
}

function getTabName(tabId: string): string {
  const osc = terminalsStore.getOsc(tabId);
  if (osc?.title) return osc.title;
  // Fall back to workspace tab name
  for (const ws of workspacesStore.workspaces) {
    for (const pane of ws.panes) {
      const tab = pane.tabs.find(t => t.id === tabId);
      if (tab) return tab.name;
    }
  }
  return 'Terminal';
}

async function handleCommandComplete(tabId: string, exitCode: number) {
  if (!preferencesStore.notifyOnCompletion) return;
  if (isTabVisible(tabId)) return;

  const startTime = commandStartTimes.get(tabId);
  if (startTime) {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed < preferencesStore.notifyMinDuration) return;
  } else {
    // No start time recorded — can't verify duration, skip
    return;
  }

  commandStartTimes.delete(tabId);

  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }
  if (!granted) return;

  const name = getTabName(tabId);
  const body = exitCode === 0
    ? `"${name}" has finished`
    : `"${name}" has finished (exit code ${exitCode})`;

  logInfo(`Sending notification: ${body}`);
  sendNotification({ title: 'Command Completed', body });
}

function handleCommandStart(tabId: string) {
  commandStartTimes.set(tabId, Date.now());
}

// Self-initializing subscriptions
activityStore.onCommandStart(handleCommandStart);
activityStore.onCommandComplete(handleCommandComplete);
