<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { foldGutter, indentOnInput, bracketMatching, foldKeymap } from '@codemirror/language';
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
  import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
  import type { EditorFileInfo } from '$lib/tauri/types';
  import { readFile, readFileBase64, writeFile, scpReadFile, scpReadFileBase64, scpWriteFile } from '$lib/tauri/commands';
  import { loadLanguageExtension, detectLanguageFromContent, isImageFile, getImageMimeType } from '$lib/utils/languageDetect';
  import { buildEditorExtension } from '$lib/utils/editorTheme';
  import { getTheme } from '$lib/themes';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { dispatch } from '$lib/stores/notificationDispatch';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { registerEditor, unregisterEditor, setEditorDirty } from '$lib/stores/editorRegistry';
  import { claudeCodeStore } from '$lib/stores/claudeCode.svelte';
  import { EditorSelection } from '@codemirror/state';
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
  let imageDataUrl = $state<string | null>(null);
  let imageFileSize = $state(0);
  let imageNaturalWidth = $state(0);
  let imageNaturalHeight = $state(0);
  /** 0 = fit-to-window mode; positive = explicit zoom percentage (100 = 1:1 pixels) */
  let imageZoom = $state(0);
  let imageEl = $state<HTMLImageElement | null>(null);
  let imageScrollEl = $state<HTMLDivElement | null>(null);

  const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500];

  /** Compute the actual display percentage when in fit-to-window mode. */
  const fitPercent = $derived.by(() => {
    if (!imageScrollEl || !imageNaturalWidth || !imageNaturalHeight) return 100;
    const cw = imageScrollEl.clientWidth - 32; // subtract padding
    const ch = imageScrollEl.clientHeight - 32;
    if (cw <= 0 || ch <= 0) return 100;
    const scale = Math.min(cw / imageNaturalWidth, ch / imageNaturalHeight, 1);
    return Math.round(scale * 100);
  });

  /** The effective zoom percentage shown in the label. */
  const displayZoom = $derived(imageZoom === 0 ? fitPercent : imageZoom);

  function zoomIn() {
    const current = displayZoom;
    const next = ZOOM_STEPS.find(z => z > current);
    imageZoom = next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  }

  function zoomOut() {
    const current = displayZoom;
    const prev = [...ZOOM_STEPS].reverse().find(z => z < current);
    imageZoom = prev ?? ZOOM_STEPS[0];
  }

  function zoomFit() {
    imageZoom = 0;
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function handleImageLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    imageNaturalWidth = img.naturalWidth;
    imageNaturalHeight = img.naturalHeight;
  }

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

    const filePath = editorFile.remote_path ?? editorFile.file_path;
    const isImage = isImageFile(filePath);

    try {
      if (isImage) {
        // Load image as base64 data URL
        const mime = getImageMimeType(filePath) ?? 'image/png';
        let data: string;
        let size: number;
        if (editorFile.is_remote && editorFile.remote_ssh_command && editorFile.remote_path) {
          const result = await scpReadFileBase64(editorFile.remote_ssh_command, editorFile.remote_path);
          data = result.data;
          size = result.size;
        } else {
          const result = await readFileBase64(editorFile.file_path);
          data = result.data;
          size = result.size;
        }
        imageDataUrl = `data:${mime};base64,${data}`;
        imageFileSize = size;
        loading = false;
      } else {
        // Load text file into CodeMirror
        let content: string;
        if (editorFile.is_remote && editorFile.remote_ssh_command && editorFile.remote_path) {
          const result = await scpReadFile(editorFile.remote_ssh_command, editorFile.remote_path);
          content = result.content;
        } else {
          const result = await readFile(editorFile.file_path);
          content = result.content;
        }
        originalContent = content;

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
          search({ top: true }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          ...buildEditorExtension(getTheme(preferencesStore.theme, preferencesStore.customThemes)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const isDirty = update.state.doc.toString() !== originalContent;
              dirty = isDirty;
              setEditorDirty(tabId, isDirty);
            }
            if (update.selectionSet) {
              const sel = update.state.selection.main;
              const doc = update.state.doc;
              const fromLine = doc.lineAt(sel.from);
              const toLine = doc.lineAt(sel.to);
              const selectedText = doc.sliceString(sel.from, sel.to);
              claudeCodeStore.updateSelection({
                text: selectedText,
                filePath: editorFile.file_path,
                selection: {
                  start: { line: fromLine.number - 1, character: sel.from - fromLine.from },
                  end: { line: toLine.number - 1, character: sel.to - toLine.from },
                  isEmpty: sel.empty,
                },
              });
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

        registerEditor(tabId, editorView, editorFile.file_path);

        // Apply pending selection from Claude Code openFile
        const pending = claudeCodeStore.getPendingSelection(tabId);
        if (pending) {
          claudeCodeStore.clearPendingSelection(tabId);
          const doc = editorView.state.doc;
          if (pending.startLine !== undefined) {
            const line = doc.line(Math.min(pending.startLine + 1, doc.lines));
            const endLine = pending.endLine !== undefined
              ? doc.line(Math.min(pending.endLine + 1, doc.lines))
              : line;
            editorView.dispatch({
              selection: EditorSelection.range(line.from, endLine.to),
              scrollIntoView: true,
            });
          } else if (pending.startText) {
            const text = doc.toString();
            const idx = text.indexOf(pending.startText);
            if (idx >= 0) {
              const endIdx = pending.endText
                ? text.indexOf(pending.endText, idx) + pending.endText.length
                : idx + pending.startText.length;
              editorView.dispatch({
                selection: EditorSelection.range(idx, endIdx >= 0 ? endIdx : idx + pending.startText.length),
                scrollIntoView: true,
              });
            }
          }
        }

        loading = false;
      }
    } catch (e) {
      const msg = String(e).toLowerCase();
      if (msg.includes('is_directory') || msg.includes('not a regular file') || msg.includes('is a directory')) {
        workspacesStore.deleteTab(workspaceId, paneId, tabId);
        return;
      }
      const raw = String(e);
      if (raw.startsWith('FILE_TOO_LARGE:')) {
        const sizeMb = raw.split(':')[1];
        errorMsg = `File is too large (${sizeMb} MB)`;
      } else if (!isImage && raw.toLowerCase().includes('binary')) {
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
    unregisterEditor(tabId);
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
  {:else if imageDataUrl}
    <div class="image-preview">
      <div class="image-info-bar">
        {#if imageNaturalWidth > 0}
          <span class="info-item">{imageNaturalWidth} &times; {imageNaturalHeight}</span>
          <span class="info-sep"></span>
        {/if}
        {#if imageFileSize > 0}
          <span class="info-item">{formatFileSize(imageFileSize)}</span>
          <span class="info-sep"></span>
        {/if}
        <div class="zoom-controls">
          <button class="zoom-btn" onclick={zoomOut} disabled={displayZoom <= ZOOM_STEPS[0]} title="Zoom out">&minus;</button>
          <button class="zoom-label" class:zoom-fit={imageZoom === 0} onclick={zoomFit} title="Fit to window">{displayZoom}%</button>
          <button class="zoom-btn" onclick={zoomIn} disabled={displayZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} title="Zoom in">+</button>
        </div>
      </div>
      <div class="image-scroll" bind:this={imageScrollEl}>
        <img
          bind:this={imageEl}
          src={imageDataUrl}
          alt={editorFile.file_path.split('/').pop() ?? 'image'}
          onload={handleImageLoad}
          style="{imageZoom === 0 ? 'max-width: 100%; max-height: 100%;' : `width: ${imageNaturalWidth * imageZoom / 100}px; height: ${imageNaturalHeight * imageZoom / 100}px;`} object-fit: contain;"
        />
      </div>
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

  /* Search panel styling */
  .editor-container :global(.cm-panel.cm-search) {
    padding: 6px 10px;
    font-size: 13px;
    background: var(--bg-medium);
    border-bottom: 1px solid var(--bg-light);
  }

  .editor-container :global(.cm-panel.cm-search input),
  .editor-container :global(.cm-panel.cm-search button) {
    font-size: 13px;
  }

  .editor-container :global(.cm-panel.cm-search input[type="text"]) {
    padding: 3px 6px;
    border-radius: 3px;
    border: 1px solid var(--bg-light);
    background: var(--bg-dark);
    color: var(--fg);
  }

  .editor-container :global(.cm-panel.cm-search input[type="text"]:focus) {
    border-color: var(--accent);
    outline: none;
  }

  .editor-container :global(.cm-panel.cm-search button) {
    padding: 2px 8px;
    border-radius: 3px;
    background: var(--bg-light);
    color: var(--fg);
    border: none;
    cursor: pointer;
  }

  .editor-container :global(.cm-panel.cm-search button:hover) {
    background: var(--accent);
    color: var(--bg-dark);
  }

  .editor-container :global(.cm-panel.cm-search label) {
    font-size: 13px;
    color: var(--fg-dim);
  }

  .editor-container :global(.cm-panel.cm-search .cm-button) {
    background-image: none;
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

  .image-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .image-scroll {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 16px;
    min-height: 0;
  }

  .image-preview img {
    border-radius: 4px;
  }

  .image-info-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--bg-light);
    background: var(--bg-medium);
    flex-shrink: 0;
    height: 28px;
  }

  .info-item {
    font-size: 11px;
    color: var(--fg-dim);
    white-space: nowrap;
  }

  .info-sep {
    width: 1px;
    height: 12px;
    background: var(--bg-light);
    flex-shrink: 0;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 20px;
    padding: 0;
    font-size: 13px;
    color: var(--fg-dim);
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }

  .zoom-btn:hover:not(:disabled) {
    background: var(--bg-light);
    color: var(--fg);
  }

  .zoom-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .zoom-label {
    font-size: 11px;
    color: var(--fg-dim);
    min-width: 36px;
    text-align: center;
    padding: 0 2px;
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }

  .zoom-label:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .zoom-label.zoom-fit {
    color: var(--accent);
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
