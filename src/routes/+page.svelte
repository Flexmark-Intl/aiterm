<script lang="ts">
  import { onMount } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import WorkspaceSidebar from '$lib/components/workspace/WorkspaceSidebar.svelte';
  import SplitContainer from '$lib/components/pane/SplitContainer.svelte';
  import TerminalPane from '$lib/components/terminal/TerminalPane.svelte';
  import Resizer from '$lib/components/Resizer.svelte';
  import { modLabel, modSymbol, altLabel } from '$lib/utils/platform';

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
  {#if import.meta.env.DEV}
    <span class="dev-badge">DEV</span>
  {/if}
  <div class="app-body">
    {#if loading}
      <div class="loading">
        <img src="/logo-light.png" alt="aiTerm" class="loading-logo" />
      </div>
    {:else}
      <div
        class="sidebar-wrapper"
        class:collapsed={workspacesStore.sidebarCollapsed}
        style="width: {workspacesStore.sidebarCollapsed ? 0 : workspacesStore.sidebarWidth + 4}px"
      >
        <WorkspaceSidebar width={workspacesStore.sidebarWidth} />
        <Resizer direction="horizontal" onresize={handleSidebarResize} onresizeend={handleSidebarResizeEnd} />
      </div>
      {#if workspacesStore.sidebarCollapsed}
        <button class="sidebar-expand" onclick={() => workspacesStore.toggleSidebar()} title="Expand sidebar ({modSymbol}B)">
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
                  restoreCwd={tab.restore_cwd}
                  restoreSshCommand={tab.restore_ssh_command}
                  restoreRemoteCwd={tab.restore_remote_cwd}
                />
              {/each}
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <p>No workspace selected</p>
            <p>Press <kbd>{modLabel}+{altLabel}+N</kbd> to create a new workspace</p>
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

  .dev-badge {
    position: fixed;
    top: 6px;
    right: 10px;
    z-index: 9999;
    font-size: 10px;
    font-weight: 600;
    color: var(--bg-dark);
    background: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
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

  .sidebar-wrapper {
    flex-shrink: 0;
    display: flex;
    overflow: hidden;
    transition: width 0.2s ease;
  }

  .sidebar-wrapper.collapsed {
    width: 0 !important;
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
