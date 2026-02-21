<script lang="ts">
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import IconButton from '$lib/components/ui/IconButton.svelte';

  interface Props {
    tabId: string;
  }

  let { tabId }: Props = $props();

  let query = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (terminalsStore.searchVisibleFor === tabId && inputRef) {
      inputRef.focus();
      inputRef.select();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      terminalsStore.hideSearch(tabId);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      terminalsStore.findPrevious(tabId, query);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      terminalsStore.findNext(tabId, query);
    }
  }

  function close() {
    terminalsStore.hideSearch(tabId);
  }
</script>

{#if terminalsStore.searchVisibleFor === tabId}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="search-bar" onkeydown={handleKeydown}>
    <input
      type="text"
      bind:value={query}
      bind:this={inputRef}
      placeholder="Find..."
      class="search-input"
      oninput={() => {
        if (query) terminalsStore.findNext(tabId, query);
      }}
    />
    <IconButton
      tooltip="Previous match (Shift+Enter)"
      style="font-size:12px;line-height:1"
      onclick={() => terminalsStore.findPrevious(tabId, query)}
    >&#x25B2;</IconButton>
    <IconButton
      tooltip="Next match (Enter)"
      style="font-size:12px;line-height:1"
      onclick={() => terminalsStore.findNext(tabId, query)}
    >&#x25BC;</IconButton>
    <IconButton
      tooltip="Close (Escape)"
      style="font-size:16px"
      onclick={close}
    >&times;</IconButton>
  </div>
{/if}

<style>
  .search-bar {
    position: absolute;
    top: 4px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 2px;
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    padding: 4px 6px;
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .search-input {
    width: 180px;
    padding: 4px 8px;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    color: var(--fg);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--fg-dim);
  }

</style>
