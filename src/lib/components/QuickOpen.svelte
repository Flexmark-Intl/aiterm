<script lang="ts">
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { getPtyInfo, listFiles, sshListFiles } from '$lib/tauri/commands';
  import { error as logError } from '@tauri-apps/plugin-log';

  interface Props {
    open: boolean;
    onclose: () => void;
    onselect: (filePath: string) => void;
  }

  let { open, onclose, onselect }: Props = $props();

  let query = $state('');
  let files = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selectedIndex = $state(0);
  let capped = $state(false);
  let basePath = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);
  let listRef = $state<HTMLDivElement | null>(null);

  const MAX_FILES = 10_000;
  const MAX_RESULTS = 100;

  function fuzzyMatch(q: string, path: string): number | null {
    const lq = q.toLowerCase();
    const lp = path.toLowerCase();
    let qi = 0;
    let score = 0;
    let lastMatch = -1;

    for (let pi = 0; pi < lp.length && qi < lq.length; pi++) {
      if (lp[pi] === lq[qi]) {
        score += (pi === lastMatch + 1) ? 10 : 1; // consecutive bonus
        if (pi === 0 || lp[pi - 1] === '/') score += 5; // path segment start
        lastMatch = pi;
        qi++;
      }
    }

    if (qi < lq.length) return null; // not all chars matched
    score -= path.length * 0.01; // prefer shorter paths
    return score;
  }

  /** Convert a glob pattern (with * and ?) into a RegExp. */
  function globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')   // preserve ** before replacing *
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')
      .replace(/\?/g, '[^/]');
    return new RegExp(escaped, 'i');
  }

  const isGlob = $derived(query.includes('*') || query.includes('?'));

  const filtered = $derived.by(() => {
    const q = query.trim();
    if (!q) {
      return files.slice(0, MAX_RESULTS);
    }

    if (isGlob) {
      const re = globToRegex(q);
      const matched: string[] = [];
      for (const f of files) {
        if (matched.length >= MAX_RESULTS) break;
        if (re.test(f)) matched.push(f);
      }
      return matched;
    }

    const scored: { path: string; score: number }[] = [];
    for (const f of files) {
      const score = fuzzyMatch(q, f);
      if (score !== null) scored.push({ path: f, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RESULTS).map(s => s.path);
  });

  // Find a terminal tab for CWD context — prefer active tab, then search pane
  function findTerminalContext(): { tabId: string; ptyId: string } | null {
    const activeTab = workspacesStore.activeTab;
    if (activeTab?.tab_type === 'terminal') {
      const inst = terminalsStore.get(activeTab.id);
      if (inst) return { tabId: activeTab.id, ptyId: inst.ptyId };
    }
    // Fall back to first terminal tab in the active pane
    const pane = workspacesStore.activePane;
    if (pane) {
      for (const tab of pane.tabs) {
        if (tab.tab_type === 'terminal') {
          const inst = terminalsStore.get(tab.id);
          if (inst) return { tabId: tab.id, ptyId: inst.ptyId };
        }
      }
    }
    return null;
  }

  async function loadFiles() {
    const ctx = findTerminalContext();
    if (!ctx) {
      error = 'No terminal context available';
      return;
    }

    loading = true;
    error = null;
    files = [];
    capped = false;

    try {
      const ptyInfo = await getPtyInfo(ctx.ptyId);
      const sshCommand = ptyInfo.foreground_command;
      const isRemote = !!sshCommand;

      let result: string[];

      if (isRemote) {
        const oscState = terminalsStore.getOsc(ctx.tabId);
        const remoteCwd = oscState?.cwd ?? oscState?.promptCwd;
        if (!remoteCwd) {
          error = 'Cannot determine remote working directory';
          loading = false;
          return;
        }
        basePath = remoteCwd;
        result = await sshListFiles(sshCommand!, remoteCwd, 5000);
      } else {
        const localCwd = ptyInfo.cwd;
        if (!localCwd) {
          error = 'Cannot determine working directory';
          loading = false;
          return;
        }
        basePath = localCwd;
        result = await listFiles(localCwd, MAX_FILES);
      }

      // Check if still open (user may have closed during load)
      if (!open) return;

      files = result;
      capped = result.length >= (isRemote ? 5000 : MAX_FILES);
    } catch (e) {
      if (!open) return;
      error = String(e);
      logError(`QuickOpen: ${e}`);
    } finally {
      loading = false;
    }
  }

  // Load files when modal opens
  $effect(() => {
    if (open) {
      query = '';
      selectedIndex = 0;
      files = [];
      error = null;
      loadFiles();
      // Focus input after mount
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // Reset selection when query changes
  $effect(() => {
    // Subscribe to query
    void query;
    selectedIndex = 0;
  });

  // Scroll selected item into view
  $effect(() => {
    if (!listRef) return;
    const item = listRef.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) {
        onselect(selected);
      }
      return;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  function splitPath(filePath: string): { name: string; dir: string } {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) return { name: filePath, dir: '' };
    return {
      name: filePath.slice(lastSlash + 1),
      dir: filePath.slice(0, lastSlash),
    };
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="palette">
      <div class="input-row">
        <input
          bind:this={inputRef}
          bind:value={query}
          type="text"
          placeholder="Search files…"
          spellcheck="false"
          autocomplete="off"
        />
        {#if basePath}
          <span class="base-path" title={basePath}>{basePath}</span>
        {/if}
      </div>

      <div class="results" bind:this={listRef}>
        {#if loading}
          <div class="status">Loading files…</div>
        {:else if error}
          <div class="status error">
            {error}
            <button class="retry-btn" onclick={loadFiles}>Retry</button>
          </div>
        {:else if filtered.length === 0}
          <div class="status">
            {query ? 'No matching files' : 'No files found'}
          </div>
        {:else}
          {#each filtered as filePath, i}
            {@const { name, dir } = splitPath(filePath)}
            <button
              class="result-item"
              class:selected={i === selectedIndex}
              onclick={() => onselect(filePath)}
              onmouseenter={() => { selectedIndex = i; }}
            >
              <span class="file-name">{name}</span>
              {#if dir}
                <span class="file-dir">{dir}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      {#if !loading && !error && files.length > 0}
        <div class="footer">
          <span class="count">{files.length} files{capped ? ' (limit reached)' : ''}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    z-index: 1000;
  }

  .palette {
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    width: 520px;
    max-height: 440px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    align-self: flex-start;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--bg-light);
  }

  input {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 1rem;
    color: var(--fg);
    outline: none;
    font-family: inherit;
  }

  input:focus {
    border-color: var(--accent);
  }

  input::placeholder {
    color: var(--fg-dim);
  }

  .base-path {
    font-size: 0.769rem;
    color: var(--fg-dim);
    margin-top: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .status {
    padding: 16px 12px;
    color: var(--fg-dim);
    font-size: 0.923rem;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .status.error {
    color: var(--red, #f7768e);
  }

  .retry-btn {
    font-size: 0.846rem;
    padding: 3px 10px;
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    background: var(--bg-dark);
    color: var(--fg);
    cursor: pointer;
  }

  .retry-btn:hover {
    background: var(--bg-light);
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    width: 100%;
    border: none;
    background: none;
    color: var(--fg);
    font-size: 0.923rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--bg-light);
  }

  .file-name {
    font-weight: 600;
    flex-shrink: 0;
  }

  .file-dir {
    color: var(--fg-dim);
    font-size: 0.846rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer {
    padding: 6px 12px;
    border-top: 1px solid var(--bg-light);
  }

  .count {
    font-size: 0.769rem;
    color: var(--fg-dim);
  }
</style>
