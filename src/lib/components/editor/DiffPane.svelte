<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { MergeView } from '@codemirror/merge';
  import { EditorView, lineNumbers, highlightSpecialChars, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import type { DiffContext } from '$lib/tauri/types';
  import * as commands from '$lib/tauri/commands';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { tokyoNightExtension } from '$lib/utils/editorTheme';
  import { dispatch as dispatchToast } from '$lib/stores/notificationDispatch';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { error as logError } from '@tauri-apps/plugin-log';

  interface Props {
    workspaceId: string;
    paneId: string;
    tabId: string;
    visible: boolean;
    diffContext: DiffContext;
  }

  let { workspaceId, paneId, tabId, visible, diffContext }: Props = $props();

  let containerRef: HTMLDivElement;
  let mergeView: MergeView | null = null;
  let accepting = $state(false);
  let rejecting = $state(false);

  function attachToSlot() {
    const slot = document.querySelector(`[data-terminal-slot="${tabId}"]`) as HTMLElement;
    if (slot && containerRef && containerRef.parentElement !== slot) {
      slot.appendChild(containerRef);
    }
  }

  function handleSlotReady(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.tabId === tabId) {
      attachToSlot();
    }
  }

  onMount(() => {
    attachToSlot();
    window.addEventListener('terminal-slot-ready', handleSlotReady);

    const editorTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${preferencesStore.fontSize}px`,
      },
      '.cm-scroller': {
        fontFamily: `"${preferencesStore.fontFamily}", Monaco, "Courier New", monospace`,
        overflow: 'auto',
      },
    });

    const diffContentEl = containerRef.querySelector('.diff-content') as HTMLElement;
    if (!diffContentEl) return;

    mergeView = new MergeView({
      a: {
        doc: diffContext.old_content,
        extensions: [
          EditorState.readOnly.of(true),
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLine(),
          ...tokyoNightExtension,
          editorTheme,
        ],
      },
      b: {
        doc: diffContext.new_content,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLine(),
          ...tokyoNightExtension,
          editorTheme,
        ],
      },
      parent: diffContentEl,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });

  });

  onDestroy(() => {
    window.removeEventListener('terminal-slot-ready', handleSlotReady);
    mergeView?.destroy();
  });

  async function handleAccept() {
    accepting = true;
    try {
      const content = mergeView ? mergeView.b.state.doc.toString() : diffContext.new_content;
      await commands.writeFile(diffContext.file_path, content);
      await commands.claudeCodeRespond(diffContext.request_id, {
        result: 'FILE_SAVED',
        filePath: diffContext.file_path,
        content,
      });
      await workspacesStore.deleteTab(workspaceId, paneId, tabId);
    } catch (err) {
      accepting = false;
      dispatchToast('Save failed', String(err), 'error');
      logError(`DiffPane save failed: ${err}`);
    }
  }

  async function handleReject() {
    rejecting = true;
    try {
      await commands.claudeCodeRespond(diffContext.request_id, { result: 'DIFF_REJECTED' });
      await workspacesStore.deleteTab(workspaceId, paneId, tabId);
    } catch (err) {
      rejecting = false;
      logError(`DiffPane reject failed: ${err}`);
    }
  }
</script>

<div
  class="diff-pane"
  class:hidden={!visible}
  bind:this={containerRef}
>
  <div class="diff-toolbar">
    <span class="diff-file-path">{diffContext.file_path}</span>
    <div class="diff-actions">
      <button class="btn-reject" onclick={handleReject} disabled={accepting || rejecting}>
        {rejecting ? 'Rejecting...' : 'Reject'}
      </button>
      <button class="btn-accept" onclick={handleAccept} disabled={accepting || rejecting}>
        {accepting ? 'Saving...' : 'Accept'}
      </button>
    </div>
  </div>
  <div class="diff-content"></div>
</div>

<style>
  .diff-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    min-width: 0;
    background: var(--bg-dark);
    overflow: hidden;
  }

  .diff-pane.hidden {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
  }

  .diff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--bg-medium);
    border-bottom: 1px solid var(--bg-light);
    flex-shrink: 0;
  }

  .diff-file-path {
    font-size: 12px;
    color: var(--fg-dim);
    font-family: Menlo, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
  }

  .diff-actions {
    display: flex;
    gap: 8px;
  }

  .btn-reject, .btn-accept {
    padding: 4px 12px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  .btn-reject {
    background: var(--bg-light);
    color: var(--fg);
  }

  .btn-reject:hover:not(:disabled) {
    background: var(--red, #f7768e);
    color: white;
  }

  .btn-accept {
    background: var(--accent);
    color: #1a1b26;
  }

  .btn-accept:hover:not(:disabled) {
    background: var(--blue, #89b4fa);
  }

  .btn-reject:disabled, .btn-accept:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .diff-content {
    flex: 1;
    position: relative;
    min-height: 0;
    overflow: hidden;
  }

  .diff-pane :global(.cm-mergeView) {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .diff-pane :global(.cm-mergeViewEditors) {
    height: 100%;
  }

  .diff-pane :global(.cm-mergeViewEditor) {
    min-height: 0;
  }

  .diff-pane :global(.cm-editor) {
    height: 100%;
  }
</style>
