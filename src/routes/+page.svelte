<script lang="ts">
  import { onMount } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import WorkspaceSidebar from '$lib/components/workspace/WorkspaceSidebar.svelte';
  import SplitContainer from '$lib/components/pane/SplitContainer.svelte';
  import TerminalPane from '$lib/components/terminal/TerminalPane.svelte';
  import Resizer from '$lib/components/Resizer.svelte';

  let loading = $state(true);

  onMount(async () => {
    await workspacesStore.load();
    loading = false;
  });

  function handleSidebarResize(delta: number) {
    workspacesStore.setSidebarWidth(workspacesStore.sidebarWidth + delta);
  }

  function handleSidebarResizeEnd() {
    workspacesStore.saveSidebarWidth();
  }
</script>

<div class="app">
  <div class="titlebar" data-tauri-drag-region>
    <div class="titlebar-spacer"></div>
    <img src="/logo-light.png" alt="aiTerm" class="titlebar-logo" />
  </div>

  <div class="app-body">
    {#if loading}
      <div class="loading">
        <img src="/logo-light.png" alt="aiTerm" class="loading-logo" />
      </div>
    {:else}
      {#if !workspacesStore.sidebarCollapsed}
        <WorkspaceSidebar width={workspacesStore.sidebarWidth} />
        <Resizer direction="horizontal" onresize={handleSidebarResize} onresizeend={handleSidebarResizeEnd} />
      {:else}
        <button class="sidebar-expand" onclick={() => workspacesStore.toggleSidebar()} title="Expand sidebar (⌘B)">
          <span class="expand-icon">&#x203A;</span>
        </button>
      {/if}

      <main class="main-content">
        {#if workspacesStore.activeWorkspace}
          {@const workspace = workspacesStore.activeWorkspace}
          {#if workspace.split_root}
            <SplitContainer
              node={workspace.split_root}
              workspaceId={workspace.id}
              panes={workspace.panes}
            />
          {/if}

          <!-- Portal layer: terminals rendered flat so they survive split tree changes.
               Zero-size container so they don't affect flex layout before portaling. -->
          <div class="terminal-host">
            {#each workspace.panes as pane (pane.id)}
              {#each pane.tabs as tab (tab.id)}
                <TerminalPane
                  workspaceId={workspace.id}
                  paneId={pane.id}
                  tabId={tab.id}
                  visible={tab.id === pane.active_tab_id}
                  initialScrollback={tab.scrollback}
                />
              {/each}
            {/each}
          </div>
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

  .titlebar-logo {
    height: 16px;
    opacity: 0.7;
    pointer-events: none;
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
  }

  .loading-logo {
    height: 48px;
    opacity: 0.5;
  }

  .main-content {
    flex: 1;
    display: flex;
    min-width: 0;
    background: var(--bg-dark);
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

  .terminal-host {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .sidebar-expand {
    flex-shrink: 0;
    width: 20px;
    background: var(--bg-medium);
    border: none;
    border-right: 1px solid var(--bg-light);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.1s;
  }

  .sidebar-expand:hover {
    background: var(--bg-light);
  }

  .expand-icon {
    color: var(--fg-dim);
    font-size: 16px;
    line-height: 1;
  }

  .sidebar-expand:hover .expand-icon {
    color: var(--fg);
  }
</style>
