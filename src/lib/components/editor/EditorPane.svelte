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
  import { loadLanguageExtension, detectLanguageFromContent, isImageFile, getImageMimeType, isPdfFile, isMarkdownFile } from '$lib/utils/languageDetect';
  import { marked } from 'marked';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { buildEditorExtension } from '$lib/utils/editorTheme';
  import { getTheme } from '$lib/themes';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { dispatch } from '$lib/stores/notificationDispatch';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { registerEditor, unregisterEditor, setEditorDirty } from '$lib/stores/editorRegistry.svelte';
  import { claudeCodeStore } from '$lib/stores/claudeCode.svelte';
  import { EditorSelection } from '@codemirror/state';
  import { error as logError } from '@tauri-apps/plugin-log';
  import IconButton from '$lib/components/ui/IconButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Button from '$lib/components/ui/Button.svelte';

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
  let altKeyHeld = $state(false);

  // PDF viewer state
  let pdfDoc = $state<any>(null);
  let pdfPageCount = $state(0);
  let pdfCurrentPage = $state(1);
  let pdfZoom = $state(100);
  let pdfCanvasRefs = $state<HTMLCanvasElement[]>([]);
  let pdfScrollEl = $state<HTMLDivElement | null>(null);
  let pdfFileSize = $state(0);
  let pdfRendering = $state(false);

  // Markdown preview state
  let markdownPreview = $state(false);
  let markdownHtml = $state('');
  const isMarkdown = isMarkdownFile(editorFile.remote_path ?? editorFile.file_path);

  function toggleMarkdownPreview() {
    markdownPreview = !markdownPreview;
    if (markdownPreview && editorView) {
      const src = editorView.state.doc.toString();
      markdownHtml = marked.parse(src, { breaks: true, gfm: true }) as string;
    }
  }

  function handleMarkdownClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement).closest('a');
    if (anchor?.href) {
      e.preventDefault();
      shellOpen(anchor.href);
    }
  }

  const PDF_ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300, 400];

  const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400, 500];

  let cursorX = $state(0);
  let cursorY = $state(0);
  let cursorVisible = $state(false);

  function handleImageMouseMove(e: MouseEvent) {
    cursorX = e.clientX;
    cursorY = e.clientY;
    cursorVisible = true;
  }

  function handleImageMouseLeave() {
    cursorVisible = false;
  }

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

  /**
   * Zoom and keep the given point (in scroll-container coordinates) anchored.
   * If no point is given, anchors on the current viewport center.
   */
  function zoomTo(newZoom: number, anchorX?: number, anchorY?: number) {
    const sc = imageScrollEl;
    if (!sc || !imageNaturalWidth) {
      imageZoom = newZoom;
      return;
    }

    const oldZoom = displayZoom;
    // Anchor point in scroll-container viewport coords (default = center)
    const ax = anchorX ?? sc.clientWidth / 2;
    const ay = anchorY ?? sc.clientHeight / 2;
    // Point in image-natural-pixel space
    const imgX = (sc.scrollLeft + ax) / (oldZoom / 100);
    const imgY = (sc.scrollTop + ay) / (oldZoom / 100);

    imageZoom = newZoom;

    // After Svelte updates the DOM with the new size, restore scroll
    requestAnimationFrame(() => {
      const effectiveZoom = newZoom === 0 ? fitPercent : newZoom;
      sc.scrollLeft = imgX * (effectiveZoom / 100) - ax;
      sc.scrollTop = imgY * (effectiveZoom / 100) - ay;
    });
  }

  function zoomIn(anchorX?: number, anchorY?: number) {
    const current = displayZoom;
    const next = ZOOM_STEPS.find(z => z > current);
    zoomTo(next ?? ZOOM_STEPS[ZOOM_STEPS.length - 1], anchorX, anchorY);
  }

  function zoomOut(anchorX?: number, anchorY?: number) {
    const current = displayZoom;
    const prev = [...ZOOM_STEPS].reverse().find(z => z < current);
    zoomTo(prev ?? ZOOM_STEPS[0], anchorX, anchorY);
  }

  function zoomFit() {
    imageZoom = 0;
  }

  function handleImageClick(e: MouseEvent) {
    const sc = imageScrollEl;
    if (!sc) return;
    // Anchor at click position relative to scroll container
    const rect = sc.getBoundingClientRect();
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;

    if (e.altKey || e.button === 2) {
      zoomOut(ax, ay);
    } else {
      zoomIn(ax, ay);
    }
  }

  function handleImageContextMenu(e: MouseEvent) {
    e.preventDefault();
    handleImageClick(e);
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

  let pdfTextLayerRefs = $state<HTMLDivElement[]>([]);

  async function renderPdfPages() {
    if (!pdfDoc || pdfRendering) return;
    pdfRendering = true;
    const scale = pdfZoom / 100;
    const dpr = window.devicePixelRatio || 1;

    for (let i = 0; i < pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i + 1);
      const cssViewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * dpr });
      const canvas = pdfCanvasRefs[i];
      if (!canvas) continue;

      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      // Render text layer for selection/copy
      const textDiv = pdfTextLayerRefs[i];
      if (textDiv) {
        textDiv.innerHTML = '';
        textDiv.style.width = `${cssViewport.width}px`;
        textDiv.style.height = `${cssViewport.height}px`;

        const textContent = await page.getTextContent();
        const { TextLayer } = await import('pdfjs-dist');
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport: cssViewport,
        });
        await textLayer.render();

        // pdfjs uses CSS custom properties for sizing; override with explicit dimensions
        textDiv.style.setProperty('--total-scale-factor', String(scale));
        textDiv.style.setProperty('--scale-round-x', '1px');
        textDiv.style.setProperty('--scale-round-y', '1px');
      }
    }
    pdfRendering = false;
  }

  function pdfZoomIn() {
    const next = PDF_ZOOM_STEPS.find(z => z > pdfZoom);
    if (next) {
      pdfZoom = next;
      renderPdfPages();
    }
  }

  function pdfZoomOut() {
    const prev = [...PDF_ZOOM_STEPS].reverse().find(z => z < pdfZoom);
    if (prev) {
      pdfZoom = prev;
      renderPdfPages();
    }
  }

  function pdfGoToPage(page: number) {
    const clamped = Math.max(1, Math.min(page, pdfPageCount));
    pdfCurrentPage = clamped;
    const canvas = pdfCanvasRefs[clamped - 1];
    canvas?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handlePdfScroll() {
    if (!pdfScrollEl || !pdfCanvasRefs.length) return;
    const scrollTop = pdfScrollEl.scrollTop;
    const scrollMid = scrollTop + pdfScrollEl.clientHeight / 2;
    let cumulative = 0;
    for (let i = 0; i < pdfCanvasRefs.length; i++) {
      const h = pdfCanvasRefs[i]?.offsetHeight ?? 0;
      cumulative += h + 12; // 12px gap
      if (cumulative > scrollMid) {
        pdfCurrentPage = i + 1;
        break;
      }
    }
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

  function handleEditorReload(e: Event) {
    const detail = (e as CustomEvent).detail;
    if (detail?.tabId === tabId) {
      reloadFile();
    }
  }

  async function reloadFile() {
    if (!editorView) return;
    const filePath = editorFile.remote_path ?? editorFile.file_path;
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
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: content },
      });
      dirty = false;
      setEditorDirty(tabId, false);
      dispatch('File reloaded', filePath.split('/').pop() ?? 'file', 'info');
    } catch (e) {
      dispatch('Reload failed', String(e), 'error');
      logError(`Failed to reload file: ${e}`);
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
    window.addEventListener('editor-reload', handleEditorReload);

    const filePath = editorFile.remote_path ?? editorFile.file_path;
    const isImage = isImageFile(filePath);
    const isPdf = isPdfFile(filePath);

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
      } else if (isPdf) {
        // Load PDF via pdfjs-dist
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
        pdfFileSize = size;

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

        const raw = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const doc = await pdfjsLib.getDocument({ data: raw }).promise;
        pdfDoc = doc;
        pdfPageCount = doc.numPages;
        pdfCanvasRefs = new Array(doc.numPages);
        pdfTextLayerRefs = new Array(doc.numPages);
        loading = false;

        // Render after DOM updates with canvas refs
        requestAnimationFrame(() => renderPdfPages());
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
      } else if (!isImage && !isPdf && raw.toLowerCase().includes('binary')) {
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
    window.removeEventListener('editor-reload', handleEditorReload);
    unregisterEditor(tabId);
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
    if (pdfDoc) {
      pdfDoc.destroy();
      pdfDoc = null;
    }
  });

  // Track Alt key for zoom-out cursor on image viewer
  $effect(() => {
    if (!imageDataUrl && !pdfDoc) return;
    const onKey = (e: KeyboardEvent) => { altKeyHeld = e.altKey; };
    const onBlur = () => { altKeyHeld = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
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
        <span class="error-text">{errorMsg}</span>
      </div>
      <div class="error-actions">
        <Button variant="secondary" onclick={() => { navigator.clipboard.writeText(errorMsg ?? ''); }} style="padding:4px 12px;border-radius:4px;font-size:12px">Copy error</Button>
        <Button variant="secondary" onclick={() => workspacesStore.deleteTab(workspaceId, paneId, tabId)} style="padding:4px 12px;border-radius:4px;font-size:12px">Close tab</Button>
      </div>
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
          <IconButton tooltip="Zoom out" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={() => zoomOut()} disabled={displayZoom <= ZOOM_STEPS[0]}>&minus;</IconButton>
          <button class="zoom-label" class:zoom-fit={imageZoom === 0} onclick={zoomFit} title="Fit to window">{displayZoom}%</button>
          <IconButton tooltip="Zoom in" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={() => zoomIn()} disabled={displayZoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>+</IconButton>
        </div>
      </div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="image-scroll" bind:this={imageScrollEl} onclick={handleImageClick} oncontextmenu={handleImageContextMenu} onmousemove={handleImageMouseMove} onmouseleave={handleImageMouseLeave}>
        <img
          bind:this={imageEl}
          src={imageDataUrl}
          alt={editorFile.file_path.split('/').pop() ?? 'image'}
          onload={handleImageLoad}
          style="{imageZoom === 0 ? 'max-width: 100%; max-height: 100%;' : `width: ${imageNaturalWidth * imageZoom / 100}px; height: ${imageNaturalHeight * imageZoom / 100}px;`} object-fit: contain;"
        />
      </div>
    </div>
    {#if cursorVisible}
      <div class="zoom-cursor" style="left: {cursorX}px; top: {cursorY}px;">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle cx="10" cy="10" r="6.5" fill="rgba(0,0,0,0.15)" stroke="#000" stroke-width="2.5" opacity=".3"/>
          <circle cx="10" cy="10" r="6.5" fill="rgba(0,0,0,0.15)" stroke="#fff" stroke-width="1.5"/>
          <line x1="15" y1="15" x2="22" y2="22" stroke="#000" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
          <line x1="15" y1="15" x2="22" y2="22" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          {#if altKeyHeld}
            <line x1="7.5" y1="10" x2="12.5" y2="10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          {:else}
            <line x1="7.5" y1="10" x2="12.5" y2="10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="10" y1="7.5" x2="10" y2="12.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          {/if}
        </svg>
      </div>
    {/if}
  {:else if pdfDoc}
    <div class="pdf-preview">
      <div class="image-info-bar">
        <div class="pdf-page-nav">
          <IconButton tooltip="Previous page" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={() => pdfGoToPage(pdfCurrentPage - 1)} disabled={pdfCurrentPage <= 1}>&#x25C0;</IconButton>
          <span class="info-item">
            <input
              type="number"
              class="pdf-page-input"
              value={pdfCurrentPage}
              min="1"
              max={pdfPageCount}
              onchange={(e) => pdfGoToPage(parseInt((e.target as HTMLInputElement).value) || 1)}
            /> / {pdfPageCount}
          </span>
          <IconButton tooltip="Next page" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={() => pdfGoToPage(pdfCurrentPage + 1)} disabled={pdfCurrentPage >= pdfPageCount}>&#x25B6;</IconButton>
        </div>
        <span class="info-sep"></span>
        {#if pdfFileSize > 0}
          <span class="info-item">{formatFileSize(pdfFileSize)}</span>
          <span class="info-sep"></span>
        {/if}
        <div class="zoom-controls">
          <IconButton tooltip="Zoom out" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={pdfZoomOut} disabled={pdfZoom <= PDF_ZOOM_STEPS[0]}>&minus;</IconButton>
          <span class="zoom-label">{pdfZoom}%</span>
          <IconButton tooltip="Zoom in" style="width:22px;height:20px;border-radius:3px;font-size:14px" onclick={pdfZoomIn} disabled={pdfZoom >= PDF_ZOOM_STEPS[PDF_ZOOM_STEPS.length - 1]}>+</IconButton>
        </div>
      </div>
      <div class="pdf-scroll" bind:this={pdfScrollEl} onscroll={handlePdfScroll}>
        {#each Array(pdfPageCount) as _, i}
          <div class="pdf-page-wrapper">
            <canvas
              bind:this={pdfCanvasRefs[i]}
              class="pdf-page"
            ></canvas>
            <div
              bind:this={pdfTextLayerRefs[i]}
              class="pdf-text-layer"
            ></div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
  {#if isMarkdown && !loading && !errorMsg && !imageDataUrl && !pdfDoc}
    <div class="md-bar">
      <IconButton
        tooltip={markdownPreview ? 'Edit' : 'Preview'}
        active={markdownPreview}
        onclick={toggleMarkdownPreview}
      >
        {#if markdownPreview}
          <Icon name="pencil" />
        {:else}
          <Icon name="eye" />
        {/if}
      </IconButton>
    </div>
    {#if markdownPreview}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="md-render" onclick={handleMarkdownClick}>{@html markdownHtml}</div>
    {/if}
  {/if}
</div>

<style>
  .editor-container {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
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

  .error-text {
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }

  .error-actions {
    display: flex;
    gap: 8px;
  }

  .image-preview {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .image-scroll {
    flex: 1;
    overflow: auto;
    padding: 16px;
    min-height: 0;
    cursor: none;
    /* Center small images via margin auto on the img; large images scroll naturally */
  }

  .image-scroll img {
    display: block;
    margin: auto;
    cursor: none;
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

  .zoom-cursor {
    position: fixed;
    pointer-events: none;
    z-index: 9999;
    transform: translate(-10px, -10px);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.5));
  }

  /* PDF viewer */
  .pdf-preview {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .pdf-scroll {
    flex: 1;
    overflow: auto;
    padding: 16px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background: var(--bg-dark);
  }

  .pdf-page-wrapper {
    position: relative;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    border-radius: 2px;
    flex-shrink: 0;
  }

  .pdf-page {
    display: block;
  }

  .pdf-text-layer {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    line-height: 1;
    pointer-events: auto;
  }

  .pdf-text-layer :global(span) {
    position: absolute;
    white-space: pre;
    color: transparent;
    cursor: text;
    pointer-events: auto;
    user-select: text;
    -webkit-user-select: text;
  }

  .pdf-text-layer :global(span::selection) {
    background: rgba(122, 162, 247, 0.3);
  }

  .pdf-text-layer :global(br) {
    display: none;
  }

  .pdf-page-nav {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pdf-page-input {
    width: 36px;
    text-align: center;
    padding: 1px 2px;
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    background: var(--bg-dark);
    color: var(--fg);
    font-size: 11px;
    -moz-appearance: textfield;
    appearance: textfield;
  }

  .pdf-page-input::-webkit-inner-spin-button,
  .pdf-page-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Markdown preview */
  .md-bar {
    position: absolute;
    top: 4px;
    right: 20px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .md-render {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 24px 32px;
    background: var(--bg-dark);
    color: var(--fg);
    line-height: 1.6;
    z-index: 4;
  }

  .md-render :global(h1),
  .md-render :global(h2),
  .md-render :global(h3),
  .md-render :global(h4) {
    margin: 0.8em 0 0.4em;
    color: var(--fg);
    line-height: 1.3;
  }

  .md-render :global(h1) { font-size: 1.5em; }
  .md-render :global(h2) { font-size: 1.3em; }
  .md-render :global(h3) { font-size: 1.15em; }
  .md-render :global(h4) { font-size: 1.05em; }

  .md-render :global(p) {
    margin: 0 0 0.6em;
  }

  .md-render :global(code) {
    background: var(--bg-light);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.9em;
  }

  .md-render :global(pre) {
    background: var(--bg-medium);
    padding: 12px 14px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0 0 0.8em;
  }

  .md-render :global(pre code) {
    background: none;
    padding: 0;
  }

  .md-render :global(ul),
  .md-render :global(ol) {
    margin: 0 0 0.6em;
    padding-left: 1.5em;
  }

  .md-render :global(li) {
    margin-bottom: 0.2em;
  }

  .md-render :global(blockquote) {
    border-left: 3px solid var(--bg-light);
    margin: 0 0 0.6em;
    padding: 4px 12px;
    color: var(--fg-dim);
  }

  .md-render :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .md-render :global(a:hover) {
    text-decoration: underline;
  }

  .md-render :global(hr) {
    border: none;
    border-top: 1px solid var(--bg-light);
    margin: 0.8em 0;
  }

  .md-render :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.8em;
    font-size: 0.9em;
  }

  .md-render :global(th),
  .md-render :global(td) {
    border: 1px solid var(--bg-light);
    padding: 6px 10px;
    text-align: left;
  }

  .md-render :global(th) {
    background: var(--bg-medium);
    font-weight: 600;
  }

  .md-render :global(img) {
    max-width: 100%;
    border-radius: 4px;
  }

  .md-render :global(input[type="checkbox"]) {
    appearance: none;
    width: 1em;
    height: 1em;
    border: 2px solid var(--fg-dim);
    border-radius: 3px;
    background: transparent;
    vertical-align: middle;
    margin-right: 6px;
    position: relative;
    top: -1px;
  }

  .md-render :global(input[type="checkbox"]:checked) {
    background: var(--accent);
    border-color: var(--accent);
  }

  .md-render :global(input[type="checkbox"]:checked::after) {
    content: '';
    position: absolute;
    left: 50%;
    top: 45%;
    width: 5px;
    height: 9px;
    border: solid var(--bg-dark);
    border-width: 0 2px 2px 0;
    transform: translate(-50%, -60%) rotate(45deg);
  }

  .md-render :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: -1.5em;
  }

</style>
