<script lang="ts">
  type Layout = 'horizontal' | 'vertical' | 'grid';

  interface Props {
    layout: Layout;
    onchange: (layout: Layout) => void;
  }

  let { layout, onchange }: Props = $props();
</script>

<div class="layout-selector" data-tauri-drag-region="false">
  <button
    class="layout-btn"
    class:active={layout === 'horizontal'}
    onclick={() => onchange('horizontal')}
    title="Horizontal split"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <rect x="8" y="2" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </button>

  <button
    class="layout-btn"
    class:active={layout === 'vertical'}
    onclick={() => onchange('vertical')}
    title="Vertical split"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="1" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <rect x="2" y="8" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </button>

  <button
    class="layout-btn"
    class:active={layout === 'grid'}
    onclick={() => onchange('grid')}
    title="Grid layout"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </button>
</div>

<style>
  .layout-selector {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg-dark);
    border-radius: 6px;
    -webkit-app-region: no-drag;
  }

  .layout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--fg-dim);
    transition: all 0.1s;
  }

  .layout-btn:hover {
    color: var(--fg);
    background: var(--bg-light);
  }

  .layout-btn.active {
    color: var(--accent);
    background: var(--bg-light);
  }
</style>
