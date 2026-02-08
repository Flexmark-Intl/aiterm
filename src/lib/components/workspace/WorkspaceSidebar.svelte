<script lang="ts">
  import { tick } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';

  interface Props {
    width: number;
  }

  let { width }: Props = $props();

  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  async function startEditing(id: string, currentName: string) {
    editingId = id;
    editingName = currentName;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (editingId && editingName.trim()) {
      await workspacesStore.renameWorkspace(editingId, editingName.trim());
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

  async function handleNewWorkspace() {
    const count = workspacesStore.workspaces.length + 1;
    await workspacesStore.createWorkspace(`Workspace ${count}`);
  }

  async function handleDeleteWorkspace(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (workspacesStore.workspaces.length > 1) {
      await workspacesStore.deleteWorkspace(id);
    }
  }
</script>

<aside class="sidebar" style="width: {width}px">
  <div class="sidebar-header">
    <span class="title">WORKSPACES</span>
    <button class="collapse-btn" onclick={() => workspacesStore.toggleSidebar()} title="Collapse sidebar (⌘B)">
      &#x2039;
    </button>
  </div>

  <div class="workspace-list">
    {#each workspacesStore.workspaces as workspace (workspace.id)}
      <div
        class="workspace-item"
        class:active={workspace.id === workspacesStore.activeWorkspaceId}
        onclick={() => workspacesStore.setActiveWorkspace(workspace.id)}
        ondblclick={() => startEditing(workspace.id, workspace.name)}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && workspacesStore.setActiveWorkspace(workspace.id)}
      >
        {#if editingId === workspace.id}
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
          <span class="workspace-indicator">{workspace.id === workspacesStore.activeWorkspaceId ? '>' : ' '}</span>
          <span class="workspace-name">{workspace.name}</span>
          {#if workspacesStore.workspaces.length > 1}
            <button
              class="delete-btn"
              onclick={(e) => handleDeleteWorkspace(workspace.id, e)}
              title="Delete workspace"
            >
              &times;
            </button>
          {/if}
        {/if}
      </div>
    {/each}
  </div>

  <button class="new-workspace-btn" onclick={handleNewWorkspace}>
    + New Workspace
  </button>
</aside>

<style>
  .sidebar {
    flex-shrink: 0;
    background: var(--bg-medium);
    display: flex;
    flex-direction: column;
  }

  .sidebar-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--fg-dim);
  }

  .collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 4px;
    color: var(--fg-dim);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }

  .collapse-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .workspace-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .workspace-item {
    display: flex;
    align-items: center;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.1s;
    gap: 8px;
  }

  .workspace-item:hover {
    background: var(--bg-light);
  }

  .workspace-item.active {
    background: var(--bg-light);
  }

  .workspace-indicator {
    color: var(--accent);
    font-weight: bold;
    width: 12px;
  }

  .workspace-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delete-btn {
    opacity: 0;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 14px;
    color: var(--fg-dim);
  }

  .workspace-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: var(--red);
    color: var(--fg);
  }

  .edit-input {
    flex: 1;
    background: var(--bg-dark);
  }

  .new-workspace-btn {
    padding: 12px 16px;
    text-align: left;
    color: var(--fg-dim);
    border-top: 1px solid var(--bg-light);
    transition: all 0.1s;
  }

  .new-workspace-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }
</style>
