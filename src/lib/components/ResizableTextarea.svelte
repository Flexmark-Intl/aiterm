<script lang="ts">
  interface Props {
    value: string;
    placeholder?: string;
    rows?: number;
    maxHeight?: number;
    mono?: boolean;
    invalid?: boolean;
    autofocus?: boolean;
    onchange?: (value: string) => void;
    onkeydown?: (e: KeyboardEvent) => void;
  }

  let {
    value,
    placeholder = '',
    rows = 1,
    maxHeight = 560,
    mono = false,
    invalid = false,
    autofocus = false,
    onchange,
    onkeydown,
  }: Props = $props();

  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let manualResize = false;

  function autoGrow() {
    if (manualResize || !textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, maxHeight) + 'px';
  }

  // Auto-grow on mount and when value changes externally
  $effect(() => {
    value;
    autoGrow();
  });

  export function focus() {
    textareaEl?.focus();
  }
</script>

<div class="resizable-textarea" class:mono class:invalid>
  <!-- svelte-ignore a11y_autofocus -->
  <textarea
    bind:this={textareaEl}
    {value}
    {placeholder}
    {rows}
    autofocus={autofocus}
    autocapitalize="off"
    spellcheck="false"
    oninput={(e) => {
      onchange?.(e.currentTarget.value);
      autoGrow();
    }}
    onkeydown={(e) => onkeydown?.(e)}
    style:max-height="{maxHeight}px"
  ></textarea>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="resize-handle" onmousedown={(e) => {
    e.preventDefault();
    if (!textareaEl) return;
    const startY = e.clientY;
    const startH = textareaEl.offsetHeight;
    function onMove(ev: MouseEvent) {
      if (!textareaEl) return;
      const h = Math.max(32, Math.min(maxHeight, startH + ev.clientY - startY));
      textareaEl.style.height = h + 'px';
    }
    function onUp() {
      manualResize = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }}>
    <svg class="resize-icon" width="16" height="4" viewBox="0 0 16 4" style="pointer-events: none">
      <line x1="1" y1="1" x2="15" y2="1" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
      <line x1="1" y1="3" x2="15" y2="3" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
    </svg>
  </div>
</div>

<style>
  .resizable-textarea {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    transition: border-color 0.1s;
  }

  .resizable-textarea:focus-within {
    border-color: var(--accent);
  }

  .resizable-textarea.invalid {
    border-color: var(--red, #f7768e);
  }

  .resizable-textarea.invalid:focus-within {
    border-color: var(--red, #f7768e);
  }

  textarea {
    background: var(--bg-dark);
    border: none;
    border-radius: 4px 4px 0 0;
    padding: 8px;
    color: var(--fg);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    outline: none;
    resize: none;
    min-height: 2.4em;
    overflow-y: auto;
  }

  .mono textarea {
    font-family: 'Menlo', Monaco, monospace;
  }

  .resize-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 12px;
    background: var(--bg-dark);
    border-radius: 0 0 3px 3px;
    user-select: none;
    cursor: row-resize;
  }

  .resize-handle:hover {
    background: var(--bg-light);
  }

  .resize-icon {
    color: var(--bg-light);
    transition: color 0.1s;
  }

  .resize-handle:hover .resize-icon {
    color: var(--fg-dim);
  }
</style>
