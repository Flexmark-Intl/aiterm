<script lang="ts">
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import type { CursorStyle } from '$lib/tauri/types';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

  const fontFamilies = [
    'Menlo',
    'Monaco',
    'SF Mono',
    'JetBrains Mono',
    'Fira Code',
  ];

  const autoSaveOptions = [
    { value: 0, label: 'Disabled' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
    { value: 30, label: '30 seconds' },
    { value: 60, label: '60 seconds' },
  ];

  const scrollbackOptions = [
    { value: 1000, label: '1,000 lines' },
    { value: 5000, label: '5,000 lines' },
    { value: 10000, label: '10,000 lines' },
    { value: 0, label: 'Unlimited' },
  ];

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }
</script>

{#if open}
  <div
    class="backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="modal">
      <div class="header">
        <h2>Preferences</h2>
        <button class="close-btn" onclick={onclose}>&times;</button>
      </div>

      <div class="content">
        <section>
          <h3>Terminal</h3>

          <div class="setting">
            <label for="font-size">Font Size</label>
            <div class="range-wrapper">
              <input
                type="range"
                id="font-size"
                min="10"
                max="24"
                value={preferencesStore.fontSize}
                oninput={(e) => preferencesStore.setFontSize(parseInt(e.currentTarget.value))}
              />
              <span class="range-value">{preferencesStore.fontSize}px</span>
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
        </section>

        <section>
          <h3>UI</h3>

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
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    width: 400px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--bg-light);
  }

  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--fg);
  }

  .close-btn {
    font-size: 20px;
    color: var(--fg-dim);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .content {
    padding: 16px 20px;
  }

  section {
    margin-bottom: 24px;
  }

  section:last-child {
    margin-bottom: 0;
  }

  h3 {
    margin: 0 0 16px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .setting:last-child {
    margin-bottom: 0;
  }

  .setting > label,
  .setting > .label-text {
    font-size: 13px;
    color: var(--fg);
  }

  .range-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  input[type="range"] {
    width: 120px;
    height: 4px;
    background: var(--bg-light);
    border-radius: 2px;
    cursor: pointer;
  }

  .range-value {
    font-size: 12px;
    color: var(--fg-dim);
    min-width: 36px;
    text-align: right;
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
</style>
