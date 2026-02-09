<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import { SearchAddon } from '@xterm/addon-search';
  import '@xterm/xterm/css/xterm.css';
  import { spawnTerminal, writeTerminal, resizeTerminal, killTerminal, setTabScrollback, getPtyInfo, setTabRestoreContext } from '$lib/tauri/commands';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import { getTheme } from '$lib/themes';
  import { getCompiledPatterns } from '$lib/utils/promptPattern';
  import { error as logError } from '@tauri-apps/plugin-log';

  interface Props {
    workspaceId: string;
    paneId: string;
    tabId: string;
    visible: boolean;
    initialScrollback?: string | null;
    restoreCwd?: string | null;
    restoreSshCommand?: string | null;
    restoreRemoteCwd?: string | null;
  }

  let { workspaceId, paneId, tabId, visible, initialScrollback, restoreCwd, restoreSshCommand, restoreRemoteCwd }: Props = $props();

  let containerRef: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let serializeAddon: SerializeAddon;
  let searchAddon: SearchAddon;
  let ptyId: string;
  let unlistenOutput: UnlistenFn;
  let unlistenClose: UnlistenFn;
  let resizeObserver: ResizeObserver;
  let initialized = $state(false);
  let trackActivity = false;

  // Fit terminal with one fewer row for bottom breathing room
  function fitWithPadding() {
    // Guard: skip if container is not in the document (detached during split re-render)
    if (!containerRef?.isConnected) return;
    fitAddon.fit();
    const { cols, rows } = terminal;
    if (rows > 1) {
      terminal.resize(cols, rows - 1);
    }
  }
  let contextMenu = $state<{ x: number; y: number } | null>(null);

  // Escape a path for use inside single quotes.
  // Handles ~ by leaving it unquoted so the shell expands it.
  function shellEscapePath(path: string): string {
    if (path === '~') return '~';
    if (path.startsWith('~/')) {
      const rest = path.slice(2).replace(/'/g, "'\\''");
      return `~/'${rest}'`;
    }
    const escaped = path.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }

  // Build the SSH command for split cloning.
  // For ssh: inject -t and append 'cd <path> && exec "$SHELL" -l'
  // so the remote shell starts in the right directory atomically.
  function buildSshCommand(sshCmd: string | null, remoteCwd: string | null): string {
    if (!sshCmd) return '';
    if (!remoteCwd) return sshCmd;

    const cdPath = shellEscapePath(remoteCwd);

    // If it's a plain ssh command, inject -t and append remote command
    const sshMatch = sshCmd.match(/^(ssh\s+)/);
    if (sshMatch) {
      const rest = sshCmd.slice(sshMatch[1].length);
      return `ssh -t ${rest} 'cd ${cdPath} && exec $SHELL -l'`;
    }

    // Fallback for aliases/mosh/autossh: send ssh command then cd on next line
    return sshCmd + '\n' + `cd ${cdPath}`;
  }

  // Portal: attach containerRef to its slot in the split tree
  function attachToSlot() {
    const slot = document.querySelector(`[data-terminal-slot="${tabId}"]`) as HTMLElement;
    if (slot && containerRef && containerRef.parentElement !== slot) {
      slot.appendChild(containerRef);
      if (visible && initialized) {
        requestAnimationFrame(() => {
          fitWithPadding();
          const { cols, rows } = terminal;
          resizeTerminal(ptyId, cols, rows).catch(e => logError(String(e)));
        });
      }
    }
  }

  function handleSlotReady(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.tabId === tabId) {
      attachToSlot();
    }
  }

  onMount(async () => {
    ptyId = crypto.randomUUID();

    terminal = new Terminal({
      theme: getTheme(preferencesStore.theme, preferencesStore.customThemes).terminal,
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
    searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef);

    // OSC 0 (icon name + title) and OSC 2 (title): shells/programs set window title
    terminal.parser.registerOscHandler(0, (data) => {
      if (data) terminalsStore.updateOsc(tabId, { title: data });
      return true;
    });
    terminal.parser.registerOscHandler(2, (data) => {
      if (data) terminalsStore.updateOsc(tabId, { title: data });
      return true;
    });

    // OSC 7: shells report cwd via \e]7;file://host/path\e\\
    terminal.parser.registerOscHandler(7, (data) => {
      try {
        const url = new URL(data);
        if (url.protocol === 'file:') {
          const cwd = decodeURIComponent(url.pathname);
          const cwdHost = url.hostname || null;
          if (cwd) terminalsStore.updateOsc(tabId, { cwd, cwdHost });
        }
      } catch {
        // not a valid URL — ignore
      }
      return true;
    });

    // Portal into the slot rendered by SplitPane
    attachToSlot();

    // Listen for slot re-creation (after split tree changes)
    window.addEventListener('terminal-slot-ready', handleSlotReady);

    // Restore scrollback if available
    if (initialScrollback) {
      terminal.write(initialScrollback);

      // Check if the last line looks like a shell prompt — if so, erase it
      // to avoid a duplicate prompt when the new shell starts.
      // If not a prompt, add a newline for clean separation.
      const buffer = terminal.buffer.active;
      const lastLine = buffer.getLine(buffer.baseY + buffer.cursorY);
      const lineText = lastLine?.translateToString(true) ?? '';
      const lineRaw = lastLine?.translateToString(false) ?? '';
      if (lineRaw.trim().length === 0 && lineRaw.length > 0) {
        // Whitespace-only line — erase it
        terminal.write('\x1b[2K\r');
      } else if (lineText.length > 0 && /[$%>#]\s*$/.test(lineText)) {
        terminal.write('\x1b[2K\r');
      } else if (lineText.length > 0) {
        terminal.write('\r\n');
      }
    }

    // Wait for container to have dimensions
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 100)); // Extra delay for layout
    fitWithPadding();

    let { cols, rows } = terminal;

    // Ensure minimum dimensions
    if (cols < 1) cols = 80;
    if (rows < 1) rows = 24;

    // Listen for PTY output
    unlistenOutput = await listen<number[]>(`pty-output-${ptyId}`, (event) => {
      const data = new Uint8Array(event.payload);
      terminal.write(data);
      if (!visible && trackActivity) {
        activityStore.markActive(tabId);
      }
    });

    // Listen for PTY close
    unlistenClose = await listen(`pty-close-${ptyId}`, () => {
      terminal.write('\r\n[Process exited]\r\n');
    });

    // Check for split context (cwd, SSH command from source pane)
    // Fall back to persisted restore context from last session
    const splitCtx = terminalsStore.consumeSplitContext(tabId);
    const ctx = splitCtx ?? (restoreCwd || restoreSshCommand
      ? { cwd: restoreCwd ?? null, sshCommand: restoreSshCommand ?? null, remoteCwd: restoreRemoteCwd ?? null }
      : null);

    // Spawn PTY with tab-specific history, optionally inheriting cwd
    try {
      await spawnTerminal(ptyId, tabId, cols, rows, ctx?.cwd);
    } catch (e) {
      logError(`Failed to spawn PTY: ${e}`);
    }
    await workspacesStore.setTabPtyId(workspaceId, paneId, tabId, ptyId);

    // If the source pane was running SSH (or last session had SSH), replay the command
    if (ctx?.sshCommand) {
      // Small delay to let the local shell prompt initialize before sending
      setTimeout(async () => {
        try {
          const cmd = buildSshCommand(ctx.sshCommand, ctx.remoteCwd);
          const bytes = Array.from(new TextEncoder().encode(cmd + '\n'));
          await writeTerminal(ptyId, bytes);
        } catch (e) {
          logError(`Failed to replay SSH command: ${e}`);
        }
      }, 500);
    }

    // Register terminal instance with serialize addon for scrollback saving
    terminalsStore.register(tabId, terminal, ptyId, serializeAddon, searchAddon, workspaceId, paneId);

    // Cmd+C: copy if selection, SIGINT if not. Cmd+V: paste into PTY.
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;

      if (e.metaKey && e.key === 'c') {
        e.preventDefault();
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
        } else {
          writeTerminal(ptyId, [0x03]).catch(e => logError(String(e)));
        }
        return false;
      }

      if (e.metaKey && e.key === 'v') {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) {
            const bytes = Array.from(new TextEncoder().encode(text));
            writeTerminal(ptyId, bytes).catch(e => logError(String(e)));
          }
        });
        return false;
      }

      return true;
    });

    // Handle keyboard input
    terminal.onData(async (data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      try {
        await writeTerminal(ptyId, bytes);
      } catch (e) {
        logError(`Failed to write to PTY: ${e}`);
      }
    });

    // Handle resize
    resizeObserver = new ResizeObserver(() => {
      if (visible && containerRef?.isConnected) {
        fitWithPadding();
        const { cols, rows } = terminal;
        resizeTerminal(ptyId, cols, rows).catch(e => logError(String(e)));
      }
    });
    resizeObserver.observe(containerRef);

    initialized = true;
    terminal.focus();
    // Delay activity tracking so initial shell prompt doesn't trigger indicator
    setTimeout(() => { trackActivity = true; }, 2000);
  });

  onDestroy(() => {
    // Do NOT save scrollback here — saveAllScrollback() handles it before
    // destroy is called, and async onDestroy is not awaited by Svelte,
    // which causes race conditions with terminal.dispose() below.

    window.removeEventListener('terminal-slot-ready', handleSlotReady);
    if (unlistenOutput) unlistenOutput();
    if (unlistenClose) unlistenClose();
    if (resizeObserver) resizeObserver.disconnect();
    if (terminal) terminal.dispose();
    if (ptyId) {
      killTerminal(ptyId).catch(e => logError(String(e)));
    }
    terminalsStore.unregister(tabId);
  });

  $effect(() => {
    if (visible && initialized && fitAddon) {
      // Delay fit to ensure container is visible
      requestAnimationFrame(() => {
        fitWithPadding();
        terminal.focus();
      });
      activityStore.clearActive(tabId);
    }
  });

  // React to preference changes for existing terminals
  $effect(() => {
    if (!initialized || !terminal) return;

    const fontSize = preferencesStore.fontSize;
    const fontFamily = preferencesStore.fontFamily;
    const cursorBlink = preferencesStore.cursorBlink;
    const cursorStyle = preferencesStore.cursorStyle;
    const themeId = preferencesStore.theme;

    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = `"${fontFamily}", Monaco, "Courier New", monospace`;
    terminal.options.cursorBlink = cursorBlink;
    terminal.options.cursorStyle = cursorStyle;
    terminal.options.theme = getTheme(themeId, preferencesStore.customThemes).terminal;

    // Re-fit after font changes
    requestAnimationFrame(() => {
      if (fitAddon && visible) {
        fitWithPadding();
        const { cols, rows } = terminal;
        resizeTerminal(ptyId, cols, rows).catch(e => logError(String(e)));
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
          await setTabScrollback(workspaceId, paneId, tabId, scrollback);
        } catch (e) {
          logError(`Failed to auto-save scrollback: ${e}`);
        }

        // Also save restore context (cwd/SSH) if enabled
        if (preferencesStore.restoreSession) {
          try {
            const info = await getPtyInfo(ptyId);
            let cwd = info.cwd;
            const sshCommand = info.foreground_command;
            let remoteCwd: string | null = null;

            const osc7Cwd = terminalsStore.getOsc(tabId)?.cwd ?? null;
            if (sshCommand) {
              const isOsc7Stale = osc7Cwd === cwd;
              const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
              if (osc7RemoteCwd) {
                remoteCwd = osc7RemoteCwd;
              } else {
                // Fall back to prompt pattern extraction
                const patterns = getCompiledPatterns(preferencesStore.promptPatterns);
                const buffer = terminal.buffer.active;
                const cursorLine = buffer.baseY + buffer.cursorY;
                for (let i = cursorLine; i >= Math.max(0, cursorLine - 5); i--) {
                  const line = buffer.getLine(i);
                  if (!line) continue;
                  const text = line.translateToString(true).trim();
                  if (!text) continue;
                  for (const re of patterns) {
                    const match = text.match(re);
                    if (match?.[1]) { remoteCwd = match[1]; break; }
                  }
                  if (remoteCwd) break;
                }
              }
            } else {
              cwd = cwd ?? osc7Cwd;
            }

            await setTabRestoreContext(workspaceId, paneId, tabId, cwd, sshCommand, remoteCwd);
          } catch {
            // PTY may be gone — ignore
          }
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

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    contextMenu = { x: e.clientX, y: e.clientY };
  }

  function getContextMenuItems() {
    const hasSelection = terminal?.hasSelection();
    return [
      {
        label: 'Copy',
        shortcut: '⌘C',
        disabled: !hasSelection,
        action: async () => {
          const text = terminal.getSelection();
          if (text) await navigator.clipboard.writeText(text);
        },
      },
      {
        label: 'Paste',
        shortcut: '⌘V',
        action: async () => {
          const text = await navigator.clipboard.readText();
          if (text) {
            const bytes = Array.from(new TextEncoder().encode(text));
            await writeTerminal(ptyId, bytes);
          }
        },
      },
      {
        label: 'Select All',
        shortcut: '⌘A',
        action: () => {
          terminal.selectAll();
        },
      },
      { label: '', separator: true, action: () => {} },
      {
        label: 'Clear',
        shortcut: '⌘K',
        action: () => {
          terminalsStore.clearTerminal(tabId);
        },
      },
    ];
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-container"
  class:hidden={!visible}
  bind:this={containerRef}
  oncontextmenu={handleContextMenu}
></div>

{#if contextMenu}
  <ContextMenu
    items={getContextMenuItems()}
    x={contextMenu.x}
    y={contextMenu.y}
    onclose={() => { contextMenu = null; terminal?.focus(); }}
  />
{/if}

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
