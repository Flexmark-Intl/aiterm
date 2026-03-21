import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { toastStore } from './toasts.svelte';
import { info as logInfo, error as logError } from '@tauri-apps/plugin-log';

function createUpdaterStore() {
  let checking = $state(false);
  let downloading = $state(false);
  let currentUpdate = $state<Update | null>(null);

  async function checkForUpdates(silent = false): Promise<Update | null> {
    if (checking || downloading) return null;
    checking = true;
    try {
      const update = await check();
      if (update) {
        currentUpdate = update;
        logInfo(`Update available: v${update.version}`);
        toastStore.addToast(
          'Update Available',
          `Version ${update.version} is ready to install.`,
          'info',
          undefined,
          undefined,
          () => { downloadAndInstall(); }
        );
      } else if (!silent) {
        toastStore.addToast('Up to Date', 'You are running the latest version.', 'success');
      }
      return update;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`Update check failed: ${msg}`);
      if (!silent) {
        toastStore.addToast('Update Check Failed', msg, 'error');
      }
      return null;
    } finally {
      checking = false;
    }
  }

  async function downloadAndInstall() {
    if (!currentUpdate || downloading) return;
    downloading = true;
    try {
      toastStore.addToast('Updating', `Downloading v${currentUpdate.version}...`, 'info');
      await currentUpdate.downloadAndInstall();
      toastStore.addToast(
        'Update Installed',
        'Restart to apply the update.',
        'success',
        undefined,
        undefined,
        () => { relaunch(); }
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError(`Update install failed: ${msg}`);
      toastStore.addToast('Update Failed', msg, 'error');
    } finally {
      downloading = false;
    }
  }

  return {
    get checking() { return checking; },
    get downloading() { return downloading; },
    get currentUpdate() { return currentUpdate; },
    checkForUpdates,
    downloadAndInstall,
  };
}

export const updaterStore = createUpdaterStore();
