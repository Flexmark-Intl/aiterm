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
    // Load preferences
    preferencesStore.load().catch((e: unknown) => console.error('Failed to load preferences:', e));

    // Handle window close - save all scrollback before closing
    const appWindow = getCurrentWindow();
    let unlistenClose: (() => void) | undefined;

    (async () => {
      unlistenClose = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();

        await terminalsStore.saveAllScrollback();

        try {
          await invoke('sync_state');
        } catch (e) {
          console.error('sync_state failed:', e);
        }

        await appWindow.destroy();
      });
    })();

    function handleKeydown(e: KeyboardEvent) {
      const isMeta = e.metaKey;

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

      // Cmd+Shift+T - New pane
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        if (ws) {
          const count = ws.panes.length + 1;
          workspacesStore.createPane(ws.id, `Pane ${count}`);
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
      unlistenClose?.();
    };
  });
</script>

{@render children()}

<HelpModal open={showHelp} onclose={() => showHelp = false} />
<PreferencesModal open={showPreferences} onclose={() => showPreferences = false} />
