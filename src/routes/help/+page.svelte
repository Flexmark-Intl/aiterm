<script lang="ts">
  import { modLabel, altLabel } from '$lib/utils/platform';
  import { slide } from 'svelte/transition';

  import { onMount } from 'svelte';

  const sectionIds = ['shortcuts', 'editor', 'claude', 'tips'] as const;
  type SectionId = typeof sectionIds[number];

  function getInitialSection(): SectionId {
    // Query param takes priority (set when opening window with a specific section)
    const params = new URLSearchParams(window.location.search);
    const fromParam = params.get('section');
    if (fromParam && sectionIds.includes(fromParam as SectionId)) return fromParam as SectionId;
    // Fall back to localStorage
    const saved = localStorage.getItem('help-section');
    if (saved && sectionIds.includes(saved as SectionId)) return saved as SectionId;
    return 'shortcuts';
  }

  let activeSection = $state<SectionId>(getInitialSection());
  $effect(() => { localStorage.setItem('help-section', activeSection); });

  // Listen for section changes when window is already open (dispatched from Rust eval)
  onMount(() => {
    function onSectionChange(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && sectionIds.includes(detail as SectionId)) {
        activeSection = detail as SectionId;
      }
    }
    window.addEventListener('help-section', onSectionChange);
    return () => window.removeEventListener('help-section', onSectionChange);
  });

  const sections = [
    { id: 'shortcuts' as const, label: 'Shortcuts' },
    { id: 'editor' as const, label: 'Editor' },
    { id: 'claude' as const, label: 'Claude Code' },
    { id: 'tips' as const, label: 'Tips' },
  ];

  // Accordion state — track which accordions are open per section
  let openAccordions = $state<Record<string, boolean>>({});

  function toggleAccordion(id: string) {
    openAccordions = { ...openAccordions, [id]: !openAccordions[id] };
  }

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function copyTipCommand() {
    navigator.clipboard.writeText('remember at user level: always use subagent haiku for MCP tool calls (aiterm tools like notes, tabs, workspaces, editor)');
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied = false; }, 2000);
  }
</script>

