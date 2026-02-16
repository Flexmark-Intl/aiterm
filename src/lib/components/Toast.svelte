<script lang="ts">
  import { toastStore } from '$lib/stores/toasts.svelte';
  import { fly, fade } from 'svelte/transition';
</script>

{#if toastStore.toasts.length > 0}
  <div class="toast-container">
    {#each toastStore.toasts as toast (toast.id)}
      <div
        class="toast toast-{toast.type}"
        in:fly={{ x: 300, duration: 250 }}
        out:fade={{ duration: 150 }}
      >
        <div class="toast-content">
          <div class="toast-title">{toast.title}</div>
          {#if toast.body}
            <div class="toast-body">{toast.body}</div>
          {/if}
        </div>
        <button
          class="toast-close"
          onclick={() => toastStore.removeToast(toast.id)}
          aria-label="Dismiss notification"
        >&times;</button>
        <div class="toast-progress"></div>
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
    max-width: 360px;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    position: relative;
    overflow: hidden;
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
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 2px;
  }

  .toast-body {
    font-size: 12px;
    color: #9aa5ce;
    line-height: 1.4;
    word-break: break-word;
  }

  .toast-close {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 14px;
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
    animation: toast-timer 5s linear forwards;
  }

  @keyframes toast-timer {
    from { width: 100%; }
    to { width: 0%; }
  }
</style>
