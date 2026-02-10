<script lang="ts">
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import type { CursorStyle } from '$lib/tauri/types';
  import { builtinThemes, getTheme, isBuiltinTheme } from '$lib/themes';
  import ThemeEditor from '$lib/components/ThemeEditor.svelte';
  import { modLabel, isModKey } from '$lib/utils/platform';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let activeSection = $state<'appearance' | 'terminal' | 'ui' | 'panels'>('appearance');

  const sections = [
    { id: 'appearance' as const, label: 'Appearance' },
    { id: 'terminal' as const, label: 'Terminal' },
    { id: 'ui' as const, label: 'Scrollback' },
    { id: 'panels' as const, label: 'Panels' },
  ];

  const fontFamilies = [
    'Menlo',
    'Monaco',
    'SF Mono',
    'JetBrains Mono',
    'Fira Code',
    'Consolas',
  ];

  const autoSaveOptions = [
    { value: 0, label: 'Disabled' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
    { value: 30, label: '30 seconds' },
    { value: 60, label: '60 seconds' },
  ];

  const defaultPromptPatterns = [
    '\\u@\\h:\\d\\p',
    '\\h \\u[\\d]\\p',
    '[\\u@\\h \\d]\\p',
  ];

  const scrollbackOptions = [
    { value: 1000, label: '1,000 lines' },
    { value: 5000, label: '5,000 lines' },
    { value: 10000, label: '10,000 lines' },
    { value: 0, label: 'Unlimited' },
  ];

  const allThemes = $derived([...builtinThemes, ...preferencesStore.customThemes]);

  const selectedTheme = $derived(
    getTheme(preferencesStore.theme, preferencesStore.customThemes)
  );

  function createNewTheme() {
    const source = selectedTheme;
    const newTheme = {
      ...structuredClone(source),
      id: `custom-${crypto.randomUUID()}`,
      name: `Custom ${source.name}`,
    };
    preferencesStore.addCustomTheme(newTheme);
    preferencesStore.setTheme(newTheme.id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      getCurrentWindow().close();
    }
    // Cmd+W - close preferences window
    if (isModKey(e) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      getCurrentWindow().close();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="window">
  <div class="titlebar">
    <span class="title">Preferences</span>
  </div>

  <div class="body">
    <nav class="sidebar">
      {#each sections as section (section.id)}
        <button
          class="sidebar-item"
          class:active={activeSection === section.id}
          onclick={() => activeSection = section.id}
        >
          {section.label}
        </button>
      {/each}
    </nav>

    <div class="section-content">
      {#if activeSection === 'appearance'}
        <h3 class="section-heading">Theme</h3>
        <div class="theme-grid">
          {#each allThemes as t (t.id)}
            <div
              class="theme-swatch"
              class:active={preferencesStore.theme === t.id}
              onclick={() => preferencesStore.setTheme(t.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') preferencesStore.setTheme(t.id); }}
              role="button"
              tabindex="0"
              title={t.name}
            >
              <div class="swatch-colors">
                <span class="swatch-bar" style:background={t.terminal.background}></span>
                <span class="swatch-bar" style:background={t.terminal.red}></span>
                <span class="swatch-bar" style:background={t.terminal.green}></span>
                <span class="swatch-bar" style:background={t.terminal.yellow}></span>
                <span class="swatch-bar" style:background={t.terminal.blue}></span>
                <span class="swatch-bar" style:background={t.terminal.magenta}></span>
                <span class="swatch-bar" style:background={t.terminal.cyan}></span>
              </div>
              <span class="swatch-label">{t.name}</span>
              {#if !isBuiltinTheme(t.id)}
                <button
                  class="swatch-delete"
                  onclick={(e) => { e.stopPropagation(); preferencesStore.deleteCustomTheme(t.id); }}
                  title="Delete custom theme"
                >&times;</button>
              {/if}
            </div>
          {/each}
          <button class="theme-swatch new-theme" onclick={createNewTheme} title="Create new theme from current">
            <div class="new-theme-icon">+</div>
            <span class="swatch-label">New Theme</span>
          </button>
        </div>

        <ThemeEditor theme={selectedTheme} />
      {:else if activeSection === 'terminal'}
        <div class="setting" style="align-items: flex-start;">
          <div>
            <label for="restore-session">Restore on Relaunch</label>
            <p class="setting-hint">
              Restore working directory and SSH sessions when the app restarts.
            </p>
          </div>
          <button
            id="restore-session"
            class="toggle"
            class:active={preferencesStore.restoreSession}
            onclick={() => preferencesStore.setRestoreSession(!preferencesStore.restoreSession)}
            aria-pressed={preferencesStore.restoreSession}
            aria-label="Toggle session restore on relaunch"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="font-size">Font Size</label>
          <div class="number-input-wrapper">
            <button class="number-btn" onclick={() => preferencesStore.setFontSize(preferencesStore.fontSize - 1)}>−</button>
            <input
              type="number"
              id="font-size"
              class="number-input"
              min="10"
              max="24"
              value={preferencesStore.fontSize}
              onchange={(e) => preferencesStore.setFontSize(parseInt(e.currentTarget.value) || 13)}
            />
            <button class="number-btn" onclick={() => preferencesStore.setFontSize(preferencesStore.fontSize + 1)}>+</button>
          </div>
        </div>

        <div class="setting">
          <label for="font-family">Font Family</label>
          <select
            id="font-family"
            value={preferencesStore.fontFamily}
            onchange={(e) => preferencesStore.setFontFamily(e.currentTarget.value)}
          >
            {#each fontFamilies as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
        </div>

        <div class="setting">
          <span class="label-text">Cursor Style</span>
          <div class="radio-group">
            {#each ['block', 'underline', 'bar'] as style}
              <label class="radio-label">
                <input
                  type="radio"
                  name="cursor-style"
                  value={style}
                  checked={preferencesStore.cursorStyle === style}
                  onchange={() => preferencesStore.setCursorStyle(style as CursorStyle)}
                />
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </label>
            {/each}
          </div>
        </div>

        <div class="setting">
          <label for="cursor-blink">Cursor Blink</label>
          <button
            id="cursor-blink"
            class="toggle"
            class:active={preferencesStore.cursorBlink}
            onclick={() => preferencesStore.setCursorBlink(!preferencesStore.cursorBlink)}
            aria-pressed={preferencesStore.cursorBlink}
            aria-label="Toggle cursor blink"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <h3 class="section-heading" style="margin-top: 20px;">Shell Integration</h3>

        <div class="setting" style="align-items: flex-start;">
          <div>
            <label for="shell-title">Auto-set Tab Title</label>
            <p class="setting-hint">
              Updates tab title with user@host:path on each prompt.
              Applies to new terminals only.
            </p>
          </div>
          <button
            id="shell-title"
            class="toggle"
            class:active={preferencesStore.shellTitleIntegration}
            onclick={() => preferencesStore.setShellTitleIntegration(!preferencesStore.shellTitleIntegration)}
            aria-pressed={preferencesStore.shellTitleIntegration}
            aria-label="Toggle shell title integration"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting" style="align-items: flex-start;">
          <div>
            <label for="shell-integration">Command Completion</label>
            <p class="setting-hint">
              Detect when commands start and finish. Shows completion indicators on inactive tabs.
              Applies to new terminals only.
            </p>
          </div>
          <button
            id="shell-integration"
            class="toggle"
            class:active={preferencesStore.shellIntegration}
            onclick={() => preferencesStore.setShellIntegration(!preferencesStore.shellIntegration)}
            aria-pressed={preferencesStore.shellIntegration}
            aria-label="Toggle shell integration"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>
      {:else if activeSection === 'ui'}
        <div class="setting">
          <label for="auto-save">Auto-save Interval</label>
          <select
            id="auto-save"
            value={preferencesStore.autoSaveInterval}
            onchange={(e) => preferencesStore.setAutoSaveInterval(parseInt(e.currentTarget.value))}
          >
            {#each autoSaveOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <div class="setting">
          <label for="scrollback">Scrollback Limit</label>
          <select
            id="scrollback"
            value={preferencesStore.scrollbackLimit}
            onchange={(e) => preferencesStore.setScrollbackLimit(parseInt(e.currentTarget.value))}
          >
            {#each scrollbackOptions as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
      {:else if activeSection === 'panels'}
        <h3 class="section-heading">Duplication</h3>
        <p class="section-desc">
          What to clone when splitting a pane (<kbd>{modLabel}+D</kbd>).
        </p>

        <div class="setting">
          <label for="clone-cwd">Working Directory</label>
          <button
            id="clone-cwd"
            class="toggle"
            class:active={preferencesStore.cloneCwd}
            onclick={() => preferencesStore.setCloneCwd(!preferencesStore.cloneCwd)}
            aria-pressed={preferencesStore.cloneCwd}
            aria-label="Toggle clone working directory"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="clone-scrollback">Scrollback Buffer</label>
          <button
            id="clone-scrollback"
            class="toggle"
            class:active={preferencesStore.cloneScrollback}
            onclick={() => preferencesStore.setCloneScrollback(!preferencesStore.cloneScrollback)}
            aria-pressed={preferencesStore.cloneScrollback}
            aria-label="Toggle clone scrollback buffer"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="clone-ssh">SSH Session</label>
          <button
            id="clone-ssh"
            class="toggle"
            class:active={preferencesStore.cloneSsh}
            onclick={() => preferencesStore.setCloneSsh(!preferencesStore.cloneSsh)}
            aria-pressed={preferencesStore.cloneSsh}
            aria-label="Toggle clone SSH session"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="clone-history">Shell History</label>
          <button
            id="clone-history"
            class="toggle"
            class:active={preferencesStore.cloneHistory}
            onclick={() => preferencesStore.setCloneHistory(!preferencesStore.cloneHistory)}
            aria-pressed={preferencesStore.cloneHistory}
            aria-label="Toggle clone shell history"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <h3 class="section-heading">Prompt Patterns</h3>
        <p class="section-desc">
          Patterns for detecting the remote directory when splitting SSH panes.
          This lets cloned terminals automatically <code>cd</code> to the source directory on the remote host.
          Use <code>\h</code> hostname, <code>\u</code> username, <code>\d</code> directory, <code>\p</code> prompt char (<code>$ # % &gt;</code>).
        </p>

        {#each preferencesStore.promptPatterns as pattern, idx}
          <div class="pattern-row">
            <input
              type="text"
              class="pattern-input"
              value={pattern}
              placeholder={'e.g. \\h \\u[\\d]\\p'}
              onchange={(e) => {
                const updated = [...preferencesStore.promptPatterns];
                updated[idx] = e.currentTarget.value;
                preferencesStore.setPromptPatterns(updated);
              }}
            />
            <button
              class="pattern-delete"
              onclick={() => {
                const updated = preferencesStore.promptPatterns.filter((_, i) => i !== idx);
                preferencesStore.setPromptPatterns(updated);
              }}
              title="Remove pattern"
            >&times;</button>
          </div>
        {/each}

        <div class="pattern-actions">
          <button
            class="add-pattern-btn"
            onclick={() => preferencesStore.setPromptPatterns([...preferencesStore.promptPatterns, ''])}
          >+ Add Pattern</button>
          <button
            class="add-pattern-btn"
            onclick={() => preferencesStore.setPromptPatterns([...defaultPromptPatterns])}
          >Reset to Defaults</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-medium);
  }

  .titlebar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 38px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--bg-light);
    -webkit-app-region: drag;
    padding-left: 78px; /* space for macOS traffic lights */
    padding-right: 78px;
    user-select: none;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sidebar {
    width: 140px;
    flex-shrink: 0;
    border-right: 1px solid var(--bg-light);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sidebar-item {
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 13px;
    color: var(--fg-dim);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    -webkit-app-region: no-drag;
  }

  .sidebar-item:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .sidebar-item.active {
    background: var(--bg-dark);
    color: var(--fg);
  }

  .section-content {
    flex: 1;
    padding: 20px;
    overflow-y: auto;
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .setting:last-child {
    margin-bottom: 0;
  }

  .setting-hint {
    font-size: 11px;
    color: var(--fg-dim);
    margin: 2px 0 0 0;
    line-height: 1.4;
    max-width: 260px;
  }

  .setting > label,
  .setting > .label-text {
    font-size: 13px;
    color: var(--fg);
  }

  .number-input-wrapper {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    overflow: hidden;
  }

  .number-input {
    width: 48px;
    text-align: center;
    background: var(--bg-dark);
    border: none;
    border-left: 1px solid var(--bg-light);
    border-right: 1px solid var(--bg-light);
    padding: 6px 4px;
    font-size: 13px;
    color: var(--fg);
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .number-input::-webkit-inner-spin-button,
  .number-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .number-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 32px;
    padding: 0;
    background: var(--bg-dark);
    color: var(--fg-dim);
    font-size: 14px;
    cursor: pointer;
    border: none;
    border-radius: 0;
  }

  .number-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  select {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    color: var(--fg);
    cursor: pointer;
    min-width: 140px;
  }

  select:hover {
    border-color: var(--accent);
  }

  .radio-group {
    display: flex;
    gap: 16px;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--fg);
    cursor: pointer;
  }

  input[type="radio"] {
    cursor: pointer;
  }

  .toggle {
    position: relative;
    width: 40px;
    height: 22px;
    background: var(--bg-light);
    border-radius: 11px;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .toggle.active {
    background: var(--accent);
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  .toggle.active .toggle-knob {
    transform: translateX(18px);
  }

  .section-heading {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 8px 0;
  }

  .section-heading:not(:first-child) {
    margin-top: 24px;
  }

  .section-desc {
    font-size: 12px;
    color: var(--fg-dim);
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .section-desc kbd {
    background: var(--bg-dark);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
    font-family: inherit;
  }

  .section-desc code {
    background: var(--bg-dark);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  .pattern-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .pattern-input {
    flex: 1;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    font-family: 'Menlo', Monaco, monospace;
    color: var(--fg);
  }

  .pattern-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  .pattern-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    color: var(--fg-dim);
    border-radius: 4px;
    font-size: 14px;
  }

  .pattern-delete:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .pattern-actions {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
  }

  .add-pattern-btn {
    font-size: 12px;
    color: var(--fg-dim);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .add-pattern-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .theme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .theme-swatch {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 6px;
    border: 2px solid transparent;
    background: var(--bg-dark);
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .theme-swatch:hover {
    border-color: var(--bg-light);
  }

  .theme-swatch.active {
    border-color: var(--accent);
  }

  .swatch-colors {
    display: flex;
    gap: 2px;
    height: 20px;
    border-radius: 3px;
    overflow: hidden;
  }

  .swatch-bar {
    flex: 1;
  }

  .swatch-label {
    font-size: 11px;
    color: var(--fg-dim);
    text-align: center;
  }

  .theme-swatch.active .swatch-label {
    color: var(--fg);
  }

  .swatch-delete {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--fg-dim);
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .theme-swatch:hover .swatch-delete {
    opacity: 1;
  }

  .swatch-delete:hover {
    color: var(--red, #f7768e);
    border-color: var(--red, #f7768e);
  }

  .new-theme {
    border: 2px dashed var(--bg-light);
    background: transparent;
    align-items: center;
    justify-content: center;
  }

  .new-theme:hover {
    border-color: var(--accent);
  }

  .new-theme-icon {
    font-size: 24px;
    color: var(--fg-dim);
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .new-theme:hover .new-theme-icon {
    color: var(--accent);
  }
</style>