<div class="window">
  <div class="titlebar">
    <span class="title">Help</span>
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
      {#if activeSection === 'shortcuts'}
        <h3 class="section-heading">Tabs</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>T</kbd> <span>New tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> <span>Duplicate tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> <span>Reload tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>W</kbd> <span>Close tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>1-9</kbd> <span>Switch to tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>[</kbd> <span>Previous tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>]</kbd> <span>Next tab</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>R</kbd> <span>Toggle auto-resume</span></div>
        </div>

        <h3 class="section-heading">Panes</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>D</kbd> <span>Split right</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> <span>Split down</span></div>
        </div>

        <h3 class="section-heading">Windows</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>N</kbd> <span>New window</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> <span>Duplicate window</span></div>
        </div>

        <h3 class="section-heading">Workspaces</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>N</kbd> <span>New workspace</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> <span>Duplicate workspace</span></div>
        </div>

        <h3 class="section-heading">General</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>O</kbd> <span>Open file</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>E</kbd> <span>Toggle notes panel</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>B</kbd> <span>Toggle sidebar</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>F</kbd> <span>Find in terminal</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>K</kbd> <span>Clear terminal + scrollback</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>+</kbd> <span>Zoom in</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>-</kbd> <span>Zoom out</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>0</kbd> <span>Reset zoom</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>,</kbd> <span>Preferences</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>/</kbd> <span>Show this help</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Q</kbd> <span>Quit</span></div>
        </div>

      {:else if activeSection === 'editor'}
        <p class="description">
          When an editor tab is active, these shortcuts override terminal shortcuts.
        </p>

        <h3 class="section-heading">Selection</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>D</kbd> <span>Select next occurrence</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> <span>Select all occurrences</span></div>
        </div>

        <h3 class="section-heading">Lines</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{altLabel}</kbd> + <kbd>&#x2191;</kbd> <span>Move line up</span></div>
          <div class="shortcut"><kbd>{altLabel}</kbd> + <kbd>&#x2193;</kbd> <span>Move line down</span></div>
          <div class="shortcut"><kbd>Shift</kbd> + <kbd>{altLabel}</kbd> + <kbd>&#x2191;</kbd> <span>Copy line up</span></div>
          <div class="shortcut"><kbd>Shift</kbd> + <kbd>{altLabel}</kbd> + <kbd>&#x2193;</kbd> <span>Copy line down</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>K</kbd> <span>Delete line</span></div>
        </div>

        <h3 class="section-heading">Multi-Cursor</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>&#x2191;</kbd> <span>Add cursor above</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>&#x2193;</kbd> <span>Add cursor below</span></div>
        </div>

        <h3 class="section-heading">Editing</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>/</kbd> <span>Toggle line comment</span></div>
          <div class="shortcut"><kbd>Tab</kbd> <span>Indent</span></div>
          <div class="shortcut"><kbd>Shift</kbd> + <kbd>Tab</kbd> <span>Outdent</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Z</kbd> <span>Undo</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> <span>Redo</span></div>
        </div>

        <h3 class="section-heading">Search</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>F</kbd> <span>Find / replace</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>G</kbd> <span>Find next</span></div>
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> <span>Find previous</span></div>
        </div>

        <h3 class="section-heading">File</h3>
        <div class="shortcut-group">
          <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>S</kbd> <span>Save</span></div>
        </div>

      {:else if activeSection === 'claude'}
        <button class="accordion" class:open={openAccordions['c-auto-resume']} onclick={() => toggleAccordion('c-auto-resume')}>
          <span class="chevron">&#x203A;</span> Auto-Resume
        </button>
        {#if openAccordions['c-auto-resume']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <p class="description">
              Auto-resume lets you reconnect to a Claude Code session after it exits, disconnects, or the tab is reloaded.
            </p>
            <h4>How it works</h4>
            <ol class="steps">
              <li>When Claude Code exits, it prints a <code>claude --resume &lt;id&gt;</code> command. A built-in trigger captures this automatically.</li>
              <li>Once captured, aiTerm configures auto-resume for that tab. If the tab is reloaded or the terminal restarts, it runs the resume command to reconnect.</li>
              <li>Toggle auto-resume on or off with <kbd>{modLabel}</kbd> + <kbd>R</kbd>. A <code>&#x25B6;</code> indicator appears on the tab when active.</li>
            </ol>
            <h4>Keeping it in sync</h4>
            <p class="description">
              Actions like <code>/rewind</code> or anything that forks the conversation create a new session ID. The old resume command will reconnect to the pre-fork session, not the current one. Run <code>/status</code> after forking to capture the new session ID — the "Claude Session ID" trigger picks it up and updates auto-resume automatically.
            </p>
            <p class="description">
              This is also useful if automatic capture didn't trigger (e.g. you cleared the terminal before Claude exited). You can also right-click a tab to inspect or set a custom resume command directly.
            </p>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['c-triggers']} onclick={() => toggleAccordion('c-triggers')}>
          <span class="chevron">&#x203A;</span> Triggers
        </button>
        {#if openAccordions['c-triggers']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <p class="description">
              Built-in triggers watch Claude Code's terminal output for key events. Triggers can be scoped to specific workspaces and/or tabs in <strong>Preferences &rsaquo; Triggers</strong>.
            </p>
            <div class="trigger-list">
              <div class="trigger-item">
                <strong>Claude Resume</strong>
                <span>&mdash; Captures the <code>claude --resume</code> command and session ID when Claude exits.</span>
              </div>
              <div class="trigger-item">
                <strong>Claude Session ID</strong>
                <span>&mdash; Captures the session UUID from <code>/status</code> output.</span>
              </div>
              <div class="trigger-item">
                <strong>Claude Asking Question</strong>
                <span>&mdash; Notifies when Claude needs confirmation. Sets the tab state to "question".</span>
              </div>
              <div class="trigger-item">
                <strong>Claude Plan Ready</strong>
                <span>&mdash; Alerts when Claude has a plan ready for review.</span>
              </div>
              <div class="trigger-item">
                <strong>Claude Compacting / Complete</strong>
                <span>&mdash; Notifies during and after conversation compaction.</span>
              </div>
              <div class="trigger-item">
                <strong>Claude Auto-Resume</strong>
                <span>&mdash; Automatically enables auto-resume when a session ID or resume command is captured.</span>
              </div>
            </div>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['c-ide']} onclick={() => toggleAccordion('c-ide')}>
          <span class="chevron">&#x203A;</span> IDE Integration
        </button>
        {#if openAccordions['c-ide']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <p class="description">
              aiTerm runs a built-in MCP server that Claude Code discovers automatically. This gives Claude IDE-like tools for working with your editor tabs and files. Enable or disable in <strong>Preferences &rsaquo; Claude Code</strong>.
            </p>
            <div class="tool-list">
              <div class="tool"><code>openFile</code> <span>Open files in editor tabs with optional line selection</span></div>
              <div class="tool"><code>openDiff</code> <span>Show side-by-side diffs for you to accept or reject</span></div>
              <div class="tool"><code>saveDocument</code> <span>Save open editor tabs to disk</span></div>
              <div class="tool"><code>getOpenEditors</code> <span>List open tabs, their languages, and unsaved status</span></div>
              <div class="tool"><code>getCurrentSelection</code> <span>Read your current text selection and cursor position</span></div>
              <div class="tool"><code>getDiagnostics</code> <span>Get editor warnings and errors for a file</span></div>
            </div>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['c-notes']} onclick={() => toggleAccordion('c-notes')}>
          <span class="chevron">&#x203A;</span> Notes & Tabs
        </button>
        {#if openAccordions['c-notes']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <p class="description">
              Claude Code can manage your notes and navigate between workspaces and tabs directly. Just ask in natural language &mdash; Claude uses the MCP tools automatically.
            </p>
            <div class="tip-box">
              <strong>Tip:</strong> These tools are simple operations that don't need a large model. Paste this into Claude Code once to permanently use the faster, cheaper Haiku model for all MCP tool calls:
              <div class="tip-command-wrap">
                <code class="tip-command">remember at user level: always use subagent haiku for MCP tool calls (aiterm tools like notes, tabs, workspaces, editor)</code>
                <button class="copy-btn" onclick={copyTipCommand} title="Copy to clipboard">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <h4>Things you can say</h4>
            <ul class="example-list">
              <li><em>"Create a tab note with our next steps"</em></li>
              <li><em>"Save this plan as a workspace note"</em></li>
              <li><em>"Move my tab notes to a workspace note"</em></li>
              <li><em>"What notes do I have in this workspace?"</em></li>
              <li><em>"Switch to the tab where I was working on the auth refactor"</em></li>
              <li><em>"Switch to the tab called dev-server"</em></li>
              <li><em>"List all my workspaces and their tabs"</em></li>
              <li><em>"Open the notes panel and show workspace notes"</em></li>
            </ul>
            <h4>Available tools</h4>
            <div class="tool-list">
              <div class="tool"><code>listWorkspaces</code> <span>Browse all workspaces, panes, and tabs with IDs and names</span></div>
              <div class="tool"><code>switchTab</code> <span>Navigate to any tab by ID</span></div>
              <div class="tool"><code>getTabNotes</code> <span>Read notes from a tab</span></div>
              <div class="tool"><code>setTabNotes</code> <span>Write or clear tab notes</span></div>
              <div class="tool"><code>listWorkspaceNotes</code> <span>List workspace-level notes with previews</span></div>
              <div class="tool"><code>readWorkspaceNote</code> <span>Read full content of a workspace note</span></div>
              <div class="tool"><code>writeWorkspaceNote</code> <span>Create or update a workspace note</span></div>
              <div class="tool"><code>deleteWorkspaceNote</code> <span>Delete a workspace note</span></div>
              <div class="tool"><code>moveNote</code> <span>Move notes between tab and workspace levels</span></div>
              <div class="tool"><code>getTabContext</code> <span>Get recent terminal output to find tabs by what you were doing</span></div>
              <div class="tool"><code>openNotesPanel</code> <span>Open, close, or toggle the notes panel</span></div>
              <div class="tool"><code>setNotesScope</code> <span>Switch between tab and workspace note views</span></div>
            </div>
          </div>
        {/if}

      {:else if activeSection === 'tips'}
        <button class="accordion" class:open={openAccordions['t-tabs']} onclick={() => toggleAccordion('t-tabs')}>
          <span class="chevron">&#x203A;</span> Tabs
        </button>
        {#if openAccordions['t-tabs']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <ul class="tips">
              <li>Double-click a tab to rename. Use <code>%title</code> or <code>%dir</code> for dynamic names, e.g. <code>Dev %dir</code>. Clear to revert to auto-title.</li>
              <li>The duplicate button does a full copy (scrollback, notes, auto-resume). <kbd>{altLabel}</kbd>+click a tab for a shallow duplicate (name, cwd, history, variables only).</li>
            </ul>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['t-org']} onclick={() => toggleAccordion('t-org')}>
          <span class="chevron">&#x203A;</span> Organization
        </button>
        {#if openAccordions['t-org']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <ul class="tips">
              <li>Double-click workspace or pane names to rename them.</li>
              <li>Drag workspaces or tabs to reorder. Hold <kbd>{altLabel}</kbd> while dragging to duplicate.</li>
            </ul>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['t-shell']} onclick={() => toggleAccordion('t-shell')}>
          <span class="chevron">&#x203A;</span> Shell
        </button>
        {#if openAccordions['t-shell']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <ul class="tips">
              <li>Right-click a terminal for "Setup Shell Integration" (session) or "Install Shell Integration" (permanent).</li>
              <li>Type <code>l</code> instead of <code>ls</code> to list files as clickable links that open in an editor tab.</li>
              <li>Use "Install Shell Integration" on remote SSH shells to get the <code>l</code> command and tab activity indicators there too.</li>
            </ul>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['t-editor']} onclick={() => toggleAccordion('t-editor')}>
          <span class="chevron">&#x203A;</span> Editor
        </button>
        {#if openAccordions['t-editor']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <ul class="tips">
              <li><kbd>{modLabel}</kbd>+click a file path in the terminal to open it in an editor tab.</li>
              <li>Use <kbd>{modLabel}</kbd> + <kbd>O</kbd> to open any file from disk, defaulting to the terminal's working directory.</li>
            </ul>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['t-splits']} onclick={() => toggleAccordion('t-splits')}>
          <span class="chevron">&#x203A;</span> Splits
        </button>
        {#if openAccordions['t-splits']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <ul class="tips">
              <li>Splitting a pane clones the current tab's context: scrollback, working directory, SSH session, and shell history.</li>
              <li>Drag the divider between panes to resize. The ratio is preserved per-workspace.</li>
            </ul>
          </div>
        {/if}

        <button class="accordion" class:open={openAccordions['t-backup']} onclick={() => toggleAccordion('t-backup')}>
          <span class="chevron">&#x203A;</span> Backup & Import
        </button>
        {#if openAccordions['t-backup']}
          <div class="accordion-body" transition:slide={{ duration: 150 }}>
            <p class="description">
              Export your entire state (workspaces, tabs, notes, preferences) as a backup file via <strong>File &rsaquo; Export State</strong>. Import from <strong>File &rsaquo; Import State</strong> or <strong>Preferences &rsaquo; Backup</strong>.
            </p>
            <h4>Import modes</h4>
            <p class="description">
              When importing, you get a preview of the backup contents and can select which workspaces to import.
            </p>
            <div class="trigger-list">
              <div class="trigger-item">
                <strong>Overwrite</strong>
                <span>&mdash; Replaces matching workspaces with the backup versions. Workspaces you deselect (or that aren't in the backup) are left untouched.</span>
              </div>
              <div class="trigger-item">
                <strong>Merge</strong>
                <span>&mdash; Deep-merges into existing workspaces. Missing tabs are added, tab notes are restored only if currently empty, and missing workspace notes are added. Workspaces that don't exist locally are added as new.</span>
              </div>
            </div>
            <h4>Tips</h4>
            <ul class="tips">
              <li>Use <strong>Merge</strong> to recover lost notes or tabs from a backup without overwriting your current work.</li>
              <li>Use <strong>Overwrite</strong> to restore a workspace to its exact backup state.</li>
              <li>Deselect workspaces you don't want to touch &mdash; they won't be modified in either mode.</li>
              <li>Automatic backups can be configured in <strong>Preferences &rsaquo; Backup</strong> with a custom schedule and directory.</li>
            </ul>
          </div>
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
    padding-left: 78px;
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
    -webkit-user-select: text;
    user-select: text;
  }

  /* Accordion */

  .accordion {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 10px 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
    border-bottom: 1px solid var(--bg-light);
    border-radius: 0;
    transition: background 0.1s;
  }

  .accordion:hover {
    background: color-mix(in srgb, var(--bg-light) 40%, transparent);
  }

  .chevron {
    display: inline-block;
    font-size: 14px;
    color: var(--fg-dim);
    transition: transform 0.15s;
  }

  .accordion.open .chevron {
    transform: rotate(90deg);
  }

  .accordion-body {
    padding: 12px 8px 16px 22px;
  }

  /* Section headings (flat, no accordion) */

  .section-heading {
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
    padding: 10px 8px 6px;
    border-bottom: 1px solid var(--bg-light);
  }

  .section-heading:first-child {
    padding-top: 0;
  }

  .shortcut-group {
    padding: 8px 8px 12px 22px;
  }

  /* Shortcuts */

  .shortcut {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 13px;
  }

  .shortcut:last-child {
    margin-bottom: 0;
  }

  .shortcut span {
    color: var(--fg-dim);
    white-space: nowrap;
    order: 2;
  }

  .shortcut::after {
    content: '';
    flex: 1;
    order: 1;
    border-bottom: 1px dotted var(--bg-light);
    margin: 0 6px;
  }

  kbd {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    font-size: 12px;
    color: var(--fg);
  }

  /* Claude Code */

  .description {
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.6;
    margin: 0 0 12px 0;
  }

  .description:last-child {
    margin-bottom: 0;
  }

  .description strong {
    color: var(--fg);
    font-weight: 500;
  }

  h4 {
    margin: 16px 0 8px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .steps {
    margin: 0 0 12px 0;
    padding-left: 20px;
    list-style: decimal;
  }

  .steps li {
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.6;
    margin-bottom: 6px;
  }

  .steps li:last-child {
    margin-bottom: 0;
  }

  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-size: 13px;
  }

  .tool code {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 12px;
    color: var(--accent);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tool span {
    color: var(--fg-dim);
  }

  .tip-box {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.6;
    margin-bottom: 16px;
  }

  .tip-box strong {
    color: var(--accent);
    font-weight: 600;
  }

  .tip-command-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    overflow: hidden;
  }

  .tip-command {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--fg);
    background: none;
    border: none;
    user-select: all;
  }

  .copy-btn {
    padding: 4px 10px;
    margin-right: 4px;
    font-size: 11px;
    color: var(--accent);
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .copy-btn:hover {
    background: var(--bg-light);
  }

  .example-list {
    margin: 0 0 12px 0;
    padding-left: 18px;
    list-style: none;
  }

  .example-list li {
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.8;
  }

  .example-list li::before {
    content: '\203A';
    color: var(--accent);
    margin-right: 8px;
  }

  .example-list em {
    color: var(--fg);
    font-style: normal;
  }

  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .trigger-item {
    font-size: 13px;
    line-height: 1.5;
  }

  .trigger-item strong {
    color: var(--fg);
    font-weight: 500;
  }

  .trigger-item span {
    color: var(--fg-dim);
  }

  /* Tips */

  .tips {
    margin: 0;
    padding-left: 18px;
    list-style: disc;
  }

  .tips li {
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.6;
    margin-bottom: 8px;
  }

  .tips li:last-child {
    margin-bottom: 0;
  }

  code {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 12px;
    color: var(--fg);
  }
</style>
