<script lang="ts">
  import { onMount } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import WorkspaceSidebar from '$lib/components/workspace/WorkspaceSidebar.svelte';
  import SplitPane from '$lib/components/pane/SplitPane.svelte';
  import LayoutSelector from '$lib/components/LayoutSelector.svelte';
  import Resizer from '$lib/components/Resizer.svelte';
  import type { Layout } from '$lib/tauri/types';
  import * as commands from '$lib/tauri/commands';

  let loading = $state(true);
  let paneSizes = $state<Record<string, number>>({});
  let mainContentEl = $state<HTMLElement | null>(null);

  // Get current layout's pane sizes
  const currentSizes = $derived.by(() => {
    const ws = workspacesStore.activeWorkspace;
    if (!ws) return {};
    const layout = workspacesStore.layout;
    return ws.pane_sizes?.[layout] || {};
  });

  // Get flex value for a pane
  function getPaneFlex(paneId: string): number {
    return paneSizes[paneId] ?? currentSizes[paneId] ?? 1;
  }

  onMount(async () => {
    await workspacesStore.load();
    loading = false;
  });

  function handleLayoutChange(newLayout: Layout) {
    // Save current sizes before switching
    savePaneSizes();
    workspacesStore.setLayout(newLayout);
    // Reset local sizes to load from new layout
    paneSizes = {};
  }

  function handleSidebarResize(delta: number) {
    workspacesStore.setSidebarWidth(workspacesStore.sidebarWidth + delta);
  }

  function handleSidebarResizeEnd() {
    workspacesStore.saveSidebarWidth();
  }

  function handlePaneResize(paneId: string, nextPaneId: string, delta: number) {
    const layout = workspacesStore.layout;
    const isHorizontal = layout === 'horizontal' || layout === 'grid';

    // Get container size
    if (!mainContentEl) return;
    const containerSize = isHorizontal ? mainContentEl.clientWidth : mainContentEl.clientHeight;

    // Convert delta to flex ratio change
    const deltaRatio = delta / containerSize * 2;

    const currentFlex = getPaneFlex(paneId);
    const nextFlex = getPaneFlex(nextPaneId);

    // Update sizes
    paneSizes = {
      ...paneSizes,
      [paneId]: Math.max(0.2, currentFlex + deltaRatio),
      [nextPaneId]: Math.max(0.2, nextFlex - deltaRatio),
    };
  }

  function savePaneSizes() {
    const ws = workspacesStore.activeWorkspace;
    if (!ws || Object.keys(paneSizes).length === 0) return;

    // Merge with existing sizes
    const merged = { ...currentSizes, ...paneSizes };
    commands.setPaneSizes(ws.id, workspacesStore.layout, merged);
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
          {@const workspace = workspacesStore.activeWorkspace}
          {#each workspace.panes as pane, index (pane.id)}
            <SplitPane
              workspaceId={workspace.id}
              {pane}
              isActive={pane.id === workspace.active_pane_id}
              showHeader={workspace.panes.length > 1}
              flex={workspacesStore.layout === 'grid' ? 1 : getPaneFlex(pane.id)}
            />
            {#if workspacesStore.layout !== 'grid' && index < workspace.panes.length - 1}
              {@const nextPane = workspace.panes[index + 1]}
              <Resizer
                direction={workspacesStore.layout === 'vertical' ? 'vertical' : 'horizontal'}
                onresize={(delta) => handlePaneResize(pane.id, nextPane.id, delta)}
                onresizeend={savePaneSizes}
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
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: 1fr;
    gap: 1px;
    background: var(--bg-light);
  }

  .main-content.layout-grid > :global(.split-pane:last-child:nth-child(odd)) {
    grid-column: 1 / -1;
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
