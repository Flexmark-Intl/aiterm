<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Tooltip from '$lib/components/Tooltip.svelte';

  interface Props extends HTMLButtonAttributes {
    tooltip: string;
    size?: number;
    active?: boolean;
    danger?: boolean;
    children: Snippet;
  }

  let { tooltip, size, active = false, danger = false, children, style, class: extraClass, ...rest }: Props = $props();

  const mergedStyle = $derived(
    [size ? `--icon-btn-size:${size}px` : '', style ?? ''].filter(Boolean).join(';') || undefined
  );
</script>

<Tooltip text={tooltip}>
  <button
    class="icon-btn {extraClass ?? ''}"
    class:active
    class:danger
    style={mergedStyle}
    {...rest}
  >
    {@render children()}
  </button>
</Tooltip>

<style>
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: var(--icon-btn-size, 22px);
    min-height: var(--icon-btn-size, 22px);
    padding: 4px;
    color: var(--fg-dim);
    background: none;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .icon-btn:hover {
    background: var(--icon-btn-hover, var(--bg-light));
    color: var(--fg);
  }

  .icon-btn.active {
    color: var(--accent);
  }

  .icon-btn.danger:hover {
    color: #f7768e;
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .icon-btn:disabled:hover {
    background: none;
    color: var(--fg-dim);
  }
</style>
