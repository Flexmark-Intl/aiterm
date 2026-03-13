/**
 * SSH MCP Bridge — manages reverse SSH tunnels to expose local MCP tools
 * to Claude Code instances running on remote servers.
 *
 * Flow:
 * 1. TerminalPane detects SSH session (via getPtyInfo foreground_command)
 * 2. enableBridge() called → spawns reverse tunnel → writes lockfile via background SSH
 * 3. Claude Code on remote discovers lockfile → connects through tunnel → local MCP
 * 4. On tab close → disableBridge() → decrements ref count → kills tunnel if last
 */

import * as commands from '$lib/tauri/commands';
import { preferencesStore } from '$lib/stores/preferences.svelte';
import { dispatch } from '$lib/stores/notificationDispatch';
import { error as logError, info as logInfo } from '@tauri-apps/plugin-log';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

export type BridgeStatus = 'connected' | 'failed';

interface BridgeState {
  hostKey: string;
  remotePort: number;
  status: BridgeStatus;
  error?: string;
}

/** Reactive map of tabId → bridge state. Svelte 5 $state for reactivity in TerminalTabs. */
let bridgeStates = $state<Map<string, BridgeState>>(new Map());

/** Per-tab event listeners for tunnel-down events from Rust. */
const tunnelListeners = new Map<string, UnlistenFn>();

/**
 * Remove bridge state for a tab (internal — no backend call).
 * Used when Rust notifies us the tunnel died.
 */
function clearBridgeState(tabId: string): void {
  if (!bridgeStates.has(tabId)) return;
  bridgeStates.delete(tabId);
  bridgeStates = new Map(bridgeStates);
  logInfo(`SSH MCP bridge cleared for tab ${tabId} (tunnel down)`);
}

/**
 * Start listening for tunnel-down events from Rust for this tab.
 */
async function listenForTunnelDown(tabId: string): Promise<void> {
  // Already listening?
  if (tunnelListeners.has(tabId)) return;
  const unlisten = await listen(`ssh-tunnel-down-${tabId}`, () => {
    logInfo(`Received ssh-tunnel-down for tab ${tabId}`);
    clearBridgeState(tabId);
    cleanupListener(tabId);
  });
  tunnelListeners.set(tabId, unlisten);
}

function cleanupListener(tabId: string): void {
  const unlisten = tunnelListeners.get(tabId);
  if (unlisten) {
    unlisten();
    tunnelListeners.delete(tabId);
  }
}

/**
 * Extract host_key (user@host with non-standard flags) from a cleaned SSH command.
 * Input is already cleaned by cleanSshCommand() — e.g. "user@host" or "-p 2222 user@host"
 */
function extractHostKey(sshArgs: string): string {
  return sshArgs.trim();
}

/**
 * Build a shell script for background SSH execution.
 * This runs as a non-interactive command, not through the user's PTY.
 */
