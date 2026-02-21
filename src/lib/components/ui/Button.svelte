<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost';
    children: Snippet;
  }

  let { variant = 'secondary', children, ...rest }: Props = $props();
</script>

<button class="btn {variant}" {...rest}>
  {@render children()}
</button>

<style>
  .btn {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary {
    background: var(--accent);
    color: var(--bg-dark);
    border: none;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .secondary {
    background: transparent;
    border: 1px solid var(--bg-light);
    color: var(--fg-dim);
  }

  .secondary:hover:not(:disabled) {
    background: var(--bg-light);
    color: var(--fg);
  }

  .ghost {
    background: transparent;
    border: none;
    color: var(--fg-dim);
  }

  .ghost:hover:not(:disabled) {
    color: var(--fg);
  }
</style>
