<script lang="ts">
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { untrack } from 'svelte';
  import { marked } from 'marked';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    tabId: string;
    workspaceId: string;
    paneId: string;
    notes: string | null;
    notesMode: string | null;
    onclose: () => void;
  }

  let { tabId, workspaceId, paneId, notes, notesMode, onclose }: Props = $props();

  let value = $state(notes ?? '');
  let mode = $state<'source' | 'render'>((notesMode ?? 'source') as 'source' | 'render');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const textareaStyle = $derived(
    `font-family: '${preferencesStore.fontFamily}', monospace; font-size: ${preferencesStore.fontSize}px; white-space: ${preferencesStore.notesWordWrap ? 'pre-wrap' : 'pre'}; overflow-x: ${preferencesStore.notesWordWrap ? 'hidden' : 'auto'};`
  );
  const renderStyle = $derived(
    `font-family: '${preferencesStore.notesFontFamily}', monospace; font-size: ${preferencesStore.notesFontSize}px; word-wrap: ${preferencesStore.notesWordWrap ? 'break-word' : 'normal'}; overflow-x: ${preferencesStore.notesWordWrap ? 'hidden' : 'auto'};`
  );

  // Configure marked for safe rendering with interactive checkboxes
  const renderer = new marked.Renderer();
  let checkboxIndex = 0;
  renderer.checkbox = function({ checked }) {
    const i = checkboxIndex++;
    return `<input type="checkbox" data-index="${i}"${checked ? ' checked=""' : ''}>`;
  };
  marked.setOptions({ breaks: true, gfm: true, renderer });

  const renderedHtml = $derived.by(() => {
    checkboxIndex = 0;
    return marked.parse(value) as string;
  });

  // Focus at end of content when entering source mode
  $effect(() => {
    if (mode === 'source' && textareaEl) {
      textareaEl.focus();
      textareaEl.selectionStart = textareaEl.selectionEnd = textareaEl.value.length;
    }
  });

  function save() {
    const content = untrack(() => value);
    const n = content.trim() ? content : null;
    workspacesStore.setTabNotes(workspaceId, paneId, tabId, n);
  }

  // Debounced auto-save: 1s after last keystroke
  $effect(() => {
    void value;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(), 1000);
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (saveTimer) clearTimeout(saveTimer);
      save();
      onclose();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      value = value.substring(0, start) + '  ' + value.substring(end);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      });
    }
  }

  function toggleMode() {
    mode = mode === 'source' ? 'render' : 'source';
    workspacesStore.setTabNotesMode(workspaceId, paneId, tabId, mode);
  }

  function handleRenderClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Handle checkbox toggles (clicking checkbox or its label text)
    const checkbox = target instanceof HTMLInputElement && target.type === 'checkbox'
      ? target
      : target.closest('li')?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (checkbox?.dataset.index != null) {
      e.preventDefault();
      const idx = parseInt(checkbox.dataset.index, 10);
      let count = 0;
      value = value.replace(/- \[([ xX])\]/g, (match, ch) => {
        if (count++ === idx) {
          return ch === ' ' ? '- [x]' : '- [ ]';
        }
        return match;
      });
      save();
      return;
    }

    // Handle link clicks
    const anchor = target.closest('a');
    if (anchor?.href) {
      e.preventDefault();
      shellOpen(anchor.href);
    }
  }
</script>