function buildSetupScript(remotePort: number, authToken: string): string {
  const lockContent = JSON.stringify({
    pid: 0,  // Background SSH — no persistent PID on remote
    transport: 'ws',
    authToken,
    serverPort: remotePort,
    ideName: 'aiTerm',
    ideVersion: '1.0',
    workspaceFolders: [],
  });

  // Escape single quotes for shell
  const escapedLockContent = lockContent.replace(/'/g, "'\\''");

  // MCP entry for ~/.claude.json registration
  const mcpEntry = JSON.stringify({
    type: 'sse',
    url: `http://127.0.0.1:${remotePort}/sse`,
    headers: { 'x-claude-code-ide-authorization': authToken },
  });
  // Escape for single-quoted shell string
  const escapedMcpEntry = mcpEntry.replace(/'/g, "'\\''");

  // Build script with newline separators (semicolons after `do`/`then`/`else` are syntax errors).
  // All JSON data is passed via shell variables to avoid quoting issues with python/jq.
  const script = [
    // Store JSON in shell variables to avoid nested quote hell
    `__lock='${escapedLockContent}'`,
    `__mcp='${escapedMcpEntry}'`,
    // Stale lockfile cleanup
    'for __f in ~/.claude/ide/*.lock; do',
    '[ -f "$__f" ] || continue',
    'grep -q aiTerm "$__f" 2>/dev/null || continue',
    '__p=$(grep -o \'"serverPort":[0-9]*\' "$__f" 2>/dev/null | grep -o \'[0-9]*\')',
    '[ -n "$__p" ] && ! (echo >/dev/tcp/localhost/$__p) 2>/dev/null && rm -f "$__f"',
    'done',
    // Write lockfile
    'mkdir -p ~/.claude/ide',
    `printf '%s' "$__lock" > ~/.claude/ide/${remotePort}.lock`,
    // Register in ~/.claude.json — pipe JSON via stdin to avoid quoting issues
    'if command -v python3 >/dev/null 2>&1; then',
    'printf \'%s\' "$__mcp" | python3 -c \'import json,sys,os; e=json.load(sys.stdin); p=os.path.expanduser("~/.claude.json"); d=json.load(open(p)) if os.path.exists(p) else {}; d.setdefault("mcpServers",{})["aiterm"]=e; open(p,"w").write(json.dumps(d,indent=2))\'',
    'elif command -v jq >/dev/null 2>&1; then',
    '[ -f ~/.claude.json ] || echo \'{}\' > ~/.claude.json',
    'jq --argjson entry "$__mcp" \'.mcpServers.aiterm = $entry\' ~/.claude.json > ~/.claude.json.tmp && mv ~/.claude.json.tmp ~/.claude.json',
    'else',
    '[ -f ~/.claude.json ] || echo \'{}\' > ~/.claude.json',
    'fi',
  ];

  return script.join('\n');
}

/**
 * Enable the MCP bridge for an SSH tab.
 * Spawns (or reuses) a reverse tunnel and writes the lockfile via background SSH.
 */
export async function enableBridge(tabId: string, sshArgs: string): Promise<boolean> {
  if (!preferencesStore.claudeCodeIde || !preferencesStore.claudeCodeIdeSsh) {
    return false;
  }

  // Already bridged?
  if (bridgeStates.has(tabId)) return bridgeStates.get(tabId)!.status === 'connected';

  const localPort = await commands.getMcpPort();
  const authToken = await commands.getMcpAuth();
  if (!localPort || !authToken) {
    logError('Cannot enable SSH MCP bridge: MCP server not running');
    return false;
  }

  const hostKey = extractHostKey(sshArgs);

  try {
    // Start or join existing tunnel
    const tunnelInfo = await commands.startSshTunnel(sshArgs, hostKey, tabId, localPort);
    logInfo(`SSH MCP bridge: tunnel to ${hostKey} on remote port ${tunnelInfo.remote_port}`);

    // Write lockfile on remote via a separate background SSH connection
    const setupScript = buildSetupScript(tunnelInfo.remote_port, authToken);
    await commands.sshRunSetup(sshArgs, setupScript);

    bridgeStates = new Map(bridgeStates.set(tabId, {
      hostKey,
      remotePort: tunnelInfo.remote_port,
      status: 'connected',
    }));

    // Listen for tunnel process death from Rust — clears indicator in real-time
    listenForTunnelDown(tabId).catch(() => {});

    logInfo(`SSH MCP bridge enabled for tab ${tabId} → ${hostKey}:${tunnelInfo.remote_port}`);
    return true;
  } catch (e) {
    const errMsg = String(e);
    logError(`SSH MCP bridge failed for ${hostKey}: ${errMsg}`);

    bridgeStates = new Map(bridgeStates.set(tabId, {
      hostKey,
      remotePort: 0,
      status: 'failed',
      error: errMsg,
    }));

    dispatch('MCP Bridge Failed', `Could not connect to ${hostKey}: ${errMsg}`, 'error', { tabId });
    return false;
  }
}

/**
 * Disable the MCP bridge for a tab (called on tab close or SSH disconnect).
 */
export async function disableBridge(tabId: string): Promise<void> {
  const bridge = bridgeStates.get(tabId);
  if (!bridge) return;

  cleanupListener(tabId);
  bridgeStates.delete(tabId);
  bridgeStates = new Map(bridgeStates);

  try {
    await commands.detachSshTunnel(bridge.hostKey, tabId);
  } catch (e) {
    logError(`Failed to detach SSH tunnel: ${e}`);
  }
}

/**
 * Check if a tab has an active MCP bridge.
 */
export function hasBridge(tabId: string): boolean {
  return bridgeStates.has(tabId);
}

/**
 * Get bridge status for a tab (reactive).
 */
export function getBridgeStatus(tabId: string): BridgeStatus | undefined {
  return bridgeStates.get(tabId)?.status;
}

/**
 * Get bridge info for a tab.
 */
export function getBridgeInfo(tabId: string): BridgeState | undefined {
  return bridgeStates.get(tabId);
}
