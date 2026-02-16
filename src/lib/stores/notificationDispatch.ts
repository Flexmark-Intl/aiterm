import { preferencesStore } from './preferences.svelte';
import { toastStore } from './toasts.svelte';
import type { Toast } from './toasts.svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { info as logInfo } from '@tauri-apps/plugin-log';

async function sendOsNotification(title: string, body: string): Promise<void> {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === 'granted';
  }
  if (!granted) return;
  sendNotification({ title, body });
}

/**
 * Central notification dispatch. Routes to in-app toast or OS notification
 * based on the user's notification_mode preference and window focus state.
 */
export async function dispatch(
  title: string,
  body: string,
  type: Toast['type'] = 'info',
): Promise<void> {
  const mode = preferencesStore.notificationMode;

  if (mode === 'disabled') return;

  if (mode === 'native') {
    logInfo(`Notification (native): ${body}`);
    await sendOsNotification(title, body);
    return;
  }

  if (mode === 'in_app') {
    logInfo(`Notification (in-app): ${body}`);
    toastStore.addToast(title, body, type);
    return;
  }

  // mode === 'auto': toast when focused, OS when unfocused
  try {
    const focused = await getCurrentWindow().isFocused();
    if (focused) {
      logInfo(`Notification (auto/in-app): ${body}`);
      toastStore.addToast(title, body, type);
    } else {
      logInfo(`Notification (auto/native): ${body}`);
      await sendOsNotification(title, body);
    }
  } catch {
    // Fallback to in-app if focus check fails
    toastStore.addToast(title, body, type);
  }
}