<div class="notes-panel" style:width="{preferencesStore.notesWidth}px" style:min-width="{preferencesStore.notesWidth}px">
  <div class="notes-header">
    <span class="notes-title">Notes</span>
    <div class="header-actions">
      <button
        class="mode-toggle"
        class:active={mode === 'render'}
        onclick={toggleMode}
        title={mode === 'source' ? 'Preview' : 'Edit'}
      >
        {#if mode === 'source'}
          <Icon name="eye" />
        {:else}
          <Icon name="pencil" />
        {/if}
      </button>
      <button class="close-btn" onclick={() => {
        if (saveTimer) clearTimeout(saveTimer);
        save();
        onclose();
      }}>&times;</button>
    </div>
  </div>

  {#if mode === 'source'}
    <textarea
      class="notes-textarea"
      bind:value={value}
      bind:this={textareaEl}
      onkeydown={handleKeydown}
      placeholder="Jot down commands, notes, connection details..."
      spellcheck="false"
      style={textareaStyle}
    ></textarea>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="notes-render"
      onclick={handleRenderClick}
      style={renderStyle}
    >{@html renderedHtml}</div>
  {/if}
</div>

<style>
  .notes-panel {
    display: flex;
    flex-direction: column;
    background: var(--bg-medium);
    border-left: 1px solid var(--bg-light);
  }

  .notes-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--bg-light);
    flex-shrink: 0;
  }

  .notes-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--fg-dim);
    border-radius: 4px;
    transition: background 0.1s, color 0.1s;
  }

  .mode-toggle:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .mode-toggle.active {
    color: var(--accent);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    color: var(--fg-dim);
    border-radius: 4px;
    font-size: 14px;
    transition: background 0.1s, color 0.1s;
  }

  .close-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .notes-textarea {
    flex: 1;
    resize: none;
    background: var(--bg-dark);
    color: var(--fg);
    border: none;
    padding: 12px;
    line-height: 1.5;
    outline: none;
  }

  .notes-textarea::placeholder {
    color: var(--fg-dim);
    opacity: 0.5;
  }

  .notes-render {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    background: var(--bg-dark);
    color: var(--fg);
    line-height: 1.6;
  }

  .notes-render :global(h1),
  .notes-render :global(h2),
  .notes-render :global(h3),
  .notes-render :global(h4) {
    margin: 0.8em 0 0.4em;
    color: var(--fg);
    line-height: 1.3;
  }

  .notes-render :global(h1) { font-size: 1.3em; }
  .notes-render :global(h2) { font-size: 1.15em; }
  .notes-render :global(h3) { font-size: 1.05em; }

  .notes-render :global(p) {
    margin: 0 0 0.6em;
  }

  .notes-render :global(code) {
    background: var(--bg-light);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--font-family, 'Menlo'), monospace;
    font-size: 0.9em;
  }

  .notes-render :global(pre) {
    background: var(--bg-medium);
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0 0 0.6em;
  }

  .notes-render :global(pre code) {
    background: none;
    padding: 0;
  }

  .notes-render :global(ul),
  .notes-render :global(ol) {
    margin: 0 0 0.6em;
    padding-left: 1.5em;
  }

  .notes-render :global(li) {
    margin-bottom: 0.2em;
  }

  .notes-render :global(li:has(> input[type="checkbox"])) {
    list-style: none;
    margin-left: -1.5em;
    cursor: pointer;
  }

  .notes-render :global(input[type="checkbox"]) {
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
    cursor: pointer;
  }

  .notes-render :global(input[type="checkbox"]:checked) {
    background: var(--accent);
    border-color: var(--accent);
  }

  .notes-render :global(input[type="checkbox"]:checked::after) {
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

  .notes-render :global(blockquote) {
    border-left: 3px solid var(--bg-light);
    margin: 0 0 0.6em;
    padding: 4px 12px;
    color: var(--fg-dim);
  }

  .notes-render :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .notes-render :global(a:hover) {
    text-decoration: underline;
  }

  .notes-render :global(hr) {
    border: none;
    border-top: 1px solid var(--bg-light);
    margin: 0.8em 0;
  }

  .notes-render :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.6em;
    font-size: 0.9em;
  }

  .notes-render :global(th),
  .notes-render :global(td) {
    border: 1px solid var(--bg-light);
    padding: 4px 8px;
    text-align: left;
  }

  .notes-render :global(th) {
    background: var(--bg-medium);
    font-weight: 600;
  }
</style>
