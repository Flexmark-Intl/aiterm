<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import PreferencesModal from '$lib/components/PreferencesModal.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();
  let showHelp = $state(false);
  let showPreferences = $state(false);

  onMount(() => {
    console.log('[layout] onMount starting');

    // Load preferences
    preferencesStore.load();

    // Handle window close - save all scrollback before closing
    const appWindow = getCurrentWindow();

    // Use async IIFE to properly await the listener setup
    (async () => {
      const unlisten = await appWindow.onCloseRequested(async (event) => {
        // Prevent immediate close so we can save
        event.preventDefault();

        // Save all terminal scrollback (also sets shuttingDown flag)
        await terminalsStore.saveAllScrollback();

        try {
          await invoke('sync_state');
        } catch (e) {
          console.error('sync_state failed:', e);
        }

        // Now allow the window to close
        await appWindow.destroy();
      });
      console.log('[layout] close handler registered');
    })();

    function handleKeydown(e: KeyboardEvent) {
      const isMeta = e.metaKey;

      // Cmd+T - New tab
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const win = workspacesStore.activeWindow;
        if (ws && win) {
          const count = win.tabs.length + 1;
          workspacesStore.createTab(ws.id, win.id, `Terminal ${count}`);
        }
        return;
      }

      // Cmd+Shift+T - New window
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        if (ws) {
          const count = ws.windows.length + 1;
          workspacesStore.createWindow(ws.id, `Window ${count}`);
        }
        return;
      }

      // Cmd+N - New workspace
      if (isMeta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        e.stopPropagation();
        const count = workspacesStore.workspaces.length + 1;
        workspacesStore.createWorkspace(`Workspace ${count}`);
        return;
      }

      // Cmd+W - Close current tab (or window if last tab)
      if (isMeta && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const win = workspacesStore.activeWindow;
        const tab = workspacesStore.activeTab;
        if (ws && win && tab) {
          if (win.tabs.length > 1) {
            workspacesStore.deleteTab(ws.id, win.id, tab.id);
          } else if (ws.windows.length > 1) {
            workspacesStore.deleteWindow(ws.id, win.id);
          }
        }
        return;
      }

      // Cmd+1-9 - Switch tabs
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        const ws = workspacesStore.activeWorkspace;
        const win = workspacesStore.activeWindow;
        if (ws && win && win.tabs[index]) {
          workspacesStore.setActiveTab(ws.id, win.id, win.tabs[index].id);
          terminalsStore.focusTerminal(win.tabs[index].id);
        }
        return;
      }

      // Cmd+Shift+[ - Previous tab
      if (isMeta && e.shiftKey && (e.key === '[' || e.code === 'BracketLeft')) {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const win = workspacesStore.activeWindow;
        if (ws && win && win.tabs.length > 1) {
          const currentIndex = win.tabs.findIndex(t => t.id === win.active_tab_id);
          const prevIndex = currentIndex <= 0 ? win.tabs.length - 1 : currentIndex - 1;
          workspacesStore.setActiveTab(ws.id, win.id, win.tabs[prevIndex].id);
          terminalsStore.focusTerminal(win.tabs[prevIndex].id);
        }
        return;
      }

      // Cmd+Shift+] - Next tab
      if (isMeta && e.shiftKey && (e.key === ']' || e.code === 'BracketRight')) {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const win = workspacesStore.activeWindow;
        if (ws && win && win.tabs.length > 1) {
          const currentIndex = win.tabs.findIndex(t => t.id === win.active_tab_id);
          const nextIndex = currentIndex >= win.tabs.length - 1 ? 0 : currentIndex + 1;
          workspacesStore.setActiveTab(ws.id, win.id, win.tabs[nextIndex].id);
          terminalsStore.focusTerminal(win.tabs[nextIndex].id);
        }
        return;
      }

      // Cmd+/ or Cmd+? - Show help
      if (isMeta && (e.key === '/' || e.key === '?' || e.code === 'Slash')) {
        e.preventDefault();
        e.stopPropagation();
        showHelp = !showHelp;
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
    };
  });
</script>

{@render children()}

<HelpModal open={showHelp} onclose={() => showHelp = false} />
<PreferencesModal open={showPreferences} onclose={() => showPreferences = false} />
