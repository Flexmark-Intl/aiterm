<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen } from '@tauri-apps/api/event';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import PreferencesModal from '$lib/components/PreferencesModal.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { getTheme, applyUiTheme } from '$lib/themes';
  import { error as logError, info as logInfo } from '@tauri-apps/plugin-log';
  import { attachConsole } from '@tauri-apps/plugin-log';
  import * as commands from '$lib/tauri/commands';
  import type { Preferences } from '$lib/tauri/types';
  import { isModKey } from '$lib/utils/platform';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();
  let showHelp = $state(false);
  let showPreferences = $state(false);

  // Apply UI theme reactively (runs outside onMount so it reacts to changes)
  $effect(() => {
    const t = getTheme(preferencesStore.theme, preferencesStore.customThemes);
    applyUiTheme(t.ui);
  });

  onMount(() => {
    // Attach console for dev mode (Rust logs appear in browser devtools)
    let detachConsole: (() => void) | undefined;
    attachConsole().then(detach => { detachConsole = detach; });

    // Load preferences
    preferencesStore.load().catch((e: unknown) => logError(`Failed to load preferences: ${e}`));

    // Listen for cross-window preference changes
    let unlistenPrefs: (() => void) | undefined;
    listen<Preferences>('preferences-changed', (event) => {
      preferencesStore.applyFromBackend(event.payload);
    }).then(unlisten => { unlistenPrefs = unlisten; });

    // Listen for app-wide quit (Cmd+Q / Quit menu).
    // All windows save scrollback, then exit — no window data is removed.
    let unlistenQuit: (() => void) | undefined;
    listen('quit-requested', async () => {
      logInfo('quit-requested — saving scrollback before exit');
      await terminalsStore.saveAllScrollback();
      try {
        await invoke('sync_state');
      } catch (e) {
        logError(`sync_state failed: ${e}`);
      }
      await invoke('exit_app');
    }).then(unlisten => { unlistenQuit = unlisten; });

    // Handle single-window close (traffic light / Cmd+W on last tab+pane).
    const appWindow = getCurrentWindow();
    let unlistenClose: (() => void) | undefined;

    (async () => {
      unlistenClose = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        logInfo('onCloseRequested fired — closing window');

        const count = await commands.getWindowCount();

        if (count <= 1) {
          // Last window: kill terminals and show empty state
          logInfo('Last window — showing empty state');
          await terminalsStore.killAllTerminals();
          await commands.resetWindow();
          workspacesStore.reset();
        } else {
          // Not last window: kill PTYs, remove window data, destroy
          logInfo('Closing window (not last)');
          await terminalsStore.killAllTerminals();
          await commands.closeWindow();
          try {
            await invoke('sync_state');
          } catch (e) {
            logError(`sync_state failed: ${e}`);
          }
          try {
            await appWindow.destroy();
          } catch (e) {
            logError(`destroy() failed: ${e}`);
          }
        }
      });
    })();

    function handleKeydown(e: KeyboardEvent) {
      const isMeta = isModKey(e);

      // Cmd+Shift+T - Duplicate tab
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        const tab = workspacesStore.activeTab;
        if (ws && pane && tab) {
          workspacesStore.duplicateTab(ws.id, pane.id, tab.id);
        }
        return;
      }

      // Cmd+T - New tab
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        if (ws && pane) {
          const count = pane.tabs.length + 1;
          workspacesStore.createTab(ws.id, pane.id, `Terminal ${count}`);
        }
        return;
      }

      // Cmd+D - Split pane right (horizontal), cloning context
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        const tab = workspacesStore.activeTab;
        if (ws && pane && tab) {
          workspacesStore.splitPaneWithContext(ws.id, pane.id, tab.id, 'horizontal');
        }
        return;
      }

      // Cmd+Shift+D - Split pane down (vertical), cloning context
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        const tab = workspacesStore.activeTab;
        if (ws && pane && tab) {
          workspacesStore.splitPaneWithContext(ws.id, pane.id, tab.id, 'vertical');
        }
        return;
      }

      // Cmd+Shift+N - Duplicate window
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation();
        workspacesStore.duplicateWindow();
        return;
      }

      // Cmd+N - New window
      if (isMeta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation();
        commands.createNewWindow();
        return;
      }

      // Cmd+Opt+N - New workspace (use e.code because Opt+N produces ˜ on macOS)
      if (isMeta && e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        const count = workspacesStore.workspaces.length + 1;
        workspacesStore.createWorkspace(`Workspace ${count}`);
        return;
      }

      // Cmd+W - Close current tab (or pane if last tab)
      if (isMeta && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        const tab = workspacesStore.activeTab;
        if (ws && pane && tab) {
          if (pane.tabs.length > 1) {
            workspacesStore.deleteTab(ws.id, pane.id, tab.id);
          } else if (ws.panes.length > 1) {
            workspacesStore.deletePane(ws.id, pane.id);
          } else {
            // Last tab in last pane — close tab, pane shows empty state
            workspacesStore.deleteTab(ws.id, pane.id, tab.id);
          }
        }
        return;
      }

      // Cmd+1-9 - Switch tabs
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        if (ws && pane && pane.tabs[index]) {
          workspacesStore.setActiveTab(ws.id, pane.id, pane.tabs[index].id);
          terminalsStore.focusTerminal(pane.tabs[index].id);
        }
        return;
      }

      // Cmd+Shift+[ - Previous tab
      if (isMeta && e.shiftKey && (e.key === '[' || e.code === 'BracketLeft')) {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        if (ws && pane && pane.tabs.length > 1) {
          const currentIndex = pane.tabs.findIndex(t => t.id === pane.active_tab_id);
          const prevIndex = currentIndex <= 0 ? pane.tabs.length - 1 : currentIndex - 1;
          workspacesStore.setActiveTab(ws.id, pane.id, pane.tabs[prevIndex].id);
          terminalsStore.focusTerminal(pane.tabs[prevIndex].id);
        }
        return;
      }

      // Cmd+Shift+] - Next tab
      if (isMeta && e.shiftKey && (e.key === ']' || e.code === 'BracketRight')) {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        if (ws && pane && pane.tabs.length > 1) {
          const currentIndex = pane.tabs.findIndex(t => t.id === pane.active_tab_id);
          const nextIndex = currentIndex >= pane.tabs.length - 1 ? 0 : currentIndex + 1;
          workspacesStore.setActiveTab(ws.id, pane.id, pane.tabs[nextIndex].id);
          terminalsStore.focusTerminal(pane.tabs[nextIndex].id);
        }
        return;
      }

      // Cmd+K - Clear terminal and scrollback
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        const tab = workspacesStore.activeTab;
        if (tab) {
          terminalsStore.clearTerminal(tab.id);
        }
        return;
      }

      // Cmd+F - Find in terminal
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        const tab = workspacesStore.activeTab;
        if (tab) {
          terminalsStore.toggleSearch(tab.id);
        }
        return;
      }

      // Cmd+= / Cmd++ - Zoom in
      if (isMeta && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        e.stopPropagation();
        preferencesStore.setFontSize(preferencesStore.fontSize + 1);
        return;
      }

      // Cmd+- - Zoom out
      if (isMeta && e.key === '-') {
        e.preventDefault();
        e.stopPropagation();
        preferencesStore.setFontSize(preferencesStore.fontSize - 1);
        return;
      }

      // Cmd+0 - Reset zoom
      if (isMeta && e.key === '0') {
        e.preventDefault();
        e.stopPropagation();
        preferencesStore.setFontSize(13);
        return;
      }

      // Cmd+/ or Cmd+? - Show help
      if (isMeta && (e.key === '/' || e.key === '?' || e.code === 'Slash')) {
        e.preventDefault();
        e.stopPropagation();
        showHelp = !showHelp;
        return;
      }

      // Cmd+B - Toggle sidebar
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        workspacesStore.toggleSidebar();
        return;
      }

      // Cmd+, - Show preferences
      if (isMeta && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        showPreferences = !showPreferences;
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown, true);

    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      unlistenClose?.();
      unlistenQuit?.();
      unlistenPrefs?.();
      detachConsole?.();
    };
  });
</script>

{@render children()}

<HelpModal open={showHelp} onclose={() => showHelp = false} />
<PreferencesModal open={showPreferences} onclose={() => showPreferences = false} />
