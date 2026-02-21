<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import type { Tab, Pane } from '$lib/tauri/types';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { activityStore } from '$lib/stores/activity.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import type { OscState } from '$lib/stores/terminals.svelte';
  import { modLabel } from '$lib/utils/platform';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { getCompiledTitlePatterns, extractDirFromTitle } from '$lib/utils/promptPattern';
  import { onVariablesChange, interpolateVariables } from '$lib/stores/triggers.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import StatusDot from '$lib/components/ui/StatusDot.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';

  interface Props {
    workspaceId: string;
    pane: Pane;
  }

  let { workspaceId, pane }: Props = $props();

  let archiveDropdownOpen = $state(false);
  let archiveDropdownEl = $state<HTMLElement | null>(null);
  let archiveDropdownPos = $state({ top: 0, left: 0 });
  const archivedTabs = $derived(workspacesStore.workspaces.find(w => w.id === workspaceId)?.archived_tabs ?? []);

  let editingId = $state<string | null>(null);
  let editingName = $state('');
  let editingOriginalName = '';
  let editInput = $state<HTMLInputElement | null>(null);

  // Track OSC titles for tabs in this pane.
  // Seed from existing terminal state so titles survive component recreation
  // (e.g., workspace switch destroys and recreates SplitPane → TerminalTabs).
  let oscTitles = $state<Map<string, string>>(new Map());
  // svelte-ignore state_referenced_locally -- intentional one-time seed from existing terminal state; live updates come from onOscChange subscription below
  for (const tab of pane.tabs) {
    const osc = terminalsStore.getOsc(tab.id);
    // svelte-ignore state_referenced_locally
    if (osc?.title) oscTitles.set(tab.id, osc.title);
  }

  const unsubOsc = terminalsStore.onOscChange((tabId: string, osc: OscState) => {
    if (osc.title && pane.tabs.some(t => t.id === tabId)) {
      oscTitles = new Map(oscTitles);
      oscTitles.set(tabId, osc.title);
    }
  });
  onDestroy(unsubOsc);

  // Track trigger variable changes for reactive tab title updates
  let varVersion = $state(0);
  const unsubVars = onVariablesChange((tabId: string) => {
    if (pane.tabs.some(t => t.id === tabId)) {
      varVersion++;
    }
  });
  onDestroy(unsubVars);

  function displayName(tab: Tab): string {
    // Read varVersion to subscribe this derived value to variable changes
    void varVersion;
    if (tab.custom_name) {
      let result = tab.name;
      if (result.includes('%title') || result.includes('%dir')) {
        const oscTitle = oscTitles.get(tab.id);
        if (!oscTitle && !result.includes('%')) return result;
        if (oscTitle) {
          if (result.includes('%title')) result = result.replace('%title', oscTitle);
          if (result.includes('%dir')) {
            const patterns = getCompiledTitlePatterns(preferencesStore.promptPatterns);
            result = result.replace('%dir', extractDirFromTitle(oscTitle, patterns));
          }
        }
      }
      // Interpolate %varName from trigger variables
      if (result.includes('%')) {
        result = interpolateVariables(tab.id, result, true);
      }
      return result;
    }
    return oscTitles.get(tab.id) ?? tab.name;
  }

  async function startEditing(tab: Tab, e: MouseEvent) {
    e.stopPropagation();
    if (editingId === tab.id) return; // Already editing — let browser handle word selection
    editingId = tab.id;
    editingName = tab.custom_name ? tab.name : displayName(tab);
    editingOriginalName = editingName;
    await tick();
    editInput?.select();
  }

  async function finishEditing() {
    if (editingId) {
      const trimmed = editingName.trim();
      if (trimmed) {
        // Skip rename if nothing changed — preserves original custom_name state
        if (trimmed !== editingOriginalName) {
          await workspacesStore.renameTab(workspaceId, pane.id, editingId, trimmed, true);
        }
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

  async function handleArchiveTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    const tab = pane.tabs.find(t => t.id === tabId);
    if (!tab) return;
    const name = displayName(tab);
    const ws = workspacesStore.activeWorkspace;

    if (pane.tabs.length > 1) {
      await workspacesStore.archiveTab(workspaceId, pane.id, tabId, name);
    } else if (ws && ws.panes.length > 1) {
      // Last tab in pane — archive then delete pane
      await workspacesStore.archiveTab(workspaceId, pane.id, tabId, name);
      await workspacesStore.deletePane(workspaceId, pane.id);
    } else {
      // Last tab in last pane — archive then create fresh tab
      await workspacesStore.archiveTab(workspaceId, pane.id, tabId, name);
      await workspacesStore.createTab(workspaceId, pane.id, 'Terminal 1');
    }
  }

  async function handleRestoreArchivedTab(tabId: string) {
    await workspacesStore.restoreArchivedTab(workspaceId, tabId);
    archiveDropdownOpen = false;
  }

  async function handleDeleteArchivedTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    await workspacesStore.deleteArchivedTab(workspaceId, tabId);
  }

  function handleArchiveDropdownClickOutside(e: MouseEvent) {
    if (archiveDropdownEl && !archiveDropdownEl.contains(e.target as Node)) {
      archiveDropdownOpen = false;
    }
  }

  function handleArchiveDropdownKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') archiveDropdownOpen = false;
  }

  $effect(() => {
    if (archiveDropdownOpen) {
      document.addEventListener('click', handleArchiveDropdownClickOutside, true);
      document.addEventListener('keydown', handleArchiveDropdownKeydown);
      return () => {
        document.removeEventListener('click', handleArchiveDropdownClickOutside, true);
        document.removeEventListener('keydown', handleArchiveDropdownKeydown);
      };
    }
  });

  async function handleDuplicateTab(tabId: string, e: MouseEvent) {
    e.stopPropagation();
    await workspacesStore.duplicateTab(workspaceId, pane.id, tabId, { shallow: e.altKey });
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
    scrollTabIntoView(tabId);
  }

  function scrollTabIntoView(tabId: string) {
    requestAnimationFrame(() => {
      const el = tabsBarEl?.querySelector<HTMLElement>(`[data-tab-id="${tabId}"]`);
      if (!el || !tabsBarEl) return;
      const barRect = tabsBarEl.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      // If tab is fully visible, do nothing
      if (tabRect.left >= barRect.left && tabRect.right <= barRect.right) return;
      // Scroll so the tab is roughly centered
      const tabCenter = el.offsetLeft + el.offsetWidth / 2;
      const barCenter = tabsBarEl.clientWidth / 2;
      tabsBarEl.scrollTo({ left: tabCenter - barCenter, behavior: 'smooth' });
    });
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
  let justDragged = false;
  let ghost: HTMLElement | null = null;
  let cursorBadge: HTMLElement | null = null;
  let tabsBarEl: HTMLElement;

  // Scroll active tab into view when it changes (e.g. Cmd+1-9 shortcuts)
  $effect(() => {
    const activeId = pane.active_tab_id;
    if (activeId) scrollTabIntoView(activeId);
  });

  function handlePointerDown(e: PointerEvent, tabId: string) {
    // Only primary button, skip if editing or clicking close button
    if (e.button !== 0 || editingId === tabId) return;
    if ((e.target as HTMLElement).closest('.close-btn') || (e.target as HTMLElement).closest('.duplicate-btn') || (e.target as HTMLElement).closest('.archive-btn')) return;
    // Alt+click tab → shallow duplicate (name, cwd, history, variables only)
    if (e.altKey) {
      e.preventDefault();
      workspacesStore.duplicateTab(workspaceId, pane.id, tabId, { shallow: true });
      return;
    }
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

    const wasDragging = !!dragTabId;

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

    // After any drag, re-focus the active terminal. During the drag the pointer
    // capture moves focus away from the xterm canvas, and the DOM reorder of
    // slot elements can corrupt xterm.js rendering. Wait for Svelte to settle
    // the DOM, then refresh + focus.
    if (wasDragging && pane.active_tab_id) {
      justDragged = true;
      // Clear flag after the click event that follows pointerup
      requestAnimationFrame(() => { justDragged = false; });
      tick().then(() => {
        const instance = terminalsStore.get(pane.active_tab_id!);
        if (instance) {
          instance.terminal.refresh(0, instance.terminal.rows - 1);
          instance.terminal.focus();
        }
      });
    }
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

<div class="tabs-bar" bind:this={tabsBarEl} data-tauri-drag-region
  onwheel={(e) => { if (tabsBarEl) { e.preventDefault(); tabsBarEl.scrollLeft += e.deltaY || e.deltaX; } }}
>
  {#if archivedTabs.length > 0}
    <div class="archive-list-wrapper" bind:this={archiveDropdownEl}>
      <Tooltip text="Archived tabs ({archivedTabs.length})">
        <button
          class="archive-list-btn"
          onclick={(e) => {
            e.stopPropagation();
            if (!archiveDropdownOpen) {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              archiveDropdownPos = { top: rect.bottom + 2, left: rect.left };
            }
            archiveDropdownOpen = !archiveDropdownOpen;
          }}
        >
          <Icon name="archive" size={12} /> {archivedTabs.length}
        </button>
      </Tooltip>
      {#if archiveDropdownOpen}
        <div class="archive-dropdown" style="top: {archiveDropdownPos.top}px; left: {archiveDropdownPos.left}px;">
          {#each archivedTabs as archivedTab (archivedTab.id)}
            <div class="archive-item">
              <button
                class="archive-item-name"
                onclick={() => handleRestoreArchivedTab(archivedTab.id)}
              >
                {archivedTab.name}
              </button>
              <Tooltip text="Restore">
                <button
                  class="archive-item-btn restore-btn"
                  onclick={() => handleRestoreArchivedTab(archivedTab.id)}
                >&#x21A9;</button>
              </Tooltip>
              <Tooltip text="Delete permanently">
                <button
                  class="archive-item-btn delete-btn"
                  onclick={(e) => handleDeleteArchivedTab(archivedTab.id, e)}
                >&times;</button>
              </Tooltip>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#each pane.tabs as tab, index (tab.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    {@const isEditor = tab.tab_type === 'editor'}
    {@const isDiff = tab.tab_type === 'diff'}
    {@const shellState = !isEditor && tab.id !== pane.active_tab_id ? activityStore.getShellState(tab.id) : undefined}
    {@const hasActivity = !isEditor && tab.id !== pane.active_tab_id && activityStore.hasActivity(tab.id)}
    {@const tabState = !isEditor && tab.id !== pane.active_tab_id ? activityStore.getTabState(tab.id) : undefined}
    <div
      class="tab"
      class:active={tab.id === pane.active_tab_id}
      class:unclamped={editingId === tab.id || tab.custom_name || oscTitles.has(tab.id)}
      class:activity={!shellState && !tabState && hasActivity}
      class:completed={!tabState && shellState?.state === 'completed' && shellState?.exitCode === 0}
      class:failed={!tabState && shellState?.state === 'completed' && shellState?.exitCode !== 0}
      class:tab-alert={tabState === 'alert'}
      class:tab-question={tabState === 'question'}
      class:dragging={dragTabId === tab.id}
      class:drop-before={dropTargetIndex === index && dropSide === 'before' && dragTabId !== tab.id}
      class:drop-after={dropTargetIndex === index && dropSide === 'after' && dragTabId !== tab.id}
      data-tab-id={tab.id}
      onclick={() => { if (!dragTabId && !justDragged) handleTabClick(tab.id); }}
      ondblclick={(e) => startEditing(tab, e)}
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
            placeholder="%title, %dir, or %varName for dynamic name"
            autofocus
          />
        </div>
      {:else}
        {#if isDiff}
          <span class="editor-icon" title="Diff">&#x21C4;</span>
        {:else if isEditor}
          <span class="editor-icon" title="Editor">&#x2630;</span>
        {:else if tabState === 'alert'}
          <span class="indicator alert-indicator">&#x2757;</span>
        {:else if tabState === 'question'}
          <span class="indicator question-indicator">&#x2753;</span>
        {:else if shellState?.state === 'completed'}
          <span class="indicator" class:completed-indicator={shellState.exitCode === 0} class:failed-indicator={shellState.exitCode !== 0}>{shellState.exitCode === 0 ? '\u2713' : '\u2717'}</span>
        {:else if hasActivity}
          <span class="indicator"><StatusDot color="accent" /></span>
        {/if}
        {#if !isEditor && (tab.auto_resume_ssh_command || tab.auto_resume_cwd)}
          <span class="auto-resume-indicator" title="Auto-resume enabled">&#x21BB;</span>
        {/if}
        <span class="tab-name">{displayName(tab)}</span>
        <div class="tab-actions" class:single-action={isEditor || isDiff} class:triple-action={!isEditor && !isDiff}>
          {#if !isEditor && !isDiff}
            <Tooltip text="Archive tab">
              <button
                class="tab-btn archive-btn"
                onclick={(e) => handleArchiveTab(tab.id, e)}
              ><Icon name="archive" size={11} /></button>
            </Tooltip>
            <button
              class="tab-btn duplicate-btn"
              onclick={(e) => handleDuplicateTab(tab.id, e)}
              title="Duplicate tab ({modLabel}+Shift+T)"
            >&#x29C9;</button>
          {/if}
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

  <div class="tabs-spacer" data-tauri-drag-region></div>

  {#if pane.active_tab_id}
    {@const activeTabObj = pane.tabs.find(t => t.id === pane.active_tab_id)}
    {#if activeTabObj?.notes}
      <button
        class="notes-indicator"
        onclick={() => workspacesStore.toggleNotes(pane.active_tab_id!)}
        title="Toggle notes ({modLabel}+E)"
      >
        <Icon name="notes" />
      </button>
    {/if}
  {/if}
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
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tabs-bar::-webkit-scrollbar {
    display: none;
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
    flex-shrink: 0;
  }

  .tab.unclamped {
    max-width: 50%;
  }

  .tab:hover {
    background: var(--bg-light);
    padding-right: 2px;
  }

  .tab.active {
    background: var(--bg-dark);
    border-color: var(--tab-border-active);
  }

  .tab.activity {
    box-shadow: inset 0 -2px 0 var(--tab-border-activity);
  }

  .tab.completed {
    box-shadow: inset 0 -2px 0 var(--green, #9ece6a);
  }

  .tab.failed {
    box-shadow: inset 0 -2px 0 var(--red, #f7768e);
  }

  .tab.tab-alert {
    box-shadow: inset 0 -2px 0 var(--red, #f7768e);
  }

  .tab.tab-question {
    box-shadow: inset 0 -2px 0 var(--yellow, #e0af68);
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

  .auto-resume-indicator {
    flex-shrink: 0;
    font-size: 10px;
    margin-right: 3px;
    opacity: 0.6;
    line-height: 1;
  }

  .editor-icon {
    flex-shrink: 0;
    font-size: 10px;
    margin-right: 4px;
    line-height: 1;
    opacity: 0.7;
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

  .alert-indicator {
    font-size: 11px;
  }

  .question-indicator {
    font-size: 11px;
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

  .tab:hover .tab-actions.triple-action {
    width: 66px;
  }

  .tab:hover .tab-actions.single-action {
    width: 22px;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 18px;
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
    flex-shrink: 0;
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

  .tabs-spacer {
    flex: 1;
    min-width: 0;
    -webkit-app-region: drag;
  }

  .notes-indicator {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    margin-right: 4px;
    color: var(--fg-dim);
    border-radius: 4px;
    font-size: 13px;
    -webkit-app-region: no-drag;
    transition: background 0.1s, color 0.1s;
  }

  .notes-indicator:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .archive-list-wrapper {
    position: relative;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .archive-list-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 8px;
    margin-left: 4px;
    border-radius: 4px;
    color: var(--fg-dim);
    font-size: 11px;
    white-space: nowrap;
    -webkit-app-region: no-drag;
  }

  .archive-list-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .archive-dropdown {
    position: fixed;
    z-index: 1000;
    min-width: 200px;
    max-width: 320px;
    max-height: 300px;
    overflow-y: auto;
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: 4px;
  }

  .archive-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .archive-item:hover {
    background: var(--bg-light);
  }

  .archive-item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--fg);
    text-align: left;
    padding: 2px 0;
    background: none;
    border: none;
    cursor: pointer;
  }

  .archive-item-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 3px;
    font-size: 13px;
    color: var(--fg-dim);
    transition: background 0.1s, color 0.1s;
  }

  .archive-item-btn:hover {
    background: var(--bg-medium);
    color: var(--fg);
  }

  .archive-item-btn.delete-btn:hover {
    color: var(--red, #f7768e);
  }
</style>
