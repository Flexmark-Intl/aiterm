<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import type { UnlistenFn } from '@tauri-apps/api/event';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import { SearchAddon } from '@xterm/addon-search';
  import '@xterm/xterm/css/xterm.css';
  import { spawnTerminal, writeTerminal, resizeTerminal, killTerminal, setTabScrollback, getPtyInfo, setTabRestoreContext, cleanSshCommand, readClipboardFilePaths } from '$lib/tauri/commands';
  import { readText as clipboardReadText, writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import { getTheme } from '$lib/themes';
  import { getCompiledPatterns } from '$lib/utils/promptPattern';
  import { error as logError } from '@tauri-apps/plugin-log';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { isModKey, modSymbol } from '$lib/utils/platform';
  import { buildShellIntegrationSnippet, buildInstallSnippet } from '$lib/utils/shellIntegration';
  import ResizableTextarea from '$lib/components/ResizableTextarea.svelte';
  import { processOutput, cleanupTab, loadTabVariables, interpolateVariables, getVariables, clearTabVariables } from '$lib/stores/triggers.svelte';
  import { dispatch } from '$lib/stores/notificationDispatch';
  import { CLAUDE_RESUME_COMMAND } from '$lib/triggers/defaults';

  interface Props {
    workspaceId: string;
    paneId: string;
    tabId: string;
    visible: boolean;
    initialScrollback?: string | null;
    restoreCwd?: string | null;
    restoreSshCommand?: string | null;
    restoreRemoteCwd?: string | null;
    autoResumeCwd?: string | null;
    autoResumeSshCommand?: string | null;
    autoResumeRemoteCwd?: string | null;
    autoResumeCommand?: string | null;
    autoResumeRememberedCommand?: string | null;
    triggerVariables?: Record<string, string>;
  }

  let { workspaceId, paneId, tabId, visible, initialScrollback, restoreCwd, restoreSshCommand, restoreRemoteCwd, autoResumeCwd, autoResumeSshCommand, autoResumeRemoteCwd, autoResumeCommand, autoResumeRememberedCommand, triggerVariables }: Props = $props();

  let containerRef: HTMLDivElement;
  let terminal: Terminal;
  let fitAddon: FitAddon;
  let serializeAddon: SerializeAddon;
  let searchAddon: SearchAddon;
  let ptyId: string;
  let unlistenOutput: UnlistenFn;
  let unlistenClose: UnlistenFn;
  let unlistenDragOver: UnlistenFn;
  let unlistenDragDrop: UnlistenFn;
  let unlistenDragLeave: UnlistenFn;
  let resizeObserver: ResizeObserver;
  let initialized = $state(false);
  let trackActivity = false;
  let visibilityGraceUntil = 0; // timestamp — suppress activity until this time
  let isAutoResume = $state(false);
  // Initialized in onMount from prop (intentionally one-time read, managed locally after)
  let resizePtyTimeout: ReturnType<typeof setTimeout> | undefined;
  // Inline prompt for auto-resume command
  let autoResumePrompt = $state<{ cwd: string | null; sshCmd: string | null; remoteCwd: string | null } | null>(null);
  let autoResumePromptValue = $state('');
  let claudeSetupModal = $state(false);
  let autoResumeTextarea = $state<{ focus: () => void } | undefined>();
  let autoResumeHeightBeforeMouse = 0;

  // Fit terminal with one fewer row for bottom breathing room.
  // Uses proposeDimensions() + a single resize instead of fit() + resize()
  // to avoid a double reflow that corrupts the scroll position.
  function fitWithPadding() {
    // Guard: skip if container is not in the document (detached during split re-render)
    if (!containerRef?.isConnected) return;
    const dims = fitAddon.proposeDimensions();
    if (!dims || isNaN(dims.cols) || isNaN(dims.rows)) return;
    const cols = dims.cols;
    const rows = Math.max(dims.rows - 1, 1);
    // Guard: skip transient layouts during portal moves where the container
    // is connected but hasn't been laid out yet, producing tiny dimensions.
    if (cols < 10 || rows < 2) return;
    if (cols === terminal.cols && rows === terminal.rows) return;
    const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
    terminal.resize(cols, rows);
    if (wasAtBottom) {
      terminal.scrollToBottom();
    }
  }
  let contextMenu = $state<{ x: number; y: number } | null>(null);
  let isDragOver = $state(false);

  // Escape a file path for pasting into a terminal (backslash-escape shell metacharacters)
  function escapePathForTerminal(p: string): string {
    return p.replace(/([^a-zA-Z0-9_\-.,/:@+])/g, '\\$1');
  }

  // Paste from clipboard using native Tauri APIs (bypasses WKWebView paste popup).
  // Checks for file paths first (Finder copy), then falls back to text.
  async function pasteFromClipboard() {
    // Check for file URLs first (Finder Cmd+C puts filename as text too,
    // but we want the full path from NSPasteboard)
    const paths = await readClipboardFilePaths();
    if (paths.length > 0) {
      const escaped = paths.map(escapePathForTerminal).join(' ');
      const bytes = Array.from(new TextEncoder().encode(escaped));
      await writeTerminal(ptyId, bytes);
      return;
    }

    const text = await clipboardReadText();
    if (text) {
      const bytes = Array.from(new TextEncoder().encode(text));
      await writeTerminal(ptyId, bytes);
    }
  }

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
    if (!remoteCwd) {
      // Inject ControlMaster=no to avoid multiplexing conflict on restore
      return sshCmd.replace(/^ssh\s+/, 'ssh -o ControlMaster=no ');
    }

    const cdPath = shellEscapePath(remoteCwd);

    // If it's a plain ssh command, inject -t and append remote command
    const sshMatch = sshCmd.match(/^(ssh\s+)/);
    if (sshMatch) {
      const rest = sshCmd.slice(sshMatch[1].length);
      return `ssh -t -o ControlMaster=no ${rest} 'cd ${cdPath} && exec $SHELL -l'`;
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
    isAutoResume = !!(autoResumeSshCommand || autoResumeCwd);

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
    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      shellOpen(uri);
    }));

    terminal.open(containerRef);

    // OSC 0 (icon name + title) and OSC 2 (title): shells/programs set window title
    // promptCwd is auto-derived from title in terminalsStore.updateOsc()
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

    // Shell integration handler — shared by OSC 133 (FinalTerm) and OSC 633 (VS Code)
    // Gated on trackActivity to ignore sequences replayed from restored scrollback.
    let commandStartedAt = 0;
    const MIN_COMPLETION_MS = 2000; // Only show completed indicator for commands that ran 2s+
    function handleShellIntegration(data: string): boolean {
      if (!trackActivity) return true;
      const parts = data.split(';');
      const cmd = parts[0];
      if (cmd === 'A') {
        activityStore.setShellState(tabId, 'prompt');
      } else if (cmd === 'D') {
        const elapsed = commandStartedAt ? Date.now() - commandStartedAt : 0;
        if (elapsed >= MIN_COMPLETION_MS) {
          const exitCode = parts[1] ? parseInt(parts[1], 10) : 0;
          activityStore.setShellState(tabId, 'completed', exitCode);
        }
        // For short commands, just let the subsequent A set 'prompt'
      }
      if (cmd === 'B' || cmd === 'C') {
        commandStartedAt = Date.now();
        activityStore.setShellState(tabId, null);
      }
      return true;
    }
    terminal.parser.registerOscHandler(133, handleShellIntegration);
    terminal.parser.registerOscHandler(633, handleShellIntegration);

    // OSC 9: notification — programs emit \e]9;message\a to request a notification
    // Some programs (e.g. Claude Code) emit OSC 9 with protocol data like "4;0;"
    // that isn't a human-readable message — skip payloads that are only digits/semicolons.
    terminal.parser.registerOscHandler(9, (data) => {
      if (!trackActivity || !data) return true;
      if (/^[\d;]*$/.test(data)) return true;
      const oscState = terminalsStore.getOsc(tabId);
      const title = oscState?.title || 'Terminal';
      dispatch(title, data, 'info');
      return true;
    });

    // OSC 52: clipboard set — \e]52;c;base64data\a writes to system clipboard
    // Ignores query requests (? payload) for security.
    terminal.parser.registerOscHandler(52, (data) => {
      if (!trackActivity) return true;
      const semi = data.indexOf(';');
      if (semi < 0) return true;
      const payload = data.slice(semi + 1);
      if (!payload || payload === '?') return true;
      try {
        const decoded = atob(payload);
        clipboardWriteText(decoded).catch(e => logError(String(e)));
      } catch {
        // invalid base64 — ignore
      }
      return true;
    });

    // OSC 1337: iTerm2 extensions — only handle CurrentDir for cwd reporting
    terminal.parser.registerOscHandler(1337, (data) => {
      const match = data.match(/^CurrentDir=(.+)$/);
      if (match) {
        const cwd = match[1];
        if (cwd) terminalsStore.updateOsc(tabId, { cwd, cwdHost: null });
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

      // Reset DEC private modes that programs may have enabled during the
      // previous session. The serialize addon preserves mode state (e.g.
      // ?1004h for focus reporting), which causes xterm.js to send escape
      // sequences to the new shell before it's ready, producing garbled output.
      terminal.write('\x1b[?1004l'); // Disable focus reporting
      terminal.write('\x1b[?2004l'); // Disable bracketed paste (shell manages its own)

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
      processOutput(tabId, data);
      // Ignore tiny writes (spinner frames, cursor blinks, status-line redraws)
      // that TUI apps like Claude Code emit periodically while idle.
      if (!visible && trackActivity && data.length > 64 && Date.now() > visibilityGraceUntil) {
        activityStore.markActive(tabId);
      }
    });

    // Listen for PTY close — when the shell exits (exit/logout/Ctrl+D),
    // close the tab using the same logic as Cmd+W.
    unlistenClose = await listen(`pty-close-${ptyId}`, () => {
      if (terminalsStore.shuttingDown) return;

      const ws = workspacesStore.workspaces.find(w => w.id === workspaceId);
      const pane = ws?.panes.find(p => p.id === paneId);
      if (!ws || !pane) return;

      if (pane.tabs.length > 1) {
        workspacesStore.deleteTab(workspaceId, paneId, tabId).catch(() => {});
      } else if (ws.panes.length > 1) {
        workspacesStore.deletePane(workspaceId, paneId).catch(() => {});
      } else {
        // Last tab in last pane — delete tab, pane shows empty state
        workspacesStore.deleteTab(workspaceId, paneId, tabId).catch(() => {});
      }
    });

    // Check for split context (cwd, SSH command from source pane)
    // Fall back to auto-resume context, then persisted restore context from last session.
    // Auto-resume context always wins over restore context (survives SSH disconnects).
    const splitCtx = terminalsStore.consumeSplitContext(tabId);
    const autoResumeCtx = (autoResumeSshCommand || autoResumeCwd)
      ? { cwd: autoResumeCwd ?? restoreCwd ?? null, sshCommand: autoResumeSshCommand ? cleanSshCommand(autoResumeSshCommand) : null, remoteCwd: autoResumeRemoteCwd ?? null }
      : null;
    const restoreCtx = (restoreCwd || restoreSshCommand)
      ? { cwd: restoreCwd ?? null, sshCommand: restoreSshCommand ? cleanSshCommand(restoreSshCommand) : null, remoteCwd: restoreRemoteCwd ?? null }
      : null;
    const ctx = splitCtx ?? autoResumeCtx ?? restoreCtx;

    // Spawn PTY with tab-specific history, optionally inheriting cwd
    try {
      await spawnTerminal(ptyId, tabId, cols, rows, ctx?.cwd);
    } catch (e) {
      logError(`Failed to spawn PTY: ${e}`);
    }
    await workspacesStore.setTabPtyId(workspaceId, paneId, tabId, ptyId);

    // If the source pane was running SSH (or last session had SSH), replay the command.
    // The auto-resume command (if any) is sent immediately after — the TTY buffers it
    // until SSH connects and the remote shell reads from forwarded stdin.
    if (ctx?.sshCommand) {
      // Small delay to let the local shell prompt initialize before sending
      setTimeout(async () => {
        try {
          const cmd = buildSshCommand(ctx.sshCommand, ctx.remoteCwd);
          let payload = cmd + '\n';
          if (autoResumeCommand) {
            payload += interpolateVariables(tabId, autoResumeCommand, true) + '\n';
          }
          const bytes = Array.from(new TextEncoder().encode(payload));
          await writeTerminal(ptyId, bytes);
        } catch (e) {
          logError(`Failed to replay SSH command: ${e}`);
        }
      }, 500);
    } else if (autoResumeCommand && (!splitCtx || splitCtx.fireAutoResume)) {
      // Local auto-resume: send command after shell starts (also fires on reload)
      setTimeout(async () => {
        try {
          const bytes = Array.from(new TextEncoder().encode(interpolateVariables(tabId, autoResumeCommand, true) + '\n'));
          await writeTerminal(ptyId, bytes);
        } catch (e) {
          logError(`Failed to replay auto-resume command: ${e}`);
        }
      }, 500);
    }

    // Load persisted trigger variables into runtime map
    if (triggerVariables) loadTabVariables(tabId, triggerVariables);

    // Register terminal instance with serialize addon for scrollback saving
    terminalsStore.register(tabId, terminal, ptyId, serializeAddon, searchAddon, workspaceId, paneId);

    // Cmd+C: copy if selection, SIGINT if not. Cmd+V: paste into PTY.
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;

      if (isModKey(e) && e.key === 'c') {
        e.preventDefault();
        if (terminal.hasSelection()) {
          clipboardWriteText(terminal.getSelection()).catch(e => logError(String(e)));
          terminal.clearSelection();
        } else {
          writeTerminal(ptyId, [0x03]).catch(e => logError(String(e)));
        }
        return false;
      }

      if (isModKey(e) && e.key === 'v') {
        e.preventDefault();
        pasteFromClipboard().catch(e => logError(String(e)));
        return false;
      }

      if (isModKey(e) && e.key === 'r') {
        e.preventDefault();
        if (isAutoResume) {
          workspacesStore.setTabAutoResumeContext(workspaceId, paneId, tabId, null, null, null, null);
          isAutoResume = false;
        } else {
          gatherAutoResumeContext().then(ctx => {
            autoResumePromptValue = autoResumeRememberedCommand ?? '';
            autoResumePrompt = ctx;
          }).catch(e => logError(`Auto-resume failed: ${e}`));
        }
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

    // Handle resize — fit immediately for visual update,
    // debounce PTY resize to avoid rapid-fire SIGWINCH during window drag.
    resizeObserver = new ResizeObserver(() => {
      if (!visible || !containerRef?.isConnected) return;
      fitWithPadding();
      clearTimeout(resizePtyTimeout);
      resizePtyTimeout = setTimeout(() => {
        const { cols, rows } = terminal;
        resizeTerminal(ptyId, cols, rows).catch(e => logError(String(e)));
      }, 150);
    });
    resizeObserver.observe(containerRef);

    // Drag & drop file support: listen for Tauri window-level drag events
    unlistenDragOver = await listen<{ position: { x: number; y: number } }>('tauri://drag-over', (event) => {
      if (!visible || !containerRef?.isConnected) { isDragOver = false; return; }
      const { position } = event.payload;
      const rect = containerRef.getBoundingClientRect();
      isDragOver = (
        position.x >= rect.left && position.x <= rect.right &&
        position.y >= rect.top && position.y <= rect.bottom
      );
    });

    unlistenDragDrop = await listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
      isDragOver = false;
      if (!visible || !containerRef?.isConnected) return;
      const { paths, position } = event.payload;
      const rect = containerRef.getBoundingClientRect();
      if (
        position.x >= rect.left && position.x <= rect.right &&
        position.y >= rect.top && position.y <= rect.bottom
      ) {
        const escaped = paths.map(escapePathForTerminal).join(' ');
        const bytes = Array.from(new TextEncoder().encode(escaped));
        writeTerminal(ptyId, bytes).catch(e => logError(String(e)));
        terminal.focus();
      }
    });

    unlistenDragLeave = await listen('tauri://drag-leave', () => {
      isDragOver = false;
    });

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
    if (unlistenDragOver) unlistenDragOver();
    if (unlistenDragDrop) unlistenDragDrop();
    if (unlistenDragLeave) unlistenDragLeave();
    clearTimeout(resizePtyTimeout);
    if (resizeObserver) resizeObserver.disconnect();
    if (terminal) terminal.dispose();
    if (ptyId) {
      killTerminal(ptyId).catch(e => logError(String(e)));
    }
    terminalsStore.unregister(tabId);
    cleanupTab(tabId);
  });

  // Suppress false activity when terminal transitions to hidden —
  // residual output (SSH restore, prompt redraws) can arrive briefly after switch.
  $effect(() => {
    if (!visible && initialized) {
      visibilityGraceUntil = Date.now() + 1000;
      // Explicitly blur so hidden terminals don't retain keyboard focus.
      // Without this, keyboard shortcuts (Cmd+R, etc.) can fire on the wrong tab.
      terminal?.blur();
    }
  });

  $effect(() => {
    if (visible && initialized && fitAddon) {
      // Delay fit to ensure container is visible
      requestAnimationFrame(() => {
        fitWithPadding();
        if (!autoResumePrompt) terminal.focus();
      });
      untrack(() => {
        activityStore.clearActive(tabId);
        activityStore.clearShellState(tabId);
        activityStore.clearTabState(tabId);
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
        // Skip when alternate screen is active (nano, vim, less, etc.)
        if (terminal.buffer.active.type === 'alternate') return;
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

            const oscState = terminalsStore.getOsc(tabId);
            const osc7Cwd = oscState?.cwd ?? null;
            const promptCwd = oscState?.promptCwd ?? null;
            if (sshCommand) {
              const isOsc7Stale = osc7Cwd === cwd;
              const osc7RemoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : null;
              remoteCwd = osc7RemoteCwd ?? promptCwd ?? null;
              if (!remoteCwd) {
                // Last resort: scan buffer for prompt pattern
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

  async function gatherAutoResumeContext(): Promise<{ cwd: string | null; sshCmd: string | null; remoteCwd: string | null }> {
    const info = await getPtyInfo(ptyId);
    const sshCmd = info.foreground_command ? cleanSshCommand(info.foreground_command) : null;
    const localCwd = info.cwd ?? null;
    let remoteCwd: string | null = null;
    if (sshCmd) {
      const oscState = terminalsStore.getOsc(tabId);
      const osc7Cwd = oscState?.cwd ?? null;
      const promptCwd = oscState?.promptCwd ?? null;
      const isOsc7Stale = osc7Cwd === localCwd;
      remoteCwd = (osc7Cwd && !isOsc7Stale) ? osc7Cwd : promptCwd ?? null;
      if (!remoteCwd) {
        // Last resort: scan buffer for prompt pattern
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
    }
    return { cwd: localCwd, sshCmd, remoteCwd };
  }

  async function submitAutoResumePrompt() {
    if (!autoResumePrompt) return;
    const cmd = autoResumePromptValue.trim() || null;
    await workspacesStore.setTabAutoResumeContext(workspaceId, paneId, tabId, autoResumePrompt.cwd, autoResumePrompt.sshCmd, autoResumePrompt.remoteCwd, cmd);
    isAutoResume = true;
    autoResumePrompt = null;
    autoResumePromptValue = '';
    terminal?.focus();
  }

  function cancelAutoResumePrompt() {
    autoResumePrompt = null;
    autoResumePromptValue = '';
    terminal?.focus();
  }

  // When auto-resume prompt opens: blur xterm so it stops competing, then focus the input
  $effect(() => {
    if (autoResumePrompt) {
      terminal?.blur();
      requestAnimationFrame(() => {
        autoResumeTextarea?.focus();
      });
    }
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
        shortcut: `${modSymbol}C`,
        disabled: !hasSelection,
        action: async () => {
          const text = terminal.getSelection();
          if (text) await clipboardWriteText(text);
        },
      },
      {
        label: 'Paste',
        shortcut: `${modSymbol}V`,
        action: () => pasteFromClipboard(),
      },
      {
        label: 'Select All',
        shortcut: `${modSymbol}A`,
        action: () => {
          terminal.selectAll();
        },
      },
      { label: '', separator: true, action: () => {} },
      {
        label: 'Clear',
        shortcut: `${modSymbol}K`,
        action: () => {
          terminalsStore.clearTerminal(tabId);
        },
      },
      ...(getVariables(tabId)?.size ? [
        {
          label: 'Clear Trigger Variables',
          action: () => { clearTabVariables(tabId); },
        },
      ] : []),
      { label: '', separator: true, action: () => {} },
      ...(isAutoResume ? [{
        label: 'Disable Auto-resume',
        action: async () => {
          await workspacesStore.setTabAutoResumeContext(workspaceId, paneId, tabId, null, null, null, null);
          isAutoResume = false;
        },
      }] : [
        {
          label: 'Auto-resume',
          action: async () => {
            try {
              const ctx = await gatherAutoResumeContext();
              await workspacesStore.setTabAutoResumeContext(workspaceId, paneId, tabId, ctx.cwd, ctx.sshCmd, ctx.remoteCwd, null);
              isAutoResume = true;
            } catch (e) {
              logError(`Auto-resume failed: ${e}`);
            }
          },
        },
        {
          label: 'Auto-resume + Command\u2026',
          action: async () => {
            try {
              const ctx = await gatherAutoResumeContext();
              autoResumePromptValue = autoResumeRememberedCommand ?? '';
              autoResumePrompt = ctx;
            } catch (e) {
              logError(`Auto-resume failed: ${e}`);
            }
          },
        },
        {
          label: 'Auto-resume + Claude\u2026',
          action: () => { claudeSetupModal = true; },
        },
      ]),
      ...(preferencesStore.shellTitleIntegration || preferencesStore.shellIntegration ? [
        { label: '', separator: true, action: () => {} },
        {
          label: 'Setup Shell Integration',
          action: async () => {
            const snippet = buildShellIntegrationSnippet({
              shellTitle: preferencesStore.shellTitleIntegration,
              shellIntegration: preferencesStore.shellIntegration,
            });
            if (snippet) {
              const bytes = Array.from(new TextEncoder().encode(snippet + '\n'));
              await writeTerminal(ptyId, bytes);
            }
          },
        },
        {
          label: 'Install Shell Integration',
          action: async () => {
            const snippet = buildInstallSnippet();
            const bytes = Array.from(new TextEncoder().encode(snippet + '\n'));
            await writeTerminal(ptyId, bytes);
          },
        },
      ] : []),
    ];
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-container"
  class:hidden={!visible}
  bind:this={containerRef}
  oncontextmenu={handleContextMenu}
>
  {#if isDragOver}
    <div class="drop-overlay">
      <span>Drop to paste path</span>
    </div>
  {/if}
  {#if contextMenu}
    <ContextMenu
      items={getContextMenuItems()}
      x={contextMenu.x}
      y={contextMenu.y}
      onclose={() => { contextMenu = null; terminal?.focus(); }}
    />
  {/if}
  {#if autoResumePrompt}
    <div class="auto-resume-prompt-backdrop">
    <div class="auto-resume-prompt">
      <label class="auto-resume-prompt-label">Command to run after {autoResumePrompt.sshCmd ? 'connect' : 'start'}</label>
      <ResizableTextarea
        bind:this={autoResumeTextarea}
        value={autoResumePromptValue}
        placeholder="e.g. claude --continue"
        autofocus
        onchange={(v) => { autoResumePromptValue = v; }}
        onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitAutoResumePrompt(); if (e.key === 'Escape') cancelAutoResumePrompt(); }}
      />
      <div class="auto-resume-prompt-hint">{autoResumePrompt.sshCmd ? 'Leave empty for SSH + cwd only' : 'Leave empty for cwd only'} &middot; Each line sent as a separate command &middot; {modSymbol}Enter to save</div>
      <div class="auto-resume-prompt-actions">
        <div class="auto-resume-presets">
          <span class="auto-resume-presets-label">Presets</span>
          <button class="auto-resume-prompt-btn preset" onclick={() => {
            autoResumePromptValue = CLAUDE_RESUME_COMMAND;
          }} title="Uses trigger variables %claudeSessionId and %claudeResumeCommand">Claude Resume</button>
        </div>
        <span style="flex: 1;"></span>
        <button class="auto-resume-prompt-btn cancel" onclick={cancelAutoResumePrompt}>Cancel</button>
        <button class="auto-resume-prompt-btn confirm" onclick={submitAutoResumePrompt}>Save</button>
      </div>
    </div>
  </div>
  {/if}
  {#if claudeSetupModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="claude-setup-backdrop" onclick={() => { claudeSetupModal = false; }} onkeydown={(e) => { if (e.key === 'Escape') claudeSetupModal = false; }}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="claude-setup-modal" onclick={(e) => e.stopPropagation()}>
        <h3 class="claude-setup-title">Auto-resume + Claude</h3>
        <div class="claude-setup-body">
          <p>Automatically resume your Claude Code session when the terminal restarts.</p>
          <h4>This will:</h4>
          <ul>
            <li>Enable the <strong>Claude Resume</strong> trigger &mdash; captures the <code>claude --resume</code> command when Claude exits</li>
            <li>Enable the <strong>Claude Session ID</strong> trigger &mdash; captures the session UUID from <code>/status</code></li>
            <li>Set an <strong>auto-resume command</strong> on this tab &mdash; resumes by session ID, falls back to the resume command, or starts <code>claude --continue</code></li>
          </ul>
          <h4>How it works:</h4>
          <ol>
            <li>Run Claude Code in this tab as usual</li>
            <li>When Claude exits or you run <code>/status</code>, the triggers capture the session ID</li>
            <li>If the terminal restarts (app relaunch, SSH reconnect), the auto-resume script uses the captured ID to reconnect to the same session</li>
          </ol>
          <p class="claude-setup-note">Triggers are global (configurable in Preferences &gt; Triggers) &mdash; they'll capture Claude session info in any tab. The auto-resume command is specific to this tab.</p>
        </div>
        <div class="claude-setup-actions">
          <button class="claude-setup-btn cancel" onclick={() => { claudeSetupModal = false; }}>Cancel</button>
          <button class="claude-setup-btn activate" onclick={async () => {
            try {
              const triggers = preferencesStore.triggers;
              const needsUpdate = triggers.some(t =>
                (t.default_id === 'claude-resume' || t.default_id === 'claude-session-id') && !t.enabled
              );
              if (needsUpdate) {
                preferencesStore.setTriggers(triggers.map(t =>
                  (t.default_id === 'claude-resume' || t.default_id === 'claude-session-id')
                    ? { ...t, enabled: true }
                    : t
                ));
              }
              const ctx = await gatherAutoResumeContext();
              await workspacesStore.setTabAutoResumeContext(workspaceId, paneId, tabId, ctx.cwd, ctx.sshCmd, ctx.remoteCwd, CLAUDE_RESUME_COMMAND);
              isAutoResume = true;
            } catch (e) {
              logError(`Auto-resume + Claude setup failed: ${e}`);
            }
            claudeSetupModal = false;
          }}>Activate</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .terminal-container {
    position: relative;
    flex: 1;
    padding: 4px;
    background: var(--bg-dark);
    overflow: hidden;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(122, 162, 247, 0.08);
    border: 2px dashed var(--accent);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 10;
  }

  .drop-overlay span {
    background: var(--bg-medium);
    padding: 8px 16px;
    border-radius: 6px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
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

  .auto-resume-prompt-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    pointer-events: auto;
  }

  .auto-resume-prompt {
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    padding: 16px;
    min-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .auto-resume-prompt-label {
    color: var(--fg);
    font-size: 13px;
    font-weight: 500;
  }

  .auto-resume-prompt-hint {
    color: var(--fg-dim);
    font-size: 11px;
  }

  .auto-resume-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .auto-resume-prompt-btn {
    padding: 6px 14px;
    border-radius: 4px;
    border: none;
    font-size: 12px;
    cursor: pointer;
  }

  .auto-resume-prompt-btn.cancel {
    background: var(--bg-light);
    color: var(--fg);
  }

  .auto-resume-prompt-btn.cancel:hover {
    background: #525a80;
  }

  .auto-resume-prompt-btn.confirm {
    background: var(--accent);
    color: var(--bg-dark);
    font-weight: 500;
  }

  .auto-resume-prompt-btn.confirm:hover {
    opacity: 0.9;
  }

  .auto-resume-presets {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .auto-resume-presets-label {
    font-size: 11px;
    color: var(--fg-dim);
  }

  .auto-resume-prompt-btn.preset {
    background: var(--bg-dark);
    color: var(--fg-dim);
    border: 1px solid var(--bg-light);
  }

  .auto-resume-prompt-btn.preset:hover {
    color: var(--fg);
    border-color: var(--accent);
  }

  .claude-setup-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .claude-setup-modal {
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    padding: 20px 24px;
    max-width: 480px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
  }

  .claude-setup-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    margin: 0 0 12px 0;
  }

  .claude-setup-body {
    font-size: 13px;
    color: var(--fg);
    line-height: 1.5;
  }

  .claude-setup-body p {
    margin: 0 0 10px 0;
  }

  .claude-setup-body h4 {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 14px 0 6px 0;
  }

  .claude-setup-body ul,
  .claude-setup-body ol {
    margin: 0 0 10px 0;
    padding-left: 20px;
  }

  .claude-setup-body li {
    margin-bottom: 4px;
  }

  .claude-setup-body code {
    background: var(--bg-dark);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
    font-family: 'Menlo', Monaco, monospace;
  }

  .claude-setup-note {
    font-size: 12px;
    color: var(--fg-dim);
    font-style: italic;
  }

  .claude-setup-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .claude-setup-btn {
    padding: 6px 18px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .claude-setup-btn.cancel {
    background: var(--bg-light);
    color: var(--fg);
  }

  .claude-setup-btn.cancel:hover {
    background: #525a80;
  }

  .claude-setup-btn.activate {
    background: var(--accent);
    color: var(--bg-dark);
  }

  .claude-setup-btn.activate:hover {
    opacity: 0.9;
  }
</style>
