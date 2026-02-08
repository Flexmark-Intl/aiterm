<script lang="ts">
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  onmousedown={handleBackdropClick}
  oncontextmenu={(e) => { e.preventDefault(); handleBackdropClick(e); }}
  onkeydown={handleKeydown}
>
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
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
  }

  .context-menu {
    position: fixed;
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
