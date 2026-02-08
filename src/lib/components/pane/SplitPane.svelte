<script lang="ts">
  import { tick, onMount } from 'svelte';
  import type { Pane } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import TerminalTabs from '$lib/components/terminal/TerminalTabs.svelte';
  import SearchBar from '$lib/components/terminal/SearchBar.svelte';

  interface Props {
    workspaceId: string;
    pane: Pane;
    isActive: boolean;
    showHeader: boolean;
  }

  let { workspaceId, pane, isActive, showHeader }: Props = $props();

  let editingName = $state(false);
  let nameValue = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  // Notify portaled TerminalPanes that their slots are ready
  onMount(() => {
    for (const tab of pane.tabs) {
      window.dispatchEvent(new CustomEvent('terminal-slot-ready', { detail: { tabId: tab.id } }));
    }
  });

  async function startEditing() {
    editingName = true;
    nameValue = pane.name;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (nameValue.trim() && nameValue !== pane.name) {
      await workspacesStore.renamePane(workspaceId, pane.id, nameValue.trim());
    }
    editingName = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditing();
    } else if (e.key === 'Escape') {
      editingName = false;
      nameValue = pane.name;
    }
  }

  async function handleClick() {
    if (!isActive) {
      await workspacesStore.setActivePane(workspaceId, pane.id);
    }
  }

  async function handleClosePane(e: MouseEvent) {
    e.stopPropagation();
    const ws = workspacesStore.activeWorkspace;
    if (ws && ws.panes.length > 1) {
      await workspacesStore.deletePane(workspaceId, pane.id);
    }
  }
</script>

<div class="split-pane" class:active={isActive}>
  {#if showHeader}
    <div
      class="pane-header"
      onclick={handleClick}
      ondblclick={startEditing}
      role="button"
      tabindex="0"
      onkeydown={(e) => e.key === 'Enter' && handleClick()}
    >
      {#if editingName}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={nameValue}
          bind:this={editInput}
          onblur={finishEditing}
          onkeydown={handleKeydown}
          class="name-input"
          autofocus
        />
      {:else}
        <span class="pane-name">{pane.name}</span>
        <div class="pane-actions">
          <button
            class="close-btn"
            onclick={handleClosePane}
            title="Close pane"
          >
            &times;
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <TerminalTabs {workspaceId} {pane} />

  <div class="terminal-area">
    {#if pane.active_tab_id}
      <SearchBar tabId={pane.active_tab_id} />
    {/if}
    {#each pane.tabs as tab (tab.id)}
      <div
        class="terminal-slot"
        class:hidden-tab={tab.id !== pane.active_tab_id}
        data-terminal-slot={tab.id}
      ></div>
    {/each}
  </div>
</div>

<style>
  .split-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .split-pane:last-child {
    border-right: none;
  }

  .pane-header {
    height: var(--header-height);
    display: flex;
    align-items: center;
    padding: 0 16px;
    background: var(--bg-medium);
    border-bottom: 1px solid var(--bg-light);
    cursor: pointer;
  }

  .pane-name {
    flex: 1;
    font-weight: 500;
    color: var(--fg);
  }

  .pane-actions {
    display: flex;
    align-items: center;
    margin-left: auto;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .pane-header:hover .pane-actions {
    opacity: 1;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--fg-dim);
    border-radius: 4px;
    font-size: 14px;
    transition: background 0.1s, color 0.1s;
  }

  .close-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .name-input {
    font-weight: 500;
    padding: 4px 8px;
  }

  .terminal-area {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }

  .terminal-slot {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .terminal-slot.hidden-tab {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
  }
</style>
