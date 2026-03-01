<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { listen } from '@tauri-apps/api/event';
  import { workspacesStore, navigateToTab } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import HelpModal from '$lib/components/HelpModal.svelte';
  import ClaudeIntegrationModal from '$lib/components/ClaudeIntegrationModal.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { seedDefaultTriggers } from '$lib/triggers/defaults';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { getTheme, applyUiTheme } from '$lib/themes';
  import { error as logError, info as logInfo } from '@tauri-apps/plugin-log';
  import { attachConsole } from '@tauri-apps/plugin-log';
  import { onAction as onNotificationAction } from '@tauri-apps/plugin-notification';
  import * as commands from '$lib/tauri/commands';
  import type { ClaudeCodeToolRequest, Preferences } from '$lib/tauri/types';
  import { claudeCodeStore } from '$lib/stores/claudeCode.svelte';
  import { isModKey, isMac } from '$lib/utils/platform';
  import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
  import { openFileFromTerminal } from '$lib/utils/openFile';
  import { detectLanguageFromPath } from '$lib/utils/languageDetect';
  import { readFile } from '$lib/tauri/commands';
  import type { EditorFileInfo } from '$lib/tauri/types';
  // Side-effect import: subscribes to activity store for OS notifications
  import '$lib/stores/notifications.svelte';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();
  let showHelp = $state(false);
  let showClaudeIntegration = $state(false);

  function dismissClaudeIntegration() {
    showClaudeIntegration = false;
    preferencesStore.setClaudeTriggersPrompted(true);
  }

  function enableClaudeIntegration() {
    // Seed defaults if they don't exist yet, then enable all of them
    const seeded = seedDefaultTriggers(
      preferencesStore.triggers,
      preferencesStore.hiddenDefaultTriggers,
      true, // enableAll
    ) ?? preferencesStore.triggers;
    // Also enable any existing defaults that were disabled
    const updated = seeded.map(t =>
      t.default_id ? { ...t, enabled: true } : t
    );
    preferencesStore.setTriggers(updated);
    dismissClaudeIntegration();
  }

  function askLaterClaudeIntegration() {
    // Just close without setting the prompted flag — will ask again next launch
    showClaudeIntegration = false;
  }

  // Apply UI theme reactively (runs outside onMount so it reacts to changes)
  $effect(() => {
    const t = getTheme(preferencesStore.theme, preferencesStore.customThemes);
    applyUiTheme(t.ui);
  });

  // Update OS-level window title (Mission Control, Cmd+Tab, etc.)
  $effect(() => {
    const ws = workspacesStore.activeWorkspace;
    if (!ws) return;
    const suffix = import.meta.env.DEV ? ' (Dev)' : '';
    getCurrentWindow().setTitle(`aiTerm | ${ws.name}${suffix}`);
  });

  onMount(() => {
    // Attach console for dev mode (Rust logs appear in browser devtools)
    let detachConsole: (() => void) | undefined;
    attachConsole().then(detach => { detachConsole = detach; });

    // Disable default browser context menu globally, except in notes panel
    // where native cut/copy/paste is useful.
    // To re-enable in dev for Inspect Element, change to: if (!import.meta.env.DEV)
    document.addEventListener('contextmenu', (e) => {
      if ((e.target as Element)?.closest?.('.notes-panel')) return;
      e.preventDefault();
    }, true);

    // Load preferences, then check if Claude integration prompt is needed
    preferencesStore.load().then(() => {
      if (!preferencesStore.claudeTriggersPrompted) {
        const defaults = preferencesStore.triggers.filter(t => t.default_id);
        const allDisabled = defaults.length === 0 || defaults.every(t => !t.enabled);
        if (allDisabled) showClaudeIntegration = true;
      }
    }).catch((e: unknown) => logError(`Failed to load preferences: ${e}`));

    // Listen for cross-window preference changes
    let unlistenPrefs: (() => void) | undefined;
    listen<Preferences>('preferences-changed', (event) => {
      preferencesStore.applyFromBackend(event.payload);
    }).then(unlisten => { unlistenPrefs = unlisten; });

    const appWindow = getCurrentWindow();

    // Non-terminal windows (e.g. preferences) skip terminal lifecycle and shortcuts
    if (appWindow.label === 'preferences') {
      return () => {
        unlistenPrefs?.();
        detachConsole?.();
      };
    }

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

    // Listen for reload-tab menu event — duplicate tab with same context, close old
    let unlistenReloadTab: (() => void) | undefined;
    listen('reload-tab', () => {
      const ws = workspacesStore.activeWorkspace;
      const pane = workspacesStore.activePane;
      const tab = workspacesStore.activeTab;
      if (ws && pane && tab) {
        workspacesStore.reloadTab(ws.id, pane.id, tab.id);
      }
    }).then(unlisten => { unlistenReloadTab = unlisten; });

    // Claude Code IDE integration event listeners
    let unlistenClaudeTool: (() => void) | undefined;
    listen<ClaudeCodeToolRequest>('claude-code-tool', (event) => {
      claudeCodeStore.handleToolRequest(event.payload);
    }).then(unlisten => { unlistenClaudeTool = unlisten; });

    let unlistenClaudeConnection: (() => void) | undefined;
    listen<{ connected: boolean }>('claude-code-connection', (event) => {
      claudeCodeStore.setConnected(event.payload.connected);
    }).then(unlisten => { unlistenClaudeConnection = unlisten; });

    // OS notification click → deep-link to workspace+tab.
    // NOTE: onAction only fires on mobile (iOS/Android). On desktop (macOS/Linux/Windows),
    // tauri-plugin-notification uses notify_rust which is fire-and-forget with no click
    // callback. The extra.tabId and this listener are prep work for future mobile support.
    let unlistenNotificationAction: { unregister: () => Promise<void> } | undefined;
    onNotificationAction((notification) => {
      const tabId = (notification.extra as Record<string, unknown>)?.tabId;
      if (typeof tabId === 'string') {
        appWindow.setFocus();
        navigateToTab(tabId);
      }
    }).then(listener => { unlistenNotificationAction = listener; });

    // Handle single-window close (traffic light / Cmd+W on last tab+pane).
    let unlistenClose: (() => void) | undefined;

    (async () => {
      unlistenClose = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        logInfo('onCloseRequested fired — closing window');

        const count = await commands.getWindowCount();

        if (count <= 1 && isMac()) {
          // Last window on macOS: kill terminals and show empty state
          // (macOS convention: apps stay open with no windows)
          logInfo('Last window (macOS) — showing empty state');
          await terminalsStore.killAllTerminals();
          await commands.resetWindow();
          workspacesStore.reset();
        } else if (count <= 1) {
          // Last window on Windows/Linux: exit the app
          logInfo('Last window — exiting app');
          await terminalsStore.killAllTerminals();
          await invoke('exit_app');
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
      // Escape - close open modals
      if (e.key === 'Escape') {
        if (showClaudeIntegration) {
          e.preventDefault();
          e.stopPropagation();
          askLaterClaudeIntegration();
          return;
        }
        if (showHelp) {
          e.preventDefault();
          e.stopPropagation();
          showHelp = false;
          return;
        }
      }

      const isMeta = isModKey(e);
      const activeTabIsEditor = workspacesStore.activeTab?.tab_type === 'editor';

      // Cmd+Shift+R - Reload tab
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        const tab = workspacesStore.activeTab;
        if (ws && pane && tab) {
          workspacesStore.reloadTab(ws.id, pane.id, tab.id);
        }
        return;
      }

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
      // (Skip for editor tabs — CodeMirror uses Cmd+D for select next occurrence)
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'd') {
        if (activeTabIsEditor) return;
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

      // Cmd+Opt+Shift+N - Duplicate workspace
      if (isMeta && e.altKey && e.shiftKey && e.code === 'KeyN') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        if (ws) {
          const idx = workspacesStore.workspaces.findIndex(w => w.id === ws.id);
          workspacesStore.duplicateWorkspace(ws.id, idx + 1);
        }
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

      // Cmd+R - Auto-resume toggle (handled in TerminalPane, prevent browser reload)
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        return;
      }

      // Cmd+O - Open file in editor tab
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        e.stopPropagation();
        const ws = workspacesStore.activeWorkspace;
        const pane = workspacesStore.activePane;
        if (ws && pane) {
          // Default to active terminal's local CWD if available
          const activeTab = workspacesStore.activeTab;
          const instance = activeTab && activeTab.tab_type !== 'editor' ? terminalsStore.get(activeTab.id) : null;
          const ptyInfoP = instance ? commands.getPtyInfo(instance.ptyId).catch(() => null) : Promise.resolve(null);
          ptyInfoP.then(ptyInfo => dialogOpen({
            multiple: false,
            directory: false,
            title: 'Open File',
            defaultPath: ptyInfo?.cwd ?? undefined,
          })).then(async (selected) => {
            if (!selected) return;
            const filePath = selected;
            const fileName = filePath.split('/').pop() ?? filePath;
            const language = detectLanguageFromPath(filePath);
            // Validate the file can be read before creating the tab
            try {
              await readFile(filePath);
            } catch (err) {
              const { dispatch } = await import('$lib/stores/notificationDispatch');
              dispatch('Cannot open file', String(err), 'error');
              return;
            }
            const fileInfo: EditorFileInfo = {
              file_path: filePath,
              is_remote: false,
              remote_ssh_command: null,
              remote_path: null,
              language,
            };
            workspacesStore.createEditorTab(ws.id, pane.id, fileName, fileInfo);
          });
        }
        return;
      }

      // Cmd+S - Save active editor tab or prevent browser save dialog
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 's') {
        if (activeTabIsEditor) {
          // Let CodeMirror's Mod-s keymap handle it (EditorPane registers its own handler)
          return;
        }
        e.preventDefault();
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
      // Cmd+K - Clear terminal (skip for editor tabs)
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (activeTabIsEditor) return; // Let CodeMirror handle it
        e.preventDefault();
        e.stopPropagation();
        const tab = workspacesStore.activeTab;
        if (tab) {
          terminalsStore.clearTerminal(tab.id);
        }
        return;
      }

      // Cmd+F - Find in terminal (skip for editor tabs — CodeMirror has its own find/replace)
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (activeTabIsEditor) return; // Let CodeMirror handle it
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

      // Cmd+E - Toggle notes panel
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        e.stopPropagation();
        const tab = workspacesStore.activeTab;
        if (tab) {
          workspacesStore.toggleNotes(tab.id);
        }
        return;
      }

      // Cmd+B - Toggle sidebar
      if (isMeta && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        workspacesStore.toggleSidebar();
        return;
      }

      // Cmd+, - Open preferences window
      if (isMeta && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        commands.openPreferencesWindow();
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown, true);

    const handleToggleHelp = () => { showHelp = !showHelp; };
    window.addEventListener('toggle-help', handleToggleHelp);
    let unlistenHelp: (() => void) | undefined;
    listen('toggle-help', () => { showHelp = !showHelp; }).then(u => { unlistenHelp = u; });

    return () => {
      window.removeEventListener('keydown', handleKeydown, true);
      window.removeEventListener('toggle-help', handleToggleHelp);
      unlistenHelp?.();
      unlistenClose?.();
      unlistenQuit?.();
      unlistenReloadTab?.();
      unlistenClaudeTool?.();
      unlistenClaudeConnection?.();
      unlistenNotificationAction?.unregister();
      unlistenPrefs?.();
      detachConsole?.();
    };
  });
</script>

{@render children()}

<HelpModal open={showHelp} onclose={() => showHelp = false} />
<ClaudeIntegrationModal open={showClaudeIntegration} onclose={dismissClaudeIntegration} onenable={enableClaudeIntegration} onlater={askLaterClaudeIntegration} />
<Toast />
