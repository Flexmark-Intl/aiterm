<script lang="ts">
  import { tick } from 'svelte';
  import type { Window } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import TerminalTabs from '$lib/components/terminal/TerminalTabs.svelte';
  import TerminalPane from '$lib/components/terminal/TerminalPane.svelte';

  interface Props {
    workspaceId: string;
    window: Window;
    isActive: boolean;
    flex?: number;
  }

  let { workspaceId, window, isActive, flex = 1 }: Props = $props();

  let editingName = $state(false);
  let nameValue = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  async function startEditing() {
    editingName = true;
    nameValue = window.name;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (nameValue.trim() && nameValue !== window.name) {
      await workspacesStore.renameWindow(workspaceId, window.id, nameValue.trim());
    }
    editingName = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      finishEditing();
    } else if (e.key === 'Escape') {
      editingName = false;
      nameValue = window.name;
    }
  }

  async function handleClick() {
    if (!isActive) {
      await workspacesStore.setActiveWindow(workspaceId, window.id);
    }
  }

  async function handleCloseWindow(e: MouseEvent) {
    e.stopPropagation();
    const ws = workspacesStore.activeWorkspace;
    if (ws && ws.windows.length > 1) {
      await workspacesStore.deleteWindow(workspaceId, window.id);
    }
  }
</script>

<div class="terminal-window" class:active={isActive} style="flex: {flex}">
  <div
    class="window-header"
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
      <span class="window-name">Window: {window.name}</span>
      <button
        class="close-btn"
        onclick={handleCloseWindow}
        title="Close window"
      >
        &times;
      </button>
    {/if}
  </div>

  <TerminalTabs {workspaceId} {window} />

  <div class="terminal-area">
    {#each window.tabs as tab (tab.id)}
      <TerminalPane
        {workspaceId}
        windowId={window.id}
        tabId={tab.id}
        visible={tab.id === window.active_tab_id}
        initialScrollback={tab.scrollback}
      />
    {/each}
  </div>
</div>

<style>
  .terminal-window {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .terminal-window:last-child {
    border-right: none;
  }

  .window-header {
    height: var(--header-height);
    display: flex;
    align-items: center;
    padding: 0 16px;
    background: var(--bg-medium);
    border-bottom: 1px solid var(--bg-light);
    cursor: pointer;
  }

  .window-name {
    flex: 1;
    font-weight: 500;
    color: var(--fg);
  }

  .close-btn {
    opacity: 0;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 16px;
    color: var(--fg-dim);
    margin-left: auto;
  }

  .window-header:hover .close-btn {
    opacity: 1;
  }

  .close-btn:hover {
    background: var(--red);
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
</style>
