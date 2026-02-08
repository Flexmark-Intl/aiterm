<script lang="ts">
  import type { SplitNode, Pane } from '$lib/tauri/types';
  import SplitPane from './SplitPane.svelte';
  import SplitContainer from './SplitContainer.svelte';
  import Resizer from '../Resizer.svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';

  interface Props {
    node: SplitNode;
    workspaceId: string;
    panes: Pane[];
  }

  let { node, workspaceId, panes }: Props = $props();
  let containerEl = $state<HTMLElement | null>(null);

  function findPane(paneId: string): Pane | undefined {
    return panes.find(p => p.id === paneId);
  }

  function handleResize(splitId: string, direction: 'horizontal' | 'vertical', delta: number) {
    if (!containerEl || node.type !== 'split') return;
    const containerSize = direction === 'horizontal'
      ? containerEl.clientWidth
      : containerEl.clientHeight;
    if (containerSize === 0) return;

    const deltaRatio = delta / containerSize;
    const newRatio = Math.max(0.1, Math.min(0.9, node.ratio + deltaRatio));

    workspacesStore.setSplitRatioLocal(workspaceId, splitId, newRatio);
  }

  function handleResizeEnd() {
    if (node.type !== 'split') return;
    workspacesStore.persistSplitRatio(workspaceId, node.id, node.ratio);
  }
</script>

{#if node.type === 'leaf'}
  {@const pane = findPane(node.pane_id)}
  {#if pane}
    <SplitPane
      {workspaceId}
      {pane}
      isActive={pane.id === workspacesStore.activeWorkspace?.active_pane_id}
      showHeader={panes.length > 1}
    />
  {/if}
{:else}
  <div
    class="split-container {node.direction}"
    bind:this={containerEl}
  >
    <div class="split-child" style="flex: {node.ratio}">
      <SplitContainer
        node={node.children[0]}
        {workspaceId}
        {panes}
      />
    </div>

    <Resizer
      direction={node.direction}
      onresize={(delta) => handleResize(node.type === 'split' ? node.id : '', node.type === 'split' ? node.direction : 'horizontal', delta)}
      onresizeend={handleResizeEnd}
    />

    <div class="split-child" style="flex: {1 - node.ratio}">
      <SplitContainer
        node={node.children[1]}
        {workspaceId}
        {panes}
      />
    </div>
  </div>
{/if}

<style>
  .split-container {
    display: flex;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .split-container.horizontal {
    flex-direction: row;
  }

  .split-container.vertical {
    flex-direction: column;
  }

  .split-child {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
