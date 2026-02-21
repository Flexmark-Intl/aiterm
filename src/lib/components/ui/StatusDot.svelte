<script lang="ts">
  import Tooltip from '$lib/components/Tooltip.svelte';

  interface Props {
    color?: 'accent' | 'green' | 'red' | 'yellow';
    tooltip?: string;
  }

  let { color = 'accent', tooltip }: Props = $props();
</script>

{#if tooltip}
  <Tooltip text={tooltip}>
    <span class="status-dot {color}"></span>
  </Tooltip>
{:else}
  <span class="status-dot {color}"></span>
{/if}

<style>
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .accent { background: var(--accent); }
  .green { background: var(--green); }
  .red { background: var(--red); }
  .yellow { background: var(--yellow); }
</style>
