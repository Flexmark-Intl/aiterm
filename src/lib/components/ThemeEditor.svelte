<script lang="ts">
  import type { Theme, UiColors, TerminalColors } from '$lib/themes';
  import { isBuiltinTheme } from '$lib/themes';
  import { preferencesStore } from '$lib/stores/preferences.svelte';

  interface Props {
    theme: Theme;
  }

  let { theme }: Props = $props();

  let expanded = $state(true);

  const isBuiltin = $derived(isBuiltinTheme(theme.id));

  type ColorEntry = { key: string; label: string };

  const bgColors: ColorEntry[] = [
    { key: 'ui.bg_dark', label: 'Background' },
    { key: 'ui.bg_medium', label: 'Surface' },
    { key: 'ui.bg_light', label: 'Border' },
    { key: 'terminal.background', label: 'Terminal BG' },
    { key: 'terminal.selectionBackground', label: 'Selection BG' },
  ];

  const textColors: ColorEntry[] = [
    { key: 'ui.fg', label: 'Text' },
    { key: 'ui.fg_dim', label: 'Dim Text' },
    { key: 'terminal.foreground', label: 'Terminal FG' },
    { key: 'terminal.cursor', label: 'Cursor' },
    { key: 'terminal.cursorAccent', label: 'Cursor Accent' },
    { key: 'terminal.selectionForeground', label: 'Selection FG' },
  ];

  const accentColors: ColorEntry[] = [
    { key: 'ui.accent', label: 'Accent' },
    { key: 'ui.accent_hover', label: 'Accent Hover' },
  ];

  const uiSemanticColors: ColorEntry[] = [
    { key: 'ui.green', label: 'Green' },
    { key: 'ui.red', label: 'Red' },
    { key: 'ui.yellow', label: 'Yellow' },
    { key: 'ui.cyan', label: 'Cyan' },
    { key: 'ui.magenta', label: 'Magenta' },
  ];

  const ansiColors: ColorEntry[] = [
    { key: 'terminal.black', label: 'Black' },
    { key: 'terminal.brightBlack', label: 'Bright' },
    { key: 'terminal.red', label: 'Red' },
    { key: 'terminal.brightRed', label: 'Bright' },
    { key: 'terminal.green', label: 'Green' },
    { key: 'terminal.brightGreen', label: 'Bright' },
    { key: 'terminal.yellow', label: 'Yellow' },
    { key: 'terminal.brightYellow', label: 'Bright' },
    { key: 'terminal.blue', label: 'Blue' },
    { key: 'terminal.brightBlue', label: 'Bright' },
    { key: 'terminal.magenta', label: 'Magenta' },
    { key: 'terminal.brightMagenta', label: 'Bright' },
    { key: 'terminal.cyan', label: 'Cyan' },
    { key: 'terminal.brightCyan', label: 'Bright' },
    { key: 'terminal.white', label: 'White' },
    { key: 'terminal.brightWhite', label: 'Bright' },
  ];

  function getColor(t: Theme, path: string): string {
    const [section, key] = path.split('.');
    if (section === 'ui') return t.ui[key as keyof UiColors];
    return t.terminal[key as keyof TerminalColors];
  }

  function setColor(t: Theme, path: string, value: string): Theme {
    const [section, key] = path.split('.');
    if (section === 'ui') {
      return { ...t, ui: { ...t.ui, [key]: value } };
    }
    return { ...t, terminal: { ...t.terminal, [key]: value } };
  }

  function forkAndEdit(path: string, value: string) {
    const forked: Theme = {
      ...structuredClone(theme),
      id: `custom-${crypto.randomUUID()}`,
      name: `Custom ${theme.name}`,
    };
    const updated = setColor(forked, path, value);
    preferencesStore.addCustomTheme(updated);
    preferencesStore.setTheme(updated.id);
  }

  function editInPlace(path: string, value: string) {
    const updated = setColor(theme, path, value);
    preferencesStore.updateCustomTheme(theme.id, updated);
  }

  function handleColorChange(path: string, value: string) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    if (isBuiltin) {
      forkAndEdit(path, value);
    } else {
      editInPlace(path, value);
    }
  }

  function handleNameChange(value: string) {
    if (isBuiltin || !value.trim()) return;
    const updated = { ...theme, name: value.trim() };
    preferencesStore.updateCustomTheme(theme.id, updated);
  }
