<script lang="ts">
  import { tick } from 'svelte';
  import type { Tab, Window } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';

  interface Props {
    workspaceId: string;
    window: Window;
  }

  let { workspaceId, window }: Props = $props();

  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  async function startEditing(id: string, currentName: string, e: MouseEvent) {
    e.stopPropagation();
    editingId = id;
    editingName = currentName;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (editingId && editingName.trim()) {
      await workspacesStore.renameTab(workspaceId, window.id, editingId, editingName.trim());
    }
    editingId = null;
    editingName = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditing();
    } else if (e.key === 'Escape') {
      editingId = null;
      editingName = '';
    }
  }

  async function handleNewTab() {
    const count = window.tabs.length + 1;
    await workspacesStore.createTab(workspaceId, window.id, `Terminal ${count}`);
  }

  async function handleCloseTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    if (window.tabs.length > 1) {
      await workspacesStore.deleteTab(workspaceId, window.id, tabId);
    } else {
      // Last tab - close the window
      const ws = workspacesStore.activeWorkspace;
      if (ws && ws.windows.length > 1) {
        await workspacesStore.deleteWindow(workspaceId, window.id);
      }
    }
  }

  async function handleTabClick(tabId: string) {
    await workspacesStore.setActiveTab(workspaceId, window.id, tabId);
  }
</script>

<div class="tabs-bar">
  {#each window.tabs as tab, index (tab.id)}
    <div
      class="tab"
      class:active={tab.id === window.active_tab_id}
      onclick={() => handleTabClick(tab.id)}
      ondblclick={(e) => startEditing(tab.id, tab.name, e)}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === window.active_tab_id}
      onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
    >
      {#if editingId === tab.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={editingName}
          bind:this={editInput}
          onblur={finishEditing}
          onkeydown={handleKeydown}
          class="edit-input"
          autofocus
        />
      {:else}
        <span class="tab-name">{tab.name}</span>
        <div class="tab-actions">
          <button
            class="tab-btn close-btn"
            onclick={(e) => handleCloseTab(tab.id, e)}
            title="Close tab (Cmd+W)"
          >
            &times;
          </button>
        </div>
      {/if}
    </div>
  {/each}

  <button class="new-tab-btn" onclick={handleNewTab} title="New tab (Cmd+T)">
    +
  </button>
</div>

<style>
  .tabs-bar {
    display: flex;
    align-items: center;
    height: var(--tab-height);
    background: var(--bg-medium);
    border-bottom: 1px solid var(--bg-light);
    padding: 0 4px;
    gap: 2px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 2px 8px;
    border-radius: 4px;
    cursor: pointer;
    max-width: 180px;
    height: 26px;
    transition: background 0.1s, padding-right 0.15s ease;
  }

  .tab:hover {
    background: var(--bg-light);
    padding-right: 2px;
  }

  .tab.active {
    background: var(--bg-dark);
  }

  .tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .tab-actions {
    display: flex;
    align-items: center;
    height: calc(100% + 4px);
    margin: -2px 0;
    margin-left: 0;
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: width 0.15s ease, opacity 0.15s ease, margin-left 0.15s ease;
  }

  .tab:hover .tab-actions {
    opacity: 1;
    width: auto;
    margin-left: 6px;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: calc(100% - 4px);
    margin: 2px 0;
    padding: 0;
    color: var(--fg-dim);
    border-radius: 3px;
    font-size: 13px;
    transition: background 0.1s, color 0.1s;
  }

  .tab-btn:hover {
    background: var(--bg-medium);
    color: var(--fg);
  }

  .edit-input {
    width: 100px;
    font-size: 12px;
    padding: 2px 4px;
  }

  .new-tab-btn {
    padding: 4px 10px;
    border-radius: 4px;
    color: var(--fg-dim);
    font-size: 14px;
  }

  .new-tab-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }
</style>
