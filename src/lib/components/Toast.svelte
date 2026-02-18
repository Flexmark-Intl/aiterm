<script lang="ts">
  import { toastStore } from '$lib/stores/toasts.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { fly, fade } from 'svelte/transition';

  async function navigateToSource(tabId: string) {
    // Find which workspace/pane contains this tab
    for (const ws of workspacesStore.workspaces) {
      for (const pane of ws.panes) {
        const tab = pane.tabs.find(t => t.id === tabId);
        if (tab) {
          if (ws.id !== workspacesStore.activeWorkspaceId) {
            await workspacesStore.setActiveWorkspace(ws.id);
          }
          if (pane.active_tab_id !== tabId) {
            await workspacesStore.setActiveTab(ws.id, pane.id, tabId);
          }
          return;
        }
      }
    }
  }

  function handleToastClick(toast: typeof toastStore.toasts[0]) {
    if (toast.source?.tabId) {
      navigateToSource(toast.source.tabId);
      toastStore.removeToast(toast.id);
    }
  }
</script>

{#if toastStore.toasts.length > 0}
  <div class="toast-container" style:max-width="{preferencesStore.toastWidth}px" style:font-size="{preferencesStore.toastFontSize}px">
    {#each toastStore.toasts as toast (toast.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="toast toast-{toast.type}"
        class:clickable={!!toast.source?.tabId}
        in:fly={{ x: 300, duration: 250 }}
        out:fade={{ duration: 150 }}
        onclick={() => handleToastClick(toast)}
        onmouseenter={() => toastStore.pauseToast(toast.id)}
        onmouseleave={() => toastStore.resumeToast(toast.id)}
      >
        <div class="toast-content">
          <div class="toast-title">{toast.title}</div>
          {#if toast.body}
            <div class="toast-body">{toast.body}</div>
          {/if}
        </div>
        <button
          class="toast-close"
          onclick={(e) => { e.stopPropagation(); toastStore.removeToast(toast.id); }}
          aria-label="Dismiss notification"
        >&times;</button>
        <div class="toast-progress" style:animation-duration="{toast.duration}ms"></div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    /* max-width set via inline style from preferences */
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 14px;
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    position: relative;
    overflow: hidden;
  }

  .toast.clickable {
    cursor: pointer;
  }

  .toast.clickable:hover {
    border-color: var(--accent);
  }

  .toast-success {
    border-left: 3px solid var(--green, #9ece6a);
  }

  .toast-error {
    border-left: 3px solid var(--red, #f7768e);
  }

  .toast-info {
    border-left: 3px solid var(--cyan, #7dcfff);
  }

  .toast-content {
    flex: 1;
    min-width: 0;
  }

  .toast-title {
    font-size: inherit;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 2px;
  }

  .toast-body {
    font-size: inherit;
    color: #9aa5ce;
    line-height: 1.4;
    word-break: break-word;
  }

  .toast-close {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 1.1em;
    color: var(--fg-dim);
    border-radius: 4px;
    cursor: pointer;
  }

  .toast-close:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: var(--fg-dim);
    opacity: 0.3;
    animation: toast-timer linear forwards;
    /* duration set via inline style */
  }

  .toast:hover .toast-progress {
    animation-play-state: paused;
  }

  @keyframes toast-timer {
    from { width: 100%; }
    to { width: 0%; }
  }
</style>