</script>

<div class="editor">
  <button class="editor-toggle" onclick={() => expanded = !expanded}>
    <span class="toggle-arrow" class:open={expanded}>&#9654;</span>
    Edit Colors
  </button>

  {#if expanded}
    <div class="editor-body">
      {#if !isBuiltin}
        <div class="name-row">
          <label for="theme-name">Name</label>
          <input
            id="theme-name"
            type="text"
            class="name-input"
            value={theme.name}
            onchange={(e) => handleNameChange(e.currentTarget.value)}
          />
        </div>
      {/if}

      <div class="color-section">
        <h4>Backgrounds</h4>
        <div class="color-grid">
          {#each bgColors as c (c.key)}
            <div class="color-item">
              <span class="color-label">{c.label}</span>
              <div class="color-inputs">
                <input
                  type="color"
                  value={getColor(theme, c.key)}
                  oninput={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="hex-input"
                  value={getColor(theme, c.key)}
                  onchange={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="color-section">
        <h4>Text</h4>
        <div class="color-grid">
          {#each textColors as c (c.key)}
            <div class="color-item">
              <span class="color-label">{c.label}</span>
              <div class="color-inputs">
                <input
                  type="color"
                  value={getColor(theme, c.key)}
                  oninput={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="hex-input"
                  value={getColor(theme, c.key)}
                  onchange={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="color-section">
        <h4>Accent</h4>
        <div class="color-grid">
          {#each accentColors as c (c.key)}
            <div class="color-item">
              <span class="color-label">{c.label}</span>
              <div class="color-inputs">
                <input
                  type="color"
                  value={getColor(theme, c.key)}
                  oninput={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="hex-input"
                  value={getColor(theme, c.key)}
                  onchange={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="color-section">
        <h4>UI Semantic</h4>
        <div class="color-grid">
          {#each uiSemanticColors as c (c.key)}
            <div class="color-item">
              <span class="color-label">{c.label}</span>
              <div class="color-inputs">
                <input
                  type="color"
                  value={getColor(theme, c.key)}
                  oninput={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="hex-input"
                  value={getColor(theme, c.key)}
                  onchange={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="color-section">
        <h4>ANSI Colors</h4>
        <div class="color-grid ansi">
          {#each ansiColors as c (c.key)}
            <div class="color-item">
              <span class="color-label">{c.label}</span>
              <div class="color-inputs">
                <input
                  type="color"
                  value={getColor(theme, c.key)}
                  oninput={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
                <input
                  type="text"
                  class="hex-input"
                  value={getColor(theme, c.key)}
                  onchange={(e) => handleColorChange(c.key, e.currentTarget.value)}
                />
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .editor {
    margin-top: 16px;
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
  }

  .editor-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-dark);
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .editor-toggle:hover {
    color: var(--fg);
  }

  .toggle-arrow {
    display: inline-block;
    font-size: 8px;
    transition: transform 0.15s;
  }

  .toggle-arrow.open {
    transform: rotate(90deg);
  }

  .editor-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name-row label {
    font-size: 12px;
    color: var(--fg-dim);
    flex-shrink: 0;
  }

  .name-input {
    flex: 1;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--fg);
  }

  .name-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .color-section h4 {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 8px 0;
  }

  .color-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .color-grid.ansi {
    grid-template-columns: 1fr 1fr;
  }

  .color-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .color-label {
    font-size: 11px;
    color: var(--fg-dim);
    flex-shrink: 0;
    min-width: 70px;
  }

  .color-inputs {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  input[type="color"] {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    cursor: pointer;
    background: none;
  }

  input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 2px;
  }

  input[type="color"]::-webkit-color-swatch {
    border: none;
    border-radius: 2px;
  }

  .hex-input {
    width: 68px;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 2px 4px;
    font-size: 11px;
    font-family: 'Menlo', Monaco, monospace;
    color: var(--fg);
  }

  .hex-input:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
