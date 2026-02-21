<script lang="ts">
  import { tick } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import * as commands from '$lib/tauri/commands';
  import { modSymbol } from '$lib/utils/platform';
  import { claudeCodeStore } from '$lib/stores/claudeCode.svelte';
  import StatusDot from '$lib/components/ui/StatusDot.svelte';

  function workspaceHasActivity(workspaceId: string): boolean {
    if (workspaceId === workspacesStore.activeWorkspaceId) return false;
    const ws = workspacesStore.workspaces.find(w => w.id === workspaceId);
    if (!ws) return false;
    const tabIds = ws.panes.flatMap(p => p.tabs.map(t => t.id));
    return activityStore.hasAnyActivity(tabIds);
  }

  function workspaceTabState(workspaceId: string): 'alert' | 'question' | null {
    const ws = workspacesStore.workspaces.find(w => w.id === workspaceId);
    if (!ws) return null;
    const tabIds = ws.panes.flatMap(p => p.tabs.map(t => t.id));
    return activityStore.getWorkspaceTabState(tabIds);
  }

  let appVersion = $state('');
  getVersion().then(v => { appVersion = v; });

  interface Props {
    width: number;
    onversionclick?: () => void;
  }

  let { width, onversionclick }: Props = $props();

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
    } else {
      // Last workspace: kill terminals and show empty state
      await terminalsStore.killAllTerminals();
      await commands.resetWindow();
      workspacesStore.reset();
    }
  }

  // Pointer-based drag reordering (same pattern as TerminalTabs)
  let dragWorkspaceId = $state<string | null>(null);
  let dropTargetIndex = $state<number | null>(null);
  let dropSide = $state<'before' | 'after'>('before');

  const DRAG_THRESHOLD = 5;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pendingDragWorkspaceId: string | null = null;
  let ghost: HTMLElement | null = null;
  let cursorBadge: HTMLElement | null = null;
  let workspaceListEl: HTMLElement;
  let didDrag = false;

  function handlePointerDown(e: PointerEvent, workspaceId: string) {
    if (e.button !== 0 || editingId === workspaceId) return;
    if ((e.target as HTMLElement).closest('.delete-btn')) return;
    pendingDragWorkspaceId = workspaceId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    didDrag = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!pendingDragWorkspaceId && !dragWorkspaceId) return;

    // Check threshold before starting drag
    if (pendingDragWorkspaceId && !dragWorkspaceId) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragWorkspaceId = pendingDragWorkspaceId;
      pendingDragWorkspaceId = null;
      didDrag = true;
      createGhost(e);
    }

    if (!dragWorkspaceId || !ghost) return;

    // Move ghost
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;

    // Hit-test workspace items to find drop target (vertical)
    const wsEls = workspaceListEl.querySelectorAll<HTMLElement>('.workspace-item');
    let foundTarget = false;
    for (let i = 0; i < wsEls.length; i++) {
      const rect = wsEls[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const midY = rect.top + rect.height / 2;
        dropSide = e.clientY < midY ? 'before' : 'after';
        dropTargetIndex = i;
        foundTarget = true;
        break;
      }
    }
    // If cursor is below the last item but within the list, target "after last"
    if (!foundTarget && wsEls.length > 0) {
      const listRect = workspaceListEl.getBoundingClientRect();
      const lastRect = wsEls[wsEls.length - 1].getBoundingClientRect();
      if (e.clientX >= listRect.left && e.clientX <= listRect.right &&
          e.clientY > lastRect.bottom && e.clientY <= listRect.bottom) {
        dropTargetIndex = wsEls.length - 1;
        dropSide = 'after';
        foundTarget = true;
      }
    }
    if (!foundTarget) {
      dropTargetIndex = null;
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    updateCursorBadge(e.altKey);
  }

  function updateCursorBadge(altKey: boolean) {
    if (!cursorBadge) return;
    cursorBadge.style.left = `${lastPointerX + 16}px`;
    cursorBadge.style.top = `${lastPointerY + 16}px`;
    cursorBadge.style.display = altKey ? 'flex' : 'none';
  }

  function handleDragKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      clearDragState();
      return;
    }
    if (e.key === 'Alt') updateCursorBadge(true);
  }

  function handleDragKeyUp(e: KeyboardEvent) {
    if (e.key === 'Alt') updateCursorBadge(false);
  }

  function handlePointerUp(e: PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    if (dragWorkspaceId && dropTargetIndex !== null) {
      const sourceId = dragWorkspaceId;
      const allWs = workspacesStore.workspaces;
      const fromIndex = allWs.findIndex(w => w.id === sourceId);
      const isCopy = e.altKey;

      // Compute the insertion position
      let insertPos = dropSide === 'after' ? dropTargetIndex + 1 : dropTargetIndex;

      clearDragState();

      if (isCopy) {
        // Duplicate workspace at the insertion position
        workspacesStore.duplicateWorkspace(sourceId, insertPos);
      } else if (fromIndex !== -1) {
        // Reorder: compute new order
        let toIndex = insertPos;
        if (fromIndex < toIndex) toIndex--;
        if (fromIndex !== toIndex) {
          const ids = allWs.map(w => w.id);
          const [moved] = ids.splice(fromIndex, 1);
          ids.splice(toIndex, 0, moved);
          workspacesStore.reorderWorkspaces(ids);
        }
      }
      return;
    }

    clearDragState();
  }

  function createGhost(e: PointerEvent) {
    const sourceEl = workspaceListEl.querySelector<HTMLElement>(
      `.workspace-item[data-workspace-id="${dragWorkspaceId}"]`
    );
    if (!sourceEl) return;
    ghost = sourceEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${sourceEl.offsetWidth}px`;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
    // Cursor badge (macOS-style "+" near pointer)
    cursorBadge = document.createElement('div');
    cursorBadge.className = 'drag-cursor-badge';
    cursorBadge.textContent = '+';
    cursorBadge.style.display = 'none';
    document.body.appendChild(cursorBadge);
    // Key listeners for Escape cancel and Option badge
    document.addEventListener('keydown', handleDragKeyDown);
    document.addEventListener('keyup', handleDragKeyUp);
  }

  function clearDragState() {
    document.removeEventListener('keydown', handleDragKeyDown);
    document.removeEventListener('keyup', handleDragKeyUp);
    dragWorkspaceId = null;
    dropTargetIndex = null;
    pendingDragWorkspaceId = null;
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (cursorBadge) {
      cursorBadge.remove();
      cursorBadge = null;
    }
  }

  const sortedWorkspaces = $derived.by(() => {
    const ws = workspacesStore.workspaces;
    const order = preferencesStore.workspaceSortOrder;
    if (order === 'alphabetical') {
      return [...ws].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    if (order === 'recent_activity') {
      const switched = workspacesStore.lastSwitchedAt;
      return [...ws].sort((a, b) => {
        const aTs = a.id === workspacesStore.activeWorkspaceId ? Date.now() : (switched.get(a.id) ?? 0);
        const bTs = b.id === workspacesStore.activeWorkspaceId ? Date.now() : (switched.get(b.id) ?? 0);
        return bTs - aTs;
      });
    }
    return ws;
  });

  function handleItemClick(workspaceId: string) {
    // Suppress click after a drag
    if (didDrag) {
      didDrag = false;
      return;
    }
    workspacesStore.setActiveWorkspace(workspaceId);
  }
</script>

<aside class="sidebar" style="width: {width}px">
  <div class="sidebar-titlebar">
    <img src="/logo-light.png" alt="aiTerm" class="sidebar-logo" />
    {#if import.meta.env.DEV}
      <span class="dev-badge">DEV</span>
    {/if}
    {#if appVersion}
      <button class="version-badge" onclick={onversionclick}>v{appVersion}</button>
    {/if}
    {#if claudeCodeStore.connected}
      <span class="claude-connected">
        <StatusDot color="green" tooltip="IDE Connected" />
      </span>
    {/if}
    <button class="header-btn collapse-btn" onclick={() => workspacesStore.toggleSidebar()} title="Collapse sidebar ({modSymbol}B)">&#x2039;</button>
  </div>
  <div class="sidebar-header">
    <span class="title">WORKSPACES</span>
    <button class="header-btn" onclick={handleNewWorkspace} title="New workspace ({modSymbol}N)">+</button>
  </div>

  {#if preferencesStore.showRecentWorkspaces && workspacesStore.recentWorkspaces.length > 0}
    <div class="recent-section">
      <span class="recent-title">RECENT</span>
      <div class="recent-list">
        {#each workspacesStore.recentWorkspaces as workspace (workspace.id)}
          <button
            class="recent-item"
            onclick={() => workspacesStore.setActiveWorkspace(workspace.id)}
            title={workspace.name}
          >
            {workspace.name}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="workspace-list" bind:this={workspaceListEl}>
    {#each sortedWorkspaces as workspace, index (workspace.id)}
      <div
        class="workspace-item"
        class:active={workspace.id === workspacesStore.activeWorkspaceId}
        class:dragging={dragWorkspaceId === workspace.id}
        class:drop-before={dropTargetIndex === index && dropSide === 'before' && dragWorkspaceId !== workspace.id}
        class:drop-after={dropTargetIndex === index && dropSide === 'after' && dragWorkspaceId !== workspace.id}
        data-workspace-id={workspace.id}
        onclick={() => handleItemClick(workspace.id)}
        ondblclick={() => startEditing(workspace.id, workspace.name)}
        onpointerdown={(e) => handlePointerDown(e, workspace.id)}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
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
          <span class="workspace-indicator">
            {#if workspaceTabState(workspace.id) === 'alert'}
              <span class="state-emoji">&#x2757;</span>
            {:else if workspaceTabState(workspace.id) === 'question'}
              <span class="state-emoji">&#x2753;</span>
            {:else if workspace.id === workspacesStore.activeWorkspaceId}
              >
            {:else if workspaceHasActivity(workspace.id)}
              <StatusDot color="green" />
            {/if}
          </span>
          <span class="workspace-name">{workspace.name}{#if preferencesStore.showWorkspaceTabCount}<span class="tab-count"> ({workspace.panes.reduce((sum, p) => sum + p.tabs.length, 0)})</span>{/if}</span>
          <button
            class="delete-btn"
            onclick={(e) => handleDeleteWorkspace(workspace.id, e)}
            title="Close workspace"
          >
            &times;
          </button>
        {/if}
      </div>
    {/each}
  </div>

</aside>

<style>
  .sidebar {
    flex-shrink: 0;
    background: var(--bg-medium);
    display: flex;
    flex-direction: column;
  }

  .sidebar-titlebar {
    display: flex;
    align-items: center;
    height: var(--tab-height);
    padding: 0 16px;
    border-bottom: 1px solid var(--bg-light);
  }

  .sidebar-logo {
    height: 14px;
    opacity: 0.7;
    pointer-events: none;
    filter: brightness(var(--logo-brightness, 1));
  }

  .dev-badge {
    margin-left: 6px;
    font-size: 10px;
    font-weight: 600;
    color: var(--bg-dark);
    background: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
    pointer-events: none;
  }

  .version-badge {
    margin-left: 6px;
    font-size: 10px;
    color: var(--fg-dim);
    cursor: pointer;
    -webkit-app-region: no-drag;
  }

  .version-badge:hover {
    color: var(--fg);
  }

  .claude-connected {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
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
    margin-left: auto;
  }

  .header-btn {
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

  .header-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .recent-section {
    padding: 8px 16px;
    border-bottom: 1px solid var(--bg-light);
  }

  .recent-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: var(--fg-dim);
  }

  .recent-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .recent-item {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--bg-light);
    color: var(--fg);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    transition: background 0.1s;
  }

  .recent-item:hover {
    background: var(--accent);
    color: var(--bg-dark);
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

  .workspace-item:global(.drop-target) {
    background: rgba(122, 162, 247, 0.2);
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .workspace-item.dragging {
    opacity: 0.3;
  }

  .workspace-item.drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .workspace-item.drop-after {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .workspace-indicator {
    color: var(--accent);
    font-weight: bold;
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }


  .state-emoji {
    font-size: 10px;
    line-height: 1;
  }

  .workspace-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-count {
    color: var(--fg-dim);
  }

  .delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 3px;
    font-size: 13px;
    color: var(--fg-dim);
    opacity: 0;
    flex-shrink: 0;
  }

  .workspace-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: var(--bg-dark);
    color: var(--fg);
  }

  .edit-input {
    flex: 1;
    background: var(--bg-dark);
  }

</style>
