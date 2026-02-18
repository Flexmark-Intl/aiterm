<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { foldGutter, indentOnInput, bracketMatching, foldKeymap } from '@codemirror/language';
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
  import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import type { EditorFileInfo } from '$lib/tauri/types';
  import { readFile, writeFile, scpReadFile, scpWriteFile } from '$lib/tauri/commands';
  import { loadLanguageExtension, detectLanguageFromContent } from '$lib/utils/languageDetect';
  import { tokyoNightExtension } from '$lib/utils/editorTheme';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { dispatch } from '$lib/stores/notificationDispatch';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { error as logError } from '@tauri-apps/plugin-log';

  interface Props {
    workspaceId: string;
    paneId: string;
    tabId: string;
    visible: boolean;
    editorFile: EditorFileInfo;
  }

  let { workspaceId, paneId, tabId, visible, editorFile }: Props = $props();

  let containerRef: HTMLDivElement;
  let editorView: EditorView | null = null;
  let dirty = $state(false);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let originalContent = '';

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

  function handleEditorSave(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.tabId === tabId) {
      saveFile();
    }
  }

  async function saveFile() {
    if (!editorView || !dirty) return;
    const content = editorView.state.doc.toString();
    try {
      if (editorFile.is_remote && editorFile.remote_ssh_command && editorFile.remote_path) {
        await scpWriteFile(editorFile.remote_ssh_command, editorFile.remote_path, content);
      } else {
        await writeFile(editorFile.file_path, content);
      }
      dirty = false;
      originalContent = content;
      dispatch('File saved', editorFile.file_path.split('/').pop() ?? 'file', 'info');
    } catch (e) {
      dispatch('Save failed', String(e), 'error');
      logError(`Failed to save file: ${e}`);
    }
  }

  onMount(async () => {
    // Portal into slot
    attachToSlot();
    window.addEventListener('terminal-slot-ready', handleSlotReady);
    window.addEventListener('editor-save', handleEditorSave);

    // Fetch file content
    try {
      let content: string;
      if (editorFile.is_remote && editorFile.remote_ssh_command && editorFile.remote_path) {
        const result = await scpReadFile(editorFile.remote_ssh_command, editorFile.remote_path);
        content = result.content;
      } else {
        const result = await readFile(editorFile.file_path);
        content = result.content;
      }
      originalContent = content;

      // Load language extension — fall back to shebang detection
      const langId = editorFile.language ?? detectLanguageFromContent(content);
      const langExt = langId ? await loadLanguageExtension(langId) : null;

      const extensions = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        ...tokyoNightExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            dirty = update.state.doc.toString() !== originalContent;
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: `${preferencesStore.fontSize}px`,
          },
          '.cm-scroller': {
            fontFamily: `"${preferencesStore.fontFamily}", Monaco, "Courier New", monospace`,
            overflow: 'auto',
          },
        }),
        // Cmd+S handler
        keymap.of([{
          key: 'Mod-s',
          run: () => {
            saveFile();
            return true;
          },
        }]),
      ];

      if (langExt) {
        extensions.push(langExt);
      }

      editorView = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions,
        }),
        parent: containerRef,
      });

      loading = false;
    } catch (e) {
      const msg = String(e).toLowerCase();
      // Silently close tab for directories and similar non-file entries
      if (msg.includes('is_directory') || msg.includes('not a regular file') || msg.includes('is a directory')) {
        workspacesStore.deleteTab(workspaceId, paneId, tabId);
        return;
      }
      const raw = String(e);
      if (raw.startsWith('FILE_TOO_LARGE:')) {
        const sizeMb = raw.split(':')[1];
        errorMsg = `File is too large to edit (${sizeMb} MB)`;
      } else if (raw.toLowerCase().includes('binary')) {
        errorMsg = 'Binary file — cannot open in editor';
      } else {
        errorMsg = raw;
      }
      loading = false;
      logError(`Failed to load file: ${raw}`);
    }
  });

  onDestroy(() => {
    window.removeEventListener('terminal-slot-ready', handleSlotReady);
    window.removeEventListener('editor-save', handleEditorSave);
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
  });

  // Focus editor when becoming visible
  $effect(() => {
    if (visible && editorView) {
      requestAnimationFrame(() => {
        editorView?.focus();
      });
    }
  });
</script>

<div
  class="editor-container"
  class:hidden={!visible}
  bind:this={containerRef}
>
  {#if loading}
    <div class="editor-loading">Loading...</div>
  {:else if errorMsg}
    <div class="editor-error">
      <div class="error-content">
        <span class="error-icon">&#x26A0;</span>
        <span>{errorMsg}</span>
      </div>
      <button class="error-close-btn" onclick={() => workspacesStore.deleteTab(workspaceId, paneId, tabId)}>Close tab</button>
    </div>
  {/if}
  {#if dirty}
    <div class="dirty-indicator" title="Unsaved changes"></div>
  {/if}
</div>

<style>
  .editor-container {
    position: relative;
    flex: 1;
    background: var(--bg-dark);
    overflow: hidden;
  }

  .editor-container :global(.cm-editor) {
    height: 100%;
  }

  .editor-container.hidden {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    opacity: 0;
    pointer-events: none;
    z-index: -1;
  }

  .editor-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--fg-dim);
    font-size: 13px;
  }

  .editor-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    color: var(--fg-dim);
    font-size: 13px;
  }

  .error-content {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .error-icon {
    font-size: 16px;
    color: var(--yellow, #e0af68);
  }

  .error-close-btn {
    padding: 4px 12px;
    background: var(--bg-light);
    color: var(--fg);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .error-close-btn:hover {
    background: var(--accent);
    color: var(--bg-dark);
  }

  .dirty-indicator {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--yellow, #e0af68);
    z-index: 5;
  }
</style>
