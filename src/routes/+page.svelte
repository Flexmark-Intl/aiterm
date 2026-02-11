<script lang="ts">
  import { onMount } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import WorkspaceSidebar from '$lib/components/workspace/WorkspaceSidebar.svelte';
  import SplitContainer from '$lib/components/pane/SplitContainer.svelte';
  import TerminalPane from '$lib/components/terminal/TerminalPane.svelte';
  import Resizer from '$lib/components/Resizer.svelte';
  import { modLabel, modSymbol, altLabel } from '$lib/utils/platform';

  let loading = $state(true);

  // Track which workspaces have been visited so we lazily mount terminals
  // on first activation but keep them alive across workspace switches.
  let activatedWorkspaceIds = $state(new Set<string>());

  $effect(() => {
    const id = workspacesStore.activeWorkspaceId;
    if (id && !activatedWorkspaceIds.has(id)) {
      activatedWorkspaceIds = new Set(activatedWorkspaceIds).add(id);
    }
  });

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
            {#key workspace.id}
              <SplitContainer
                node={workspace.split_root}
                workspaceId={workspace.id}
                panes={workspace.panes}
              />
            {/key}
          {/if}
        {:else}
          <div class="empty-state">
            <p>No workspace selected</p>
            <p>Press <kbd>{modLabel}+{altLabel}+N</kbd> to create a new workspace</p>
          </div>
        {/if}

        <!-- Portal layer: terminals rendered flat across visited workspaces so they
             survive both split tree changes and workspace switches.
             Lazy: only mounts terminals once a workspace is first activated. -->
        <div class="terminal-host">
          {#each workspacesStore.workspaces.filter(w => activatedWorkspaceIds.has(w.id)) as ws (ws.id)}
            {#each ws.panes as pane (pane.id)}
              {#each pane.tabs as tab (tab.id)}
                <TerminalPane
                  workspaceId={ws.id}
                  paneId={pane.id}
                  tabId={tab.id}
                  visible={tab.id === pane.active_tab_id && ws.id === workspacesStore.activeWorkspaceId}
                  initialScrollback={tab.scrollback}
                  restoreCwd={tab.restore_cwd}
                  restoreSshCommand={tab.restore_ssh_command}
                  restoreRemoteCwd={tab.restore_remote_cwd}
                  pinnedSshCommand={tab.pinned_ssh_command}
                  pinnedRemoteCwd={tab.pinned_remote_cwd}
                  pinnedCommand={tab.pinned_command}
                />
              {/each}
            {/each}
          {/each}
        </div>
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
