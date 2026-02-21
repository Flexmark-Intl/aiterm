<script lang="ts">
  interface Props {
    color?: 'accent' | 'green' | 'red' | 'yellow';
    title?: string;
  }

  let { color = 'accent', title }: Props = $props();
</script>

<span class="status-dot {color}" {title}></span>

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
