<script lang="ts">
  import { onMount } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import WorkspaceSidebar from '$lib/components/workspace/WorkspaceSidebar.svelte';
  import TerminalWindow from '$lib/components/window/TerminalWindow.svelte';
  import LayoutSelector from '$lib/components/LayoutSelector.svelte';
  import Resizer from '$lib/components/Resizer.svelte';
  import type { Layout } from '$lib/tauri/types';
  import * as commands from '$lib/tauri/commands';

  let loading = $state(true);
  let windowSizes = $state<Record<string, number>>({});
  let mainContentEl = $state<HTMLElement | null>(null);

  // Get current layout's window sizes
  const currentSizes = $derived.by(() => {
    const ws = workspacesStore.activeWorkspace;
    if (!ws) return {};
    const layout = workspacesStore.layout;
    return ws.window_sizes?.[layout] || {};
  });

  // Get flex value for a window
  function getWindowFlex(windowId: string): number {
    return windowSizes[windowId] ?? currentSizes[windowId] ?? 1;
  }

  onMount(async () => {
    await workspacesStore.load();
    loading = false;
  });

  function handleLayoutChange(newLayout: Layout) {
    // Save current sizes before switching
    saveWindowSizes();
    workspacesStore.setLayout(newLayout);
    // Reset local sizes to load from new layout
    windowSizes = {};
  }

  function handleSidebarResize(delta: number) {
    workspacesStore.setSidebarWidth(workspacesStore.sidebarWidth + delta);
  }

  function handleSidebarResizeEnd() {
    workspacesStore.saveSidebarWidth();
  }

  function handleWindowResize(windowId: string, nextWindowId: string, delta: number) {
    const layout = workspacesStore.layout;
    const isHorizontal = layout === 'horizontal' || layout === 'grid';

    // Get container size
    if (!mainContentEl) return;
    const containerSize = isHorizontal ? mainContentEl.clientWidth : mainContentEl.clientHeight;

    // Convert delta to flex ratio change
    const deltaRatio = delta / containerSize * 2;

    const currentFlex = getWindowFlex(windowId);
    const nextFlex = getWindowFlex(nextWindowId);

    // Update sizes
    windowSizes = {
      ...windowSizes,
      [windowId]: Math.max(0.2, currentFlex + deltaRatio),
      [nextWindowId]: Math.max(0.2, nextFlex - deltaRatio),
    };
  }

  function saveWindowSizes() {
    const ws = workspacesStore.activeWorkspace;
    if (!ws || Object.keys(windowSizes).length === 0) return;

    // Merge with existing sizes
    const merged = { ...currentSizes, ...windowSizes };
    commands.setWindowSizes(ws.id, workspacesStore.layout, merged);
  }
</script>

<div class="app">
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-spacer"></div>
    <span class="titlebar-title">aiTerm</span>
    <div class="titlebar-controls">
      <LayoutSelector layout={workspacesStore.layout} onchange={handleLayoutChange} />
    </div>
  </div>

  <div class="app-body">
    {#if loading}
      <div class="loading">
        <span>Loading...</span>
      </div>
    {:else}
      <WorkspaceSidebar width={workspacesStore.sidebarWidth} />
      <Resizer direction="horizontal" onresize={handleSidebarResize} onresizeend={handleSidebarResizeEnd} />

      <main class="main-content layout-{workspacesStore.layout}" bind:this={mainContentEl}>
        {#if workspacesStore.activeWorkspace}
          {#each workspacesStore.activeWorkspace.windows as window, index (window.id)}
            <TerminalWindow
              workspaceId={workspacesStore.activeWorkspace.id}
              {window}
              isActive={window.id === workspacesStore.activeWorkspace.active_window_id}
              flex={getWindowFlex(window.id)}
            />
            {#if index < workspacesStore.activeWorkspace.windows.length - 1}
              {@const nextWindow = workspacesStore.activeWorkspace.windows[index + 1]}
              <Resizer
                direction={workspacesStore.layout === 'vertical' ? 'vertical' : 'horizontal'}
                onresize={(delta) => handleWindowResize(window.id, nextWindow.id, delta)}
                onresizeend={saveWindowSizes}
              />
            {/if}
          {/each}
        {:else}
          <div class="empty-state">
            <p>No workspace selected</p>
            <p>Press <kbd>Cmd+N</kbd> to create a new workspace</p>
          </div>
        {/if}
      </main>
    {/if}
  </div>
</div>

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .titlebar {
    position: relative;
    height: 38px;
    min-height: 38px;
    background: var(--bg-medium);
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid var(--bg-light);
    -webkit-app-region: drag;
  }

  .titlebar-spacer {
    width: 78px; /* Space for traffic lights */
  }

  .titlebar-title {
    flex: 1;
    text-align: center;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
  }

  .titlebar-controls {
    position: absolute;
    right: 12px;
    -webkit-app-region: no-drag;
  }

  .app-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-dim);
  }

  .main-content {
    flex: 1;
    display: flex;
    min-width: 0;
    background: var(--bg-dark);
  }

  .main-content.layout-horizontal {
    flex-direction: row;
  }

  .main-content.layout-vertical {
    flex-direction: column;
  }

  .main-content.layout-grid {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .main-content.layout-grid > :global(.terminal-window) {
    flex: 1 1 calc(50% - 1px);
    min-width: 300px;
    max-width: calc(50%);
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--fg-dim);
  }

  .empty-state kbd {
    padding: 2px 6px;
    background: var(--bg-medium);
    border-radius: 4px;
    font-family: inherit;
  }
</style>
