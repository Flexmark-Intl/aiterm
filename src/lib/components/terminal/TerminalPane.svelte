<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import '@xterm/xterm/css/xterm.css';
  import { spawnTerminal, writeTerminal, resizeTerminal, killTerminal, setTabScrollback } from '$lib/tauri/commands';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';

  interface Props {
    workspaceId: string;
    windowId: string;
    tabId: string;
    visible: boolean;
    initialScrollback?: string | null;
  }

  let { workspaceId, windowId, tabId, visible, initialScrollback }: Props = $props();

  let containerRef: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let serializeAddon: SerializeAddon;
  let ptyId: string;
  let unlistenOutput: UnlistenFn;
  let unlistenClose: UnlistenFn;
  let resizeObserver: ResizeObserver;
  let initialized = false;
  let debugInterval: ReturnType<typeof setInterval>;

  // Tokyo Night theme
  const theme = {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    cursorAccent: '#1a1b26',
    selectionBackground: '#33467c',
    selectionForeground: '#c0caf5',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  };

  onMount(async () => {
    ptyId = crypto.randomUUID();

    terminal = new Terminal({
      theme,
      fontFamily: `"${preferencesStore.fontFamily}", Monaco, "Courier New", monospace`,
      fontSize: preferencesStore.fontSize,
      lineHeight: 1.2,
      cursorBlink: preferencesStore.cursorBlink,
      cursorStyle: preferencesStore.cursorStyle,
      scrollback: preferencesStore.scrollbackLimit === 0 ? 100000 : preferencesStore.scrollbackLimit,
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef);

    // Restore scrollback if available
    if (initialScrollback) {
      console.log(`[${tabId.slice(0,8)}] Restoring scrollback: ${initialScrollback.length} chars`);
      terminal.write(initialScrollback);
      terminal.write('\r\n');
    } else {
      console.log(`[${tabId.slice(0,8)}] No scrollback to restore`);
    }

    // Wait for container to have dimensions
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 100)); // Extra delay for layout
    fitAddon.fit();

    let { cols, rows } = terminal;

    // Ensure minimum dimensions
    if (cols < 1) cols = 80;
    if (rows < 1) rows = 24;

    // Listen for PTY output
    let totalBytesReceived = 0;
    unlistenOutput = await listen<number[]>(`pty-output-${ptyId}`, (event) => {
      const data = new Uint8Array(event.payload);
      totalBytesReceived += data.length;
      terminal.write(data);
    });

    // Debug: log buffer stats periodically
    debugInterval = setInterval(() => {
      const bufferLength = terminal.buffer.active.length;
      console.log(`[${tabId.slice(0,8)}] visible=${visible}, bytes=${totalBytesReceived}, bufferLines=${bufferLength}`);
    }, 5000);

    // Auto-save is now handled reactively via $effect

    // Listen for PTY close
    unlistenClose = await listen(`pty-close-${ptyId}`, () => {
      terminal.write('\r\n[Process exited]\r\n');
    });

    // Spawn PTY with tab-specific history
    try {
      await spawnTerminal(ptyId, tabId, cols, rows);
    } catch (e) {
      console.error('Failed to spawn PTY:', e);
    }
    await workspacesStore.setTabPtyId(workspaceId, windowId, tabId, ptyId);

    // Register terminal instance with serialize addon for scrollback saving
    terminalsStore.register(tabId, terminal, ptyId, serializeAddon, workspaceId, windowId);

    // Handle keyboard input
    terminal.onData(async (data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      try {
        await writeTerminal(ptyId, bytes);
      } catch (e) {
        console.error('Failed to write to PTY:', e);
      }
    });

    // Handle resize
    resizeObserver = new ResizeObserver(() => {
      if (visible) {
        fitAddon.fit();
        const { cols, rows } = terminal;
        resizeTerminal(ptyId, cols, rows).catch(console.error);
      }
    });
    resizeObserver.observe(containerRef);

    initialized = true;
    terminal.focus();
  });

  onDestroy(() => {
    // Clear intervals
    if (debugInterval) clearInterval(debugInterval);

    // Do NOT save scrollback here — saveAllScrollback() handles it before
    // destroy is called, and async onDestroy is not awaited by Svelte,
    // which causes race conditions with terminal.dispose() below.

    if (unlistenOutput) unlistenOutput();
    if (unlistenClose) unlistenClose();
    if (resizeObserver) resizeObserver.disconnect();
    if (terminal) terminal.dispose();
    if (ptyId) {
      killTerminal(ptyId).catch(console.error);
    }
    terminalsStore.unregister(tabId);
  });

  $effect(() => {
    if (visible && initialized && fitAddon) {
      // Delay fit to ensure container is visible
      requestAnimationFrame(() => {
        fitAddon.fit();
        terminal.focus();
      });
    }
  });

  // React to preference changes for existing terminals
  $effect(() => {
    if (!initialized || !terminal) return;

    const fontSize = preferencesStore.fontSize;
    const fontFamily = preferencesStore.fontFamily;
    const cursorBlink = preferencesStore.cursorBlink;
    const cursorStyle = preferencesStore.cursorStyle;

    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = `"${fontFamily}", Monaco, "Courier New", monospace`;
    terminal.options.cursorBlink = cursorBlink;
    terminal.options.cursorStyle = cursorStyle;

    // Re-fit after font changes
    requestAnimationFrame(() => {
      if (fitAddon && visible) {
        fitAddon.fit();
        const { cols, rows } = terminal;
        resizeTerminal(ptyId, cols, rows).catch(console.error);
      }
    });
  });

  // React to auto-save interval changes
  $effect(() => {
    if (!initialized || !serializeAddon) return;

    const interval = preferencesStore.autoSaveInterval;

    // Set up new interval if enabled
    let localInterval: ReturnType<typeof setInterval> | undefined;
    if (interval > 0) {
      localInterval = setInterval(async () => {
        // Skip auto-save during shutdown — saveAllScrollback handles it
        if (terminalsStore.shuttingDown) return;
        try {
          const scrollback = serializeAddon.serialize();
          await setTabScrollback(workspaceId, windowId, tabId, scrollback);
        } catch (e) {
          console.error('Failed to auto-save scrollback:', e);
        }
      }, interval * 1000);
    }

    // Cleanup when effect re-runs or component unmounts
    return () => {
      if (localInterval) {
        clearInterval(localInterval);
      }
    };
  });
</script>

<div
  class="terminal-container"
  class:hidden={!visible}
  bind:this={containerRef}
></div>

<style>
  .terminal-container {
    flex: 1;
    padding: 4px;
    background: var(--bg-dark);
    overflow: hidden;
  }

  .terminal-container.hidden {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
  }

  .terminal-container :global(.xterm) {
    height: 100%;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
