<script lang="ts">
  import { onMount } from 'svelte';

  interface MenuItem {
    label: string;
    shortcut?: string;
    action: () => void;
    disabled?: boolean;
    separator?: boolean;
  }

  interface Props {
    items: MenuItem[];
    x: number;
    y: number;
    onclose: () => void;
  }

  let { items, x, y, onclose }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);

  // Adjust position if menu would overflow viewport
  const adjustedPos = $derived.by(() => {
    if (!menuEl) return { x, y };
    const rect = menuEl.getBoundingClientRect();
    return {
      x: x + rect.width > window.innerWidth ? x - rect.width : x,
      y: y + rect.height > window.innerHeight ? y - rect.height : y,
    };
  });

  function handleItemClick(item: MenuItem) {
    if (item.disabled) return;
    item.action();
    onclose();
  }

  // Window-level listeners for robust dismissal (avoids pointer-events
  // inheritance issues when rendered inside pointer-events:none containers)
  onMount(() => {
    function onMousedown(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        onclose();
      }
    }
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      }
    }
    function onContextmenu(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        e.preventDefault();
        onclose();
      }
    }
    window.addEventListener('mousedown', onMousedown, true);
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('contextmenu', onContextmenu, true);
    return () => {
      window.removeEventListener('mousedown', onMousedown, true);
      window.removeEventListener('keydown', onKeydown, true);
      window.removeEventListener('contextmenu', onContextmenu, true);
    };
  });
</script>

<div
  class="context-menu"
  bind:this={menuEl}
  style="left: {adjustedPos.x}px; top: {adjustedPos.y}px"
  role="menu"
  tabindex="-1"
>
    {#each items as item}
      {#if item.separator}
        <div class="separator"></div>
      {:else}
        <button
          class="menu-item"
          class:disabled={item.disabled}
          onclick={() => handleItemClick(item)}
          role="menuitem"
          disabled={item.disabled}
        >
          <span class="menu-label">{item.label}</span>
          {#if item.shortcut}
            <span class="menu-shortcut">{item.shortcut}</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    pointer-events: auto;
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    padding: 4px;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--bg-light);
  }

  .menu-item:disabled {
    color: var(--fg-dim);
    cursor: default;
  }

  .menu-label {
    flex: 1;
  }

  .menu-shortcut {
    margin-left: 24px;
    color: var(--fg-dim);
    font-size: 12px;
  }

  .separator {
    height: 1px;
    background: var(--bg-light);
    margin: 4px 8px;
  }
</style>
