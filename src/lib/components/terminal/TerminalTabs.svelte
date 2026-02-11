<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { Tab, Pane } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import type { OscState } from '$lib/stores/terminals.svelte';
  import { modLabel } from '$lib/utils/platform';

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
    if (editingId === id) return; // Already editing — let browser handle word selection
    editingId = id;
    editingName = currentName;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (editingId) {
      const trimmed = editingName.trim();
      if (trimmed) {
        await workspacesStore.renameTab(workspaceId, pane.id, editingId, trimmed, true);
      } else {
        // Clearing the name resets to default (auto-naming from OSC title)
        const oscTitle = terminalsStore.getOsc(editingId)?.title;
        const defaultName = oscTitle ?? 'Terminal';
        await workspacesStore.renameTab(workspaceId, pane.id, editingId, defaultName, false);
        // Populate oscTitles so displayName picks it up immediately
        if (oscTitle) {
          oscTitles = new Map(oscTitles);
          oscTitles.set(editingId, oscTitle);
        }
      }
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

  async function handleDuplicateTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    await workspacesStore.duplicateTab(workspaceId, pane.id, tabId);
  }

  async function handleCloseTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    const ws = workspacesStore.activeWorkspace;
    if (pane.tabs.length > 1) {
      await workspacesStore.deleteTab(workspaceId, pane.id, tabId);
    } else if (ws && ws.panes.length > 1) {
      // Last tab in pane — close the pane
      await workspacesStore.deletePane(workspaceId, pane.id);
    } else {
      // Last tab in last pane — close tab, pane shows empty state
      await workspacesStore.deleteTab(workspaceId, pane.id, tabId);
    }
  }

  async function handleTabClick(tabId: string) {
    await workspacesStore.setActiveTab(workspaceId, pane.id, tabId);
  }

  // Pointer-based drag reordering (HTML5 drag-and-drop is unreliable in Tauri WKWebView)
  let dragTabId = $state<string | null>(null);
  let dropTargetIndex = $state<number | null>(null);
  let dropSide = $state<'before' | 'after'>('before');
  let dropWorkspaceId: string | null = null;

  const DRAG_THRESHOLD = 5;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pendingDragTabId: string | null = null;
  let ghost: HTMLElement | null = null;
  let cursorBadge: HTMLElement | null = null;
  let tabsBarEl: HTMLElement;

  function handlePointerDown(e: PointerEvent, tabId: string) {
    // Only primary button, skip if editing or clicking close button
    if (e.button !== 0 || editingId === tabId) return;
    if ((e.target as HTMLElement).closest('.close-btn') || (e.target as HTMLElement).closest('.duplicate-btn')) return;
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
    let foundTabTarget = false;
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const midX = rect.left + rect.width / 2;
        dropSide = e.clientX < midX ? 'before' : 'after';
        dropTargetIndex = i;
        foundTabTarget = true;
        break;
      }
    }
    if (!foundTabTarget) {
      dropTargetIndex = null;
    }

    // Hit-test workspace sidebar elements
    const wsEls = document.querySelectorAll<HTMLElement>('[data-workspace-id]');
    let foundWsId: string | null = null;
    for (const wsEl of wsEls) {
      const rect = wsEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const wsId = wsEl.getAttribute('data-workspace-id');
        if (wsId && wsId !== workspaceId) {
          foundWsId = wsId;
        }
        break;
      }
    }

    // Update drop-target class on workspace elements
    if (foundWsId !== dropWorkspaceId) {
      // Remove old highlight
      if (dropWorkspaceId) {
        const oldEl = document.querySelector(`[data-workspace-id="${dropWorkspaceId}"]`);
        oldEl?.classList.remove('drop-target');
      }
      // Add new highlight
      if (foundWsId) {
        const newEl = document.querySelector(`[data-workspace-id="${foundWsId}"]`);
        newEl?.classList.add('drop-target');
        // Clear tab drop target when over a workspace
        dropTargetIndex = null;
      }
      dropWorkspaceId = foundWsId;
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    updateCursorBadge(e.altKey);
  }

  function updateCursorBadge(altKey: boolean) {
    if (!cursorBadge) return;
    cursorBadge.style.left = `${lastPointerX + 16}px`;
    cursorBadge.style.top = `${lastPointerY + 16}px`;
    if (dropWorkspaceId && altKey) {
      cursorBadge.style.display = 'flex';
    } else {
      cursorBadge.style.display = 'none';
    }
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

    if (dragTabId && dropWorkspaceId) {
      // Drop onto a workspace — copy (Alt/Option) or move
      const tabId = dragTabId;
      const targetWsId = dropWorkspaceId;
      const isCopy = e.altKey;
      clearDragState();
      if (isCopy) {
        workspacesStore.copyTabToWorkspace(workspaceId, pane.id, tabId, targetWsId);
      } else {
        workspacesStore.moveTabToWorkspace(workspaceId, pane.id, tabId, targetWsId);
      }
      return;
    }

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
    dragTabId = null;
    dropTargetIndex = null;
    pendingDragTabId = null;
    if (dropWorkspaceId) {
      const el = document.querySelector(`[data-workspace-id="${dropWorkspaceId}"]`);
      el?.classList.remove('drop-target');
      dropWorkspaceId = null;
    }
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    if (cursorBadge) {
      cursorBadge.remove();
      cursorBadge = null;
    }
  }
</script>

