<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { Tab, Pane } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import type { OscState } from '$lib/stores/terminals.svelte';

  interface Props {
    workspaceId: string;
    pane: Pane;
  }

  let { workspaceId, pane }: Props = $props();

  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editInput = $state<HTMLInputElement | null>(null);

  // Track OSC titles for tabs in this pane
  let oscTitles = $state<Map<string, string>>(new Map());

  const unsubOsc = terminalsStore.onOscChange((tabId: string, osc: OscState) => {
    if (osc.title && pane.tabs.some(t => t.id === tabId && !t.custom_name)) {
      oscTitles = new Map(oscTitles);
      oscTitles.set(tabId, osc.title);
    }
  });
  onDestroy(unsubOsc);

  function displayName(tab: Tab): string {
    if (tab.custom_name) return tab.name;
    return oscTitles.get(tab.id) ?? tab.name;
  }

  async function startEditing(id: string, currentName: string, e: MouseEvent) {
    e.stopPropagation();
    editingId = id;
    editingName = currentName;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (editingId && editingName.trim()) {
      await workspacesStore.renameTab(workspaceId, pane.id, editingId, editingName.trim(), true);
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
    const count = pane.tabs.length + 1;
    await workspacesStore.createTab(workspaceId, pane.id, `Terminal ${count}`);
  }

  async function handleCloseTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    if (pane.tabs.length > 1) {
      await workspacesStore.deleteTab(workspaceId, pane.id, tabId);
    } else {
      // Last tab - close the pane
      const ws = workspacesStore.activeWorkspace;
      if (ws && ws.panes.length > 1) {
        await workspacesStore.deletePane(workspaceId, pane.id);
      }
    }
  }

  async function handleTabClick(tabId: string) {
    await workspacesStore.setActiveTab(workspaceId, pane.id, tabId);
  }

  // Pointer-based drag reordering (HTML5 drag-and-drop is unreliable in Tauri WKWebView)
  let dragTabId = $state<string | null>(null);
  let dropTargetIndex = $state<number | null>(null);
  let dropSide = $state<'before' | 'after'>('before');

  const DRAG_THRESHOLD = 5;
  let dragStartX = 0;
  let dragStartY = 0;
  let pendingDragTabId: string | null = null;
  let ghost: HTMLElement | null = null;
  let tabsBarEl: HTMLElement;

  function handlePointerDown(e: PointerEvent, tabId: string) {
    // Only primary button, skip if editing
    if (e.button !== 0 || editingId === tabId) return;
    pendingDragTabId = tabId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!pendingDragTabId && !dragTabId) return;

    // Check threshold before starting drag
    if (pendingDragTabId && !dragTabId) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragTabId = pendingDragTabId;
      pendingDragTabId = null;
      createGhost(e);
    }

    if (!dragTabId || !ghost) return;

    // Move ghost
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;

    // Hit-test tab elements to find drop target
    const tabEls = tabsBarEl.querySelectorAll<HTMLElement>('.tab');
    let foundTarget = false;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const midX = rect.left + rect.width / 2;
        dropSide = e.clientX < midX ? 'before' : 'after';
        dropTargetIndex = i;
        foundTarget = true;
        break;
      }
    }
    if (!foundTarget) {
      dropTargetIndex = null;
    }
  }

  function handlePointerUp(e: PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    if (dragTabId && dropTargetIndex !== null) {
      const fromIndex = pane.tabs.findIndex(t => t.id === dragTabId);
      if (fromIndex !== -1) {
        let toIndex = dropSide === 'after' ? dropTargetIndex + 1 : dropTargetIndex;
        if (fromIndex < toIndex) toIndex--;
        if (fromIndex !== toIndex) {
          const ids = pane.tabs.map(t => t.id);
          const [moved] = ids.splice(fromIndex, 1);
          ids.splice(toIndex, 0, moved);
          workspacesStore.reorderTabs(workspaceId, pane.id, ids);
        }
      }
    }

    clearDragState();
  }

  function createGhost(e: PointerEvent) {
    const sourceTab = tabsBarEl.querySelector<HTMLElement>(`.tab[data-tab-id="${dragTabId}"]`);
    if (!sourceTab) return;
    ghost = sourceTab.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
  }

  function clearDragState() {
    dragTabId = null;
    dropTargetIndex = null;
    pendingDragTabId = null;
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
  }
</script>

<div class="tabs-bar" bind:this={tabsBarEl}>
  {#each pane.tabs as tab, index (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab"
      class:active={tab.id === pane.active_tab_id}
      class:dragging={dragTabId === tab.id}
      class:drop-before={dropTargetIndex === index && dropSide === 'before' && dragTabId !== tab.id}
      class:drop-after={dropTargetIndex === index && dropSide === 'after' && dragTabId !== tab.id}
      data-tab-id={tab.id}
      onclick={() => { if (!dragTabId) handleTabClick(tab.id); }}
      ondblclick={(e) => startEditing(tab.id, tab.name, e)}
      onpointerdown={(e) => handlePointerDown(e, tab.id)}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === pane.active_tab_id}
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
        {#if tab.id !== pane.active_tab_id && activityStore.hasActivity(tab.id)}
          <span class="activity-dot"></span>
        {/if}
        <span class="tab-name">{displayName(tab)}</span>
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

  .tab.dragging {
    opacity: 0.3;
  }

  .tab.drop-before {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .tab.drop-after {
    box-shadow: inset -2px 0 0 var(--accent);
  }

  :global(.drag-ghost) {
    position: fixed;
    pointer-events: none;
    z-index: 10000;
    opacity: 0.5;
    transform: translate(-50%, -50%);
    background: var(--bg-dark);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 8px;
    height: 26px;
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--fg);
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    margin-right: 4px;
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
    width: 22px;
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
