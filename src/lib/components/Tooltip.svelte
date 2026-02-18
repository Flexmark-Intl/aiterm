<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    children: Snippet;
  }

  let { text, children }: Props = $props();

  let visible = $state(false);
  let wrapperEl = $state<HTMLElement | null>(null);
  let tipEl = $state<HTMLElement | null>(null);
  let style = $state('');

  function show() {
    if (!wrapperEl || !tipEl) return;
    visible = true;

    // Let the browser lay out the bubble at max-content, then measure + clamp.
    requestAnimationFrame(() => {
      if (!wrapperEl || !tipEl) return;
      const anchor = wrapperEl.getBoundingClientRect();
      const tip = tipEl.getBoundingClientRect();
      const pad = 8; // viewport edge padding

      // Horizontal: center on anchor, clamp to viewport
      let left = anchor.left + anchor.width / 2 - tip.width / 2;
      left = Math.max(pad, Math.min(left, window.innerWidth - tip.width - pad));

      // Vertical: prefer above, fall below if no room
      let top = anchor.top - tip.height - 6;
      if (top < pad) {
        top = anchor.bottom + 6;
      }

      style = `left:${left}px;top:${top}px`;
    });
  }

  function hide() {
    visible = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="tooltip-wrapper"
  bind:this={wrapperEl}
  onmouseenter={show}
  onmouseleave={hide}
>
  {@render children()}
</span>

<span
  class="tooltip-bubble"
  class:visible
  bind:this={tipEl}
  {style}
>
  {text}
</span>

<style>
  .tooltip-wrapper {
    display: inline-flex;
    align-items: center;
  }

  .tooltip-bubble {
    position: fixed;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    color: var(--fg);
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-line;
    padding: 6px 10px;
    border-radius: 5px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.12s;
    z-index: 9999;
  }

  .tooltip-bubble.visible {
    opacity: 1;
  }
</style>