<div class="tabs-bar" bind:this={tabsBarEl} data-tauri-drag-region>
  {#each pane.tabs as tab, index (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {@const shellState = tab.id !== pane.active_tab_id ? activityStore.getShellState(tab.id) : undefined}
    {@const hasActivity = tab.id !== pane.active_tab_id && activityStore.hasActivity(tab.id)}
    <div
      class="tab"
      class:active={tab.id === pane.active_tab_id}
      class:unclamped={editingId === tab.id || tab.custom_name}
      class:activity={!shellState && hasActivity}
      class:completed={shellState?.state === 'completed' && shellState?.exitCode === 0}
      class:failed={shellState?.state === 'completed' && shellState?.exitCode !== 0}
      class:prompt={shellState?.state === 'prompt'}
      class:dragging={dragTabId === tab.id}
      class:drop-before={dropTargetIndex === index && dropSide === 'before' && dragTabId !== tab.id}
      class:drop-after={dropTargetIndex === index && dropSide === 'after' && dragTabId !== tab.id}
      data-tab-id={tab.id}
      onclick={() => { if (!dragTabId) handleTabClick(tab.id); }}
      ondblclick={(e) => startEditing(tab.id, displayName(tab), e)}
      onpointerdown={(e) => handlePointerDown(e, tab.id)}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === pane.active_tab_id}
      onkeydown={(e) => e.key === 'Enter' && handleTabClick(tab.id)}
    >
      {#if editingId === tab.id}
        <div class="edit-wrapper">
          <span class="edit-sizer">{editingName || ' '}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            size="1"
            bind:value={editingName}
            bind:this={editInput}
            onblur={finishEditing}
            onkeydown={handleKeydown}
            class="edit-input"
            autofocus
          />
        </div>
      {:else}
        {#if shellState?.state === 'completed'}
          <span class="indicator" class:completed-indicator={shellState.exitCode === 0} class:failed-indicator={shellState.exitCode !== 0}>{shellState.exitCode === 0 ? '\u2713' : '\u2717'}</span>
        {:else if shellState?.state === 'prompt'}
          <span class="indicator prompt-indicator">\u203A</span>
        {:else if hasActivity}
          <span class="activity-dot"></span>
        {/if}
        {#if tab.pinned_ssh_command}
          <span class="pin-indicator" title="Pinned session">&#x1F4CC;</span>
        {/if}
        <span class="tab-name">{displayName(tab)}</span>
        <div class="tab-actions">
          <button
            class="tab-btn duplicate-btn"
            onclick={(e) => handleDuplicateTab(tab.id, e)}
            title="Duplicate tab ({modLabel}+Shift+T)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <path d="M7 3V1.5A.5.5 0 006.5 1H1.5a.5.5 0 00-.5.5v5a.5.5 0 00.5.5H3" />
            </svg>
          </button>
          <button
            class="tab-btn close-btn"
            onclick={(e) => handleCloseTab(tab.id, e)}
            title="Close tab ({modLabel}+W)"
          >
            &times;
          </button>
        </div>
      {/if}
    </div>
  {/each}

  <button class="new-tab-btn" onclick={handleNewTab} title="New tab ({modLabel}+T)">
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
    -webkit-app-region: drag;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 5px 10px;
    border: 1px solid var(--tab-border);
    border-radius: 4px;
    cursor: pointer;
    max-width: 180px;
    transition: background 0.1s, padding-right 0.15s ease, border-color 0.1s;
    -webkit-app-region: no-drag;
  }

  .tab.unclamped {
    max-width: none;
  }

  .tab:hover {
    background: var(--bg-light);
    padding-right: 2px;
  }

  .tab.active {
    background: var(--bg-dark);
    box-shadow: inset 0 -2px 0 var(--tab-border-active);
  }

  .tab.activity {
    border-color: var(--tab-border-activity);
  }

  .tab.completed {
    border-color: var(--green, #9ece6a);
  }

  .tab.failed {
    border-color: var(--red, #f7768e);
  }

  .tab.prompt {
    border-color: var(--yellow, #e0af68);
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
    padding: 5px 10px;
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--fg);
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  :global(.drag-cursor-badge) {
    position: fixed;
    pointer-events: none;
    z-index: 10001;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--green, #9ece6a);
    color: #1a1b26;
    font-size: 13px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    font-family: -apple-system, system-ui, sans-serif;
  }

  .pin-indicator {
    flex-shrink: 0;
    font-size: 9px;
    margin-right: 3px;
    opacity: 0.6;
    line-height: 1;
  }

  .activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    margin-right: 4px;
  }

  .indicator {
    flex-shrink: 0;
    margin-right: 4px;
    font-size: 10px;
    font-weight: bold;
    line-height: 1;
  }

  .completed-indicator {
    color: var(--green, #9ece6a);
  }

  .failed-indicator {
    color: var(--red, #f7768e);
  }

  .prompt-indicator {
    color: var(--yellow, #e0af68);
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
    align-self: stretch;
    margin-left: 0;
    opacity: 0;
    width: 0;
    overflow: hidden;
    transition: width 0.15s ease, opacity 0.15s ease, margin-left 0.15s ease;
  }

  .tab:hover .tab-actions {
    opacity: 1;
    width: 44px;
    margin-left: 6px;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
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

  .edit-wrapper {
    display: grid;
    align-items: center;
    overflow: hidden;
  }

  .edit-wrapper > * {
    grid-area: 1 / 1;
    font-size: 12px;
    padding: 0 4px;
    font-family: inherit;
  }

  .edit-sizer {
    visibility: hidden;
    white-space: pre;
    min-width: 1ch;
  }

  .edit-input {
    width: 100%;
    min-width: 0;
    padding: 0 4px;
    border: none;
    outline: none;
    background: none;
    color: inherit;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 0;
  }

  .new-tab-btn {
    padding: 4px 10px;
    margin-left: 5px;
    border-radius: 4px;
    color: var(--fg-dim);
    font-size: 14px;
    -webkit-app-region: no-drag;
  }

  .new-tab-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }
</style>
