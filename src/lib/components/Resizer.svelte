<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Props {
    direction: 'horizontal' | 'vertical';
    onresize: (delta: number) => void;
    onresizeend?: () => void;
  }

  let { direction, onresize, onresizeend }: Props = $props();

  let isDragging = $state(false);
  let startPos = 0;

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    isDragging = true;
    startPos = direction === 'horizontal' ? e.clientX : e.clientY;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = currentPos - startPos;
    startPos = currentPos;

    onresize(delta);
  }

  function handleMouseUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    onresizeend?.();
  }

  onDestroy(() => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="resizer {direction}"
  class:dragging={isDragging}
  onmousedown={handleMouseDown}
  role="separator"
  aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
></div>

<style>
  .resizer {
    flex-shrink: 0;
    background: var(--bg-light);
    transition: background 0.1s;
    position: relative;
  }

  .resizer::after {
    content: '';
    position: absolute;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.1s;
  }

  .resizer:hover,
  .resizer.dragging {
    background: var(--accent);
  }

  .resizer:hover::after,
  .resizer.dragging::after {
    opacity: 0.3;
  }

  .resizer.horizontal {
    width: 4px;
    cursor: col-resize;
  }

  .resizer.horizontal::after {
    top: 0;
    bottom: 0;
    left: -4px;
    right: -4px;
  }

  .resizer.vertical {
    height: 4px;
    cursor: row-resize;
  }

  .resizer.vertical::after {
    left: 0;
    right: 0;
    top: -4px;
    bottom: -4px;
  }
</style>
