<script lang="ts">
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import type { CursorStyle, Trigger, TriggerActionType, TriggerActionEntry, VariableMapping, TabStateName } from '$lib/tauri/types';
  import { builtinThemes, getTheme, isBuiltinTheme } from '$lib/themes';
  import ThemeEditor from '$lib/components/ThemeEditor.svelte';
  import ResizableTextarea from '$lib/components/ResizableTextarea.svelte';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { modLabel, isModKey } from '$lib/utils/platform';
  import { getAllWorkspaces, listSystemSounds, playSystemSound } from '$lib/tauri/commands';
  import { tick, onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { DEFAULT_TRIGGERS, seedDefaultTriggers as seedDefaults } from '$lib/triggers/defaults';

  function actionsEqual(a: TriggerActionEntry[], b: TriggerActionEntry[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((ae, i) => {
      const be = b[i];
      return ae.action_type === be.action_type
        && (ae.command ?? null) === (be.command ?? null)
        && (ae.title ?? null) === (be.title ?? null)
        && (ae.message ?? null) === (be.message ?? null)
        && (ae.tab_state ?? null) === (be.tab_state ?? null);
    });
  }

  function variablesEqual(a: VariableMapping[], b: VariableMapping[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((av, i) => {
      const bv = b[i];
      return av.name === bv.name
        && av.group === bv.group
        && (av.template ?? null) === (bv.template ?? null);
    });
  }

  /** Check if a default trigger has been modified from its template. */
  function isDefaultModified(trigger: Trigger): boolean {
    if (!trigger.default_id) return false;
    const tmpl = DEFAULT_TRIGGERS[trigger.default_id];
    if (!tmpl) return false;
    return trigger.name !== tmpl.name
      || (trigger.description ?? '') !== (tmpl.description ?? '')
      || trigger.pattern !== tmpl.pattern
      || trigger.cooldown !== tmpl.cooldown
      || trigger.plain_text !== tmpl.plain_text
      || !actionsEqual(trigger.actions, tmpl.actions)
      || !variablesEqual(trigger.variables, tmpl.variables);
  }

  /** Restore a default trigger to its template values (keeps enabled, workspaces, id). */
  function restoreDefault(trigger: Trigger) {
    if (!trigger.default_id) return;
    const tmpl = DEFAULT_TRIGGERS[trigger.default_id];
    if (!tmpl) return;
    updateTrigger(trigger.id, {
      name: tmpl.name,
      description: tmpl.description ?? null,
      pattern: tmpl.pattern,
      cooldown: tmpl.cooldown,
      plain_text: tmpl.plain_text,
      actions: structuredClone(tmpl.actions),
      variables: structuredClone(tmpl.variables),
    });
  }

  // Workspace list for trigger scope multiselect
  let allWorkspaces = $state<{ id: string; name: string }[]>([]);
  // System sounds for notification sound picker
  let systemSounds = $state<string[]>([]);
  onMount(async () => {
    try {
      const pairs = await getAllWorkspaces();
      allWorkspaces = pairs.map(([id, name]) => ({ id, name }));
    } catch { /* preferences may open before main window */ }

    try {
      systemSounds = await listSystemSounds();
    } catch { /* sound listing may fail on some platforms */ }

    // Wait for preferences to finish loading before seeding defaults
    await preferencesStore.ready;
    seedDefaultTriggers();
  });

  function seedDefaultTriggers() {
    const result = seedDefaults(
      preferencesStore.triggers,
      preferencesStore.hiddenDefaultTriggers,
    );
    if (result) preferencesStore.setTriggers(result);
  }

  const sectionIds = ['appearance', 'terminal', 'ui', 'panels', 'notes', 'notifications', 'triggers'] as const;
  type SectionId = typeof sectionIds[number];
  const saved = localStorage.getItem('prefs-section');
  let activeSection = $state<SectionId>(
    saved && sectionIds.includes(saved as SectionId) ? saved as SectionId : 'appearance'
  );
  $effect(() => { localStorage.setItem('prefs-section', activeSection); });

  const sections = [
    { id: 'appearance' as const, label: 'Appearance' },
    { id: 'terminal' as const, label: 'Terminal' },
    { id: 'ui' as const, label: 'Scrollback' },
    { id: 'panels' as const, label: 'Panels' },
    { id: 'notes' as const, label: 'Notes' },
    { id: 'notifications' as const, label: 'Notifications' },
    { id: 'triggers' as const, label: 'Triggers' },
  ];

  let expandedTriggerId = $state<string | null>(null);

  function addTrigger() {
    const trigger: Trigger = {
      id: crypto.randomUUID(),
      name: '',
      description: null,
      pattern: '',
      actions: [],
      enabled: false,
      workspaces: [],
      cooldown: 5,
      variables: [],
      plain_text: false,
    };
    preferencesStore.setTriggers([...preferencesStore.triggers, trigger]);
    expandedTriggerId = trigger.id;
    tick().then(() => {
      const el = document.querySelector<HTMLInputElement>(`.trigger-card [data-trigger-name="${trigger.id}"]`);
      el?.focus();
    });
  }

  function updateTrigger(id: string, patch: Partial<Trigger>) {
    if (patch.variables) {
      patch.variables = [...patch.variables].sort((a, b) => a.group - b.group);
    }
    const updated = preferencesStore.triggers.map(t =>
      t.id === id ? { ...t, ...patch } : t
    );
    preferencesStore.setTriggers(updated);
  }

  let confirmDeleteId = $state<string | null>(null);

  function deleteTrigger(id: string) {
    const trigger = preferencesStore.triggers.find(t => t.id === id);
    if (trigger && (trigger.name || trigger.pattern)) {
      confirmDeleteId = id;
      return;
    }
    doDeleteTrigger(id);
  }

  function restoreAllDefaults() {
    preferencesStore.setHiddenDefaultTriggers([]);
    seedDefaultTriggers();
  }

  function doDeleteTrigger(id: string) {
    confirmDeleteId = null;
    const trigger = preferencesStore.triggers.find(t => t.id === id);
    // Track deleted defaults so they don't get re-seeded
    if (trigger?.default_id) {
      preferencesStore.setHiddenDefaultTriggers([...preferencesStore.hiddenDefaultTriggers, trigger.default_id]);
    }
    preferencesStore.setTriggers(preferencesStore.triggers.filter(t => t.id !== id));
    if (expandedTriggerId === id) expandedTriggerId = null;
  }

  function isValidRegex(pattern: string): boolean {
    if (!pattern) return true;
    try { new RegExp(pattern); return true; } catch { return false; }
  }

  /** Count capture groups in a regex pattern (0 if invalid). */
  function countCaptureGroups(pattern: string): number {
    if (!pattern) return 0;
    try {
      // Match the pattern against empty string — result.length - 1 = number of groups
      const re = new RegExp(pattern + '|');
      const m = ''.match(re);
      return m ? m.length - 1 : 0;
    } catch { return 0; }
  }

  /** Validate variable name. Returns error message or empty string if valid. */
  function varNameError(name: string): string {
    if (!name) return 'Name is required';
    if (/^\d/.test(name)) return 'Cannot start with a digit';
    if (/[^\w]/.test(name)) return 'Only letters, digits, and _';
    return '';
  }

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

        <h3 class="section-heading" style="margin-top: 20px;">Prompt Patterns</h3>
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

        <div class="setting">
          <label for="clone-notes">Notes</label>
          <button
            id="clone-notes"
            class="toggle"
            class:active={preferencesStore.cloneNotes}
            onclick={() => preferencesStore.setCloneNotes(!preferencesStore.cloneNotes)}
            aria-pressed={preferencesStore.cloneNotes}
            aria-label="Toggle clone notes"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="clone-auto-resume">Auto-Resume</label>
          <button
            id="clone-auto-resume"
            class="toggle"
            class:active={preferencesStore.cloneAutoResume}
            onclick={() => preferencesStore.setCloneAutoResume(!preferencesStore.cloneAutoResume)}
            aria-pressed={preferencesStore.cloneAutoResume}
            aria-label="Toggle clone auto-resume settings"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="clone-variables">Trigger Variables</label>
          <button
            id="clone-variables"
            class="toggle"
            class:active={preferencesStore.cloneVariables}
            onclick={() => preferencesStore.setCloneVariables(!preferencesStore.cloneVariables)}
            aria-pressed={preferencesStore.cloneVariables}
            aria-label="Toggle clone trigger variables"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

      {:else if activeSection === 'notes'}
        <h3 class="section-heading">Preview</h3>

        <div class="setting">
          <label for="notes-font-size">Font Size</label>
          <div class="number-input-wrapper">
            <button class="number-btn" onclick={() => preferencesStore.setNotesFontSize(preferencesStore.notesFontSize - 1)}>−</button>
            <input
              type="number"
              id="notes-font-size"
              class="number-input"
              min="10"
              max="24"
              value={preferencesStore.notesFontSize}
              onchange={(e) => preferencesStore.setNotesFontSize(parseInt(e.currentTarget.value) || 13)}
            />
            <button class="number-btn" onclick={() => preferencesStore.setNotesFontSize(preferencesStore.notesFontSize + 1)}>+</button>
          </div>
        </div>

        <div class="setting">
          <label for="notes-font-family">Font Family</label>
          <select
            id="notes-font-family"
            value={preferencesStore.notesFontFamily}
            onchange={(e) => preferencesStore.setNotesFontFamily(e.currentTarget.value)}
          >
            {#each fontFamilies as font}
              <option value={font}>{font}</option>
            {/each}
          </select>
        </div>

        <h3 class="section-heading">General</h3>

        <div class="setting" style="align-items: flex-start;">
          <div>
            <label for="migrate-tab-notes">Migrate Tab Notes</label>
            <p class="setting-hint">When closing a tab, move its notes to the workspace.</p>
          </div>
          <button
            id="migrate-tab-notes"
            class="toggle"
            class:active={preferencesStore.migrateTabNotes}
            onclick={() => preferencesStore.setMigrateTabNotes(!preferencesStore.migrateTabNotes)}
            aria-pressed={preferencesStore.migrateTabNotes}
            aria-label="Toggle migrate tab notes"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

        <div class="setting">
          <label for="notes-word-wrap">Word Wrap</label>
          <button
            id="notes-word-wrap"
            class="toggle"
            class:active={preferencesStore.notesWordWrap}
            onclick={() => preferencesStore.setNotesWordWrap(!preferencesStore.notesWordWrap)}
            aria-pressed={preferencesStore.notesWordWrap}
            aria-label="Toggle word wrap in notes"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>

      {:else if activeSection === 'notifications'}
        <div class="setting" style="align-items: flex-start;">
          <div>
            <label for="notification-mode">Notification Mode</label>
            <p class="setting-hint">
              {#if preferencesStore.notificationMode === 'auto'}
                In-app toasts when focused, OS notifications when unfocused.
              {:else if preferencesStore.notificationMode === 'in_app'}
                Always show in-app toasts inside the window.
              {:else if preferencesStore.notificationMode === 'native'}
                Always use OS notifications.
              {:else}
                Notifications are disabled.
              {/if}
            </p>
          </div>
          <select
            id="notification-mode"
            value={preferencesStore.notificationMode}
            onchange={(e) => preferencesStore.setNotificationMode(e.currentTarget.value)}
          >
            <option value="auto">Auto</option>
            <option value="in_app">In-App Only</option>
            <option value="native">Native Only</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {#if preferencesStore.notificationMode !== 'disabled'}
          <div class="setting">
            <label for="notification-sound">Sound</label>
            <div class="sound-picker">
              <select
                id="notification-sound"
                value={preferencesStore.notificationSound}
                onchange={(e) => {
                  const val = e.currentTarget.value;
                  preferencesStore.setNotificationSound(val);
                  if (val !== 'none') {
                    import('$lib/stores/notificationDispatch').then(m => m.playNotificationSoundPreview());
                  }
                }}
              >
                <option value="none">None</option>
                <option value="default">Default (Built-in)</option>
                {#each systemSounds as sound}
                  <option value={sound}>{sound}</option>
                {/each}
              </select>
              {#if preferencesStore.notificationSound !== 'none'}
                <button
                  class="preview-sound-btn"
                  onclick={() => {
                    import('$lib/stores/notificationDispatch').then(m => m.playNotificationSoundPreview());
                  }}
                  title="Preview sound"
                >&#9654;</button>
              {/if}
            </div>
          </div>

          {#if preferencesStore.notificationSound !== 'none'}
            <div class="setting">
              <label for="notification-volume">Volume</label>
              <div class="volume-wrapper">
                <input
                  type="range"
                  id="notification-volume"
                  class="volume-slider"
                  min="0"
                  max="100"
                  value={preferencesStore.notificationVolume}
                  oninput={(e) => preferencesStore.setNotificationVolume(parseInt(e.currentTarget.value))}
                />
                <span class="volume-label">{preferencesStore.notificationVolume}%</span>
              </div>
            </div>
          {/if}

          <div class="setting" style="align-items: flex-start;">
            <div>
              <label for="notify-duration">Command Threshold</label>
              <p class="setting-hint">
                Only notify on command completion if it ran longer than this.
              </p>
            </div>
            <select
              id="notify-duration"
              value={preferencesStore.notifyMinDuration}
              onchange={(e) => preferencesStore.setNotifyMinDuration(parseInt(e.currentTarget.value))}
            >
              <option value={0}>Always</option>
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
            </select>
          </div>
        {/if}

        {#if preferencesStore.notificationMode !== 'disabled' && preferencesStore.notificationMode !== 'native'}
          <h3 class="section-heading" style="margin-top: 20px;">In-App Toast</h3>

          <div class="setting">
            <label for="toast-duration">Display Duration</label>
            <select
              id="toast-duration"
              value={preferencesStore.toastDuration}
              onchange={(e) => preferencesStore.setToastDuration(parseInt(e.currentTarget.value))}
            >
              <option value={3}>3 seconds</option>
              <option value={5}>5 seconds</option>
              <option value={8}>8 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds</option>
            </select>
          </div>

          <div class="setting">
            <label for="toast-font-size">Font Size</label>
            <div class="number-input-wrapper">
              <button class="number-btn" onclick={() => preferencesStore.setToastFontSize(preferencesStore.toastFontSize - 1)}>−</button>
              <input
                type="number"
                id="toast-font-size"
                class="number-input"
                min="10"
                max="24"
                value={preferencesStore.toastFontSize}
                onchange={(e) => preferencesStore.setToastFontSize(parseInt(e.currentTarget.value) || 14)}
              />
              <button class="number-btn" onclick={() => preferencesStore.setToastFontSize(preferencesStore.toastFontSize + 1)}>+</button>
            </div>
          </div>

          <div class="setting">
            <label for="toast-width">Max Width</label>
            <div class="number-input-wrapper">
              <button class="number-btn" onclick={() => preferencesStore.setToastWidth(preferencesStore.toastWidth - 20)}>−</button>
              <input
                type="number"
                id="toast-width"
                class="number-input"
                min="280"
                max="600"
                value={preferencesStore.toastWidth}
                onchange={(e) => preferencesStore.setToastWidth(parseInt(e.currentTarget.value) || 400)}
              />
              <button class="number-btn" onclick={() => preferencesStore.setToastWidth(preferencesStore.toastWidth + 20)}>+</button>
            </div>
          </div>
        {/if}

      {:else if activeSection === 'triggers'}
        <p class="section-desc">
          Triggers watch terminal output for regex patterns and react with actions.
          Each trigger has a cooldown to prevent firing in rapid loops.
        </p>

        <div style="display: flex; gap: 8px; margin-bottom: 12px;">
          <button class="add-pattern-btn" onclick={addTrigger}>+ Add Trigger</button>
          {#if preferencesStore.hiddenDefaultTriggers.length > 0}
            <button class="add-pattern-btn" onclick={restoreAllDefaults}>Restore Defaults</button>
          {/if}
        </div>

        {#each preferencesStore.triggers as trigger (trigger.id)}
          <div class="trigger-card">
            <div class="trigger-header" class:trigger-header-expanded={expandedTriggerId === trigger.id}>
              <button
                class="toggle small"
                class:active={trigger.enabled}
                onclick={() => updateTrigger(trigger.id, { enabled: !trigger.enabled })}
                aria-pressed={trigger.enabled}
                aria-label="Toggle trigger"
              >
                <span class="toggle-knob"></span>
              </button>
              <button
                class="trigger-name-btn"
                onclick={() => expandedTriggerId = expandedTriggerId === trigger.id ? null : trigger.id}
              >
                <svg class="trigger-chevron" class:expanded={expandedTriggerId === trigger.id} width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 3l5 5-5 5z"/></svg>
                {trigger.name || 'Unnamed'}
              </button>
              {#if trigger.default_id}
                <button
                  class="restore-default-btn"
                  disabled={!isDefaultModified(trigger)}
                  onclick={() => restoreDefault(trigger)}
                  title="Restore to default"
                >Reset</button>
              {/if}
              {#if confirmDeleteId === trigger.id}
                <span class="confirm-delete">
                  <span class="confirm-delete-label">Delete?</span>
                  <button class="confirm-delete-btn confirm-yes" onclick={() => doDeleteTrigger(trigger.id)}>Yes</button>
                  <button class="confirm-delete-btn confirm-no" onclick={() => { confirmDeleteId = null; }}>No</button>
                </span>
              {:else}
                <button
                  class="pattern-delete trigger-delete"
                  onclick={() => deleteTrigger(trigger.id)}
                  title="Delete trigger"
                ><Icon name="trash" /></button>
              {/if}
            </div>

            {#if expandedTriggerId === trigger.id}
              <div class="trigger-body" transition:slide={{ duration: 150 }}>
                <div class="trigger-field">
                  <label>Name</label>
                  <input
                    type="text"
                    class="pattern-input"
                    data-trigger-name={trigger.id}
                    value={trigger.name}
                    placeholder="e.g. Capture session ID"
                    onchange={(e) => updateTrigger(trigger.id, { name: e.currentTarget.value })}
                  />
                </div>

                <div class="trigger-field">
                  <label>Description</label>
                  <ResizableTextarea
                    value={trigger.description ?? ''}
                    placeholder="What does this trigger do?"
                    rows={1}
                    maxHeight={120}
                    onchange={(v) => updateTrigger(trigger.id, { description: v || null })}
                  />
                </div>

                <div class="trigger-section">
                  <h4 class="trigger-section-heading">When</h4>

                  <div class="trigger-field">
                    <div class="pattern-label-row">
                      <label>
                        Pattern
                        {#if trigger.plain_text}
                          <span class="field-hint">(spaces match TUI gaps)</span>
                        {:else}
                          <span class="field-hint">(regex, supports multiline)</span>
                        {/if}
                      </label>
                      <Tooltip text="Match what you see on screen. TUI apps like Claude Code position text with escape codes — plain text mode ignores those gaps so your pattern matches the visible words. Use (option A|option B) for alternation.">
                        <label class="plain-text-toggle">
                          <input type="checkbox" checked={trigger.plain_text} onchange={() => updateTrigger(trigger.id, { plain_text: !trigger.plain_text })} />
                          Plain text
                        </label>
                      </Tooltip>
                    </div>
                    <ResizableTextarea
                      value={trigger.pattern}
                      placeholder={trigger.plain_text
                        ? "e.g. Would you like to proceed?"
                        : "e.g. error|fail\nor multiline: Resume.*?--resume ([a-z0-9\\-]*)"}
                      rows={2}
                      maxHeight={200}
                      mono
                      invalid={!trigger.plain_text && !isValidRegex(trigger.pattern)}
                      onchange={(v) => updateTrigger(trigger.id, { pattern: v })}
                    />
                  </div>

                  <div class="trigger-inline-fields">
                    <div class="trigger-field" style="flex: none;">
                      <label>Cooldown <span class="field-hint">(seconds)</span></label>
                      <input
                        type="text"
                        inputmode="decimal"
                        class="pattern-input no-spinner"
                        style="width: 80px;"
                        value={trigger.cooldown}
                        onchange={(e) => updateTrigger(trigger.id, { cooldown: Math.max(0, parseFloat(e.currentTarget.value) || 0) })}
                      />
                    </div>
                    <div class="trigger-field" style="flex: 1; min-width: 0;">
                      <label>Workspaces <span class="field-hint">(unchecked = all)</span></label>
                      {#if allWorkspaces.length}
                        <div class="workspace-chips">
                          {#each allWorkspaces as ws}
                            <label class="workspace-chip" class:selected={trigger.workspaces.includes(ws.id)}>
                              <input
                                type="checkbox"
                                checked={trigger.workspaces.includes(ws.id)}
                                onchange={() => {
                                  const cur = trigger.workspaces;
                                  const next = cur.includes(ws.id)
                                    ? cur.filter(id => id !== ws.id)
                                    : [...cur, ws.id];
                                  updateTrigger(trigger.id, { workspaces: next });
                                }}
                              />
                              {ws.name}
                            </label>
                          {/each}
                        </div>
                      {:else}
                        <span class="field-hint">No workspaces found</span>
                      {/if}
                    </div>
                  </div>
                </div>

                <div class="trigger-section">
                  <h4 class="trigger-section-heading">Capture <span class="field-hint">use %varName in tab titles and auto-resume commands</span></h4>

                  {#each trigger.variables as vm, vi}
                    {@const groupCount = countCaptureGroups(trigger.pattern)}
                    {@const nameErr = varNameError(vm.name)}
                    {@const groupErr = groupCount > 0 && vm.group > groupCount ? `Pattern has ${groupCount} group${groupCount === 1 ? '' : 's'}` : ''}
                    <div class="var-row-wrap">
                    <div class="var-row">
                      <input
                        type="text"
                        class="pattern-input var-name-input"
                        class:var-field-invalid={!!nameErr}
                        value={vm.name}
                        placeholder="varName"
                        onchange={(e) => {
                          const newName = e.currentTarget.value.trim();
                          const vars = trigger.variables.map((v, i) =>
                            i === vi ? { ...v, name: newName } : v
                          );
                          updateTrigger(trigger.id, { variables: vars });
                        }}
                      />
                      <span class="var-arrow">&larr; group</span>
                      <input
                        type="text"
                        inputmode="numeric"
                        class="pattern-input var-idx-input"
                        class:var-field-invalid={!!groupErr}
                        value={vm.group}
                        onchange={(e) => {
                          const num = parseInt(e.currentTarget.value) || 1;
                          const clamped = Math.max(1, num);
                          const vars = trigger.variables.map((v, i) =>
                            i === vi ? { ...v, group: clamped } : v
                          );
                          updateTrigger(trigger.id, { variables: vars });
                        }}
                      />
                      <span class="var-arrow">template</span>
                      <input
                        type="text"
                        class="pattern-input var-template-input"
                        value={vm.template ?? ''}
                        placeholder="% (raw value)"
                        onchange={(e) => {
                          const val = e.currentTarget.value;
                          const vars = trigger.variables.map((v, i) =>
                            i === vi ? { ...v, template: val || undefined } : v
                          );
                          updateTrigger(trigger.id, { variables: vars });
                        }}
                      />
                      <button
                        class="pattern-delete"
                        onclick={() => {
                          const vars = trigger.variables.filter((_, i) => i !== vi);
                          updateTrigger(trigger.id, { variables: vars });
                        }}
                        title="Remove variable"
                      >&times;</button>
                    </div>
                    {#if nameErr || groupErr}
                      <div class="var-error">{nameErr || groupErr}</div>
                    {/if}
                    </div>
                  {/each}
                  <button
                    class="add-pattern-btn"
                    onclick={() => {
                      const vars: VariableMapping[] = [...trigger.variables, { name: `var${trigger.variables.length + 1}`, group: 1 }];
                      updateTrigger(trigger.id, { variables: vars });
                    }}
                  >+ Add Variable</button>
                </div>

                <div class="trigger-section">
                  <h4 class="trigger-section-heading">Then</h4>

                  {#each trigger.actions as entry, ai}
                    <div class="action-row">
                      <select
                        class="pattern-input action-type-select"
                        value={entry.action_type}
                        onchange={(e) => {
                          const newType = e.currentTarget.value as TriggerActionType;
                          const actions = trigger.actions.map((a, i) =>
                            i === ai ? {
                              ...a,
                              action_type: newType,
                              // Default tab_state when switching to set_tab_state
                              tab_state: newType === 'set_tab_state' ? (a.tab_state ?? 'alert') : a.tab_state,
                            } : a
                          );
                          updateTrigger(trigger.id, { actions });
                        }}
                      >
                        <option value="notify">Notify</option>
                        <option value="send_command">Send Command</option>
                        <option value="set_tab_state">Change Tab State</option>
                      </select>
                      {#if entry.action_type === 'send_command'}
                        <input
                          type="text"
                          class="pattern-input mono action-command-input"
                          value={entry.command ?? ''}
                          placeholder="e.g. echo triggered"
                          onchange={(e) => {
                            const actions = trigger.actions.map((a, i) =>
                              i === ai ? { ...a, command: e.currentTarget.value || null } : a
                            );
                            updateTrigger(trigger.id, { actions });
                          }}
                        />
                      {:else if entry.action_type === 'notify'}
                        <div class="notify-fields">
                          <input
                            type="text"
                            class="pattern-input action-command-input"
                            value={entry.title ?? ''}
                            placeholder="title (default: %tabtitle)"
                            onchange={(e) => {
                              const actions = trigger.actions.map((a, i) =>
                                i === ai ? { ...a, title: e.currentTarget.value || null } : a
                              );
                              updateTrigger(trigger.id, { actions });
                            }}
                          />
                          <input
                            type="text"
                            class="pattern-input action-command-input"
                            value={entry.message ?? ''}
                            placeholder="body"
                            onchange={(e) => {
                              const actions = trigger.actions.map((a, i) =>
                                i === ai ? { ...a, message: e.currentTarget.value || null } : a
                              );
                              updateTrigger(trigger.id, { actions });
                            }}
                          />
                        </div>
                        <Tooltip text={"%title — OSC title (set by program)\n%tab — tab name from workspace\n%tabtitle — full tab display name\n%varName — trigger capture variables"}>
                          <span class="notify-help">?</span>
                        </Tooltip>
                      {:else if entry.action_type === 'set_tab_state'}
                        <select
                          class="pattern-input action-type-select"
                          value={entry.tab_state ?? 'alert'}
                          onchange={(e) => {
                            const actions = trigger.actions.map((a, i) =>
                              i === ai ? { ...a, tab_state: e.currentTarget.value as TabStateName } : a
                            );
                            updateTrigger(trigger.id, { actions });
                          }}
                        >
                          <option value="alert">Alert</option>
                          <option value="question">Question</option>
                        </select>
                      {/if}
                      <button
                        class="pattern-delete"
                        onclick={() => {
                          const actions = trigger.actions.filter((_, i) => i !== ai);
                          updateTrigger(trigger.id, { actions });
                        }}
                        title="Remove action"
                      >&times;</button>
                    </div>
                  {/each}
                  <button
                    class="add-pattern-btn"
                    onclick={() => {
                      const actions = [...trigger.actions, { action_type: 'notify' as TriggerActionType, command: null, title: null, message: null, tab_state: null }];
                      updateTrigger(trigger.id, { actions });
                    }}
                  >+ Add Action</button>
                </div>
              </div>
            {/if}
          </div>
        {/each}

        {#if !preferencesStore.triggers.length}
          <p class="section-desc" style="margin-top: 8px;">No triggers configured.</p>
        {/if}
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
  .trigger-delete:hover {
    color: var(--red, #f7768e);
  }
  .restore-default-btn {
    font-size: 11px;
    color: var(--fg);
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .restore-default-btn:hover:not(:disabled) {
    color: var(--fg);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, var(--bg-dark));
  }
  .restore-default-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .confirm-delete {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .confirm-delete-label {
    color: var(--red, #f7768e);
  }
  .confirm-delete-btn {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .confirm-yes {
    background: var(--red, #f7768e);
    color: var(--bg-dark);
  }
  .confirm-yes:hover {
    opacity: 0.85;
  }
  .confirm-no {
    background: var(--bg-light);
    color: var(--fg);
  }
  .confirm-no:hover {
    background: var(--fg-dim);
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

  /* Triggers */
  .trigger-card {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    margin-bottom: 8px;
  }

  .trigger-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
  }
  .trigger-header-expanded {
    background: var(--bg-light);
    border-radius: 6px 6px 0 0;
  }
  .trigger-header-expanded .trigger-chevron,
  .trigger-header-expanded .trigger-delete {
    color: var(--fg);
  }

  .toggle.small {
    width: 32px;
    height: 18px;
    border-radius: 9px;
    flex-shrink: 0;
  }

  .toggle.small .toggle-knob {
    width: 14px;
    height: 14px;
  }

  .toggle.small.active .toggle-knob {
    transform: translateX(14px);
  }

  .trigger-name-btn {
    flex: 1;
    text-align: left;
    font-size: 13px;
    color: var(--fg);
    padding: 4px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .trigger-name-btn:hover {
    color: var(--accent);
  }

  .trigger-chevron {
    color: var(--fg-dim);
    flex-shrink: 0;
    transition: transform 0.15s;
  }

  .trigger-chevron.expanded {
    transform: rotate(90deg);
  }

  .trigger-body {
    padding: 8px 10px 12px;
    border-top: 1px solid var(--bg-light);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .trigger-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid color-mix(in srgb, var(--bg-light) 50%, transparent);
  }

  .trigger-section-heading {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .trigger-inline-fields {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .trigger-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trigger-field > label {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .field-hint {
    font-size: 11px;
    color: var(--fg-dim);
    opacity: 0.7;
  }

  .pattern-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .plain-text-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--fg-dim);
    cursor: pointer;
  }

  .plain-text-toggle input[type="checkbox"] {
    margin: 0;
    cursor: pointer;
  }

  .pattern-input.mono {
    font-family: 'Menlo', Monaco, monospace;
  }

  .workspace-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .workspace-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
    color: var(--fg-dim);
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    cursor: pointer;
    user-select: none;
    transition: border-color 0.1s, color 0.1s;
  }

  .workspace-chip input[type="checkbox"] {
    display: none;
  }

  .workspace-chip.selected {
    color: var(--fg);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-dark));
  }

  .workspace-chip:hover {
    border-color: var(--fg-dim);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .action-type-select {
    flex: none;
    width: 140px;
  }

  .action-command-input {
    flex: 1;
    min-width: 0;
  }

  .notify-fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .notify-help {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-light);
    color: var(--fg-dim);
    font-size: 11px;
    font-weight: 600;
    cursor: help;
    flex-shrink: 0;
  }

  .var-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .var-name-input {
    flex: 1;
    min-width: 0;
  }

  .var-arrow {
    font-size: 11px;
    color: var(--fg-dim);
    white-space: nowrap;
  }

  .var-idx-input {
    width: 40px;
    flex: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .var-idx-input::-webkit-inner-spin-button,
  .var-idx-input::-webkit-outer-spin-button,
  .no-spinner::-webkit-inner-spin-button,
  .no-spinner::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .no-spinner {
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .var-field-invalid {
    border-color: var(--red, #f7768e) !important;
    color: var(--red, #f7768e);
  }
  .var-row-wrap {
    display: contents;
  }
  .var-error {
    font-size: 11px;
    color: var(--red, #f7768e);
    margin: -2px 0 4px 0;
  }

  .var-template-input {
    flex: 1;
    min-width: 0;
  }

  .sound-picker {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .preview-sound-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    color: var(--fg-dim);
    font-size: 12px;
    cursor: pointer;
  }

  .preview-sound-btn:hover {
    border-color: var(--accent);
    color: var(--fg);
  }

  .volume-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .volume-slider {
    width: 120px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .volume-label {
    font-size: 12px;
    color: var(--fg-dim);
    min-width: 32px;
    text-align: right;
  }
</style>
