<script lang="ts">
  import { modLabel, altLabel } from '$lib/utils/platform';

  interface Props {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: Props = $props();

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
        <h2>Keyboard Shortcuts</h2>
        <button class="close-btn" onclick={onclose}>&times;</button>
      </div>

      <div class="content">
        <div class="columns">
          <div class="col-shortcuts">
            <section>
              <h3>Tabs</h3>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>T</kbd> <span>New tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> <span>Duplicate tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> <span>Reload tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>W</kbd> <span>Close tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>1-9</kbd> <span>Switch to tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>[</kbd> <span>Previous tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>]</kbd> <span>Next tab</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>R</kbd> <span>Toggle auto-resume</span></div>
            </section>

            <section>
              <h3>Panes</h3>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>D</kbd> <span>Split right</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> <span>Split down</span></div>
            </section>

            <section>
              <h3>Windows</h3>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>N</kbd> <span>New window</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> <span>Duplicate window</span></div>
            </section>

            <section>
              <h3>Workspaces</h3>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>N</kbd> <span>New workspace</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>{altLabel}</kbd> + <kbd>Shift</kbd> + <kbd>N</kbd> <span>Duplicate workspace</span></div>
            </section>

            <section>
              <h3>General</h3>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>E</kbd> <span>Toggle notes panel</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>F</kbd> <span>Find in terminal</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>K</kbd> <span>Clear terminal + scrollback</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>+</kbd> <span>Zoom in</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>-</kbd> <span>Zoom out</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>0</kbd> <span>Reset zoom</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>,</kbd> <span>Preferences</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>/</kbd> <span>Show this help</span></div>
              <div class="shortcut"><kbd>{modLabel}</kbd> + <kbd>Q</kbd> <span>Quit</span></div>
            </section>
          </div>

          <div class="col-tips">
            <section>
              <h3>Tabs</h3>
              <ul class="tips">
                <li>Double-click a tab to rename. Use <code>%title</code> or <code>%dir</code> for dynamic names, e.g. <code>Dev %dir</code>. Clear to revert to auto-title.</li>
                <li>The duplicate button does a full copy (scrollback, notes, auto-resume). <kbd>{altLabel}</kbd>+click a tab for a shallow duplicate (name, cwd, history, variables only).</li>
              </ul>
            </section>

            <section>
              <h3>Organization</h3>
              <ul class="tips">
                <li>Double-click workspace or pane names to rename them.</li>
                <li>Drag workspaces or tabs to reorder. Hold <kbd>{altLabel}</kbd> while dragging to duplicate.</li>
              </ul>
            </section>

            <section>
              <h3>Shell</h3>
              <ul class="tips">
                <li>Right-click a terminal for "Setup Shell Integration" (session) or "Install Shell Integration" (permanent).</li>
              </ul>
            </section>
          </div>
        </div>
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
    width: 680px;
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

  .columns {
    display: flex;
    gap: 24px;
  }

  .col-shortcuts {
    flex: 1;
    min-width: 0;
  }

  .col-tips {
    flex: 0 0 220px;
  }

  section {
    margin-bottom: 20px;
  }

  section:last-child {
    margin-bottom: 0;
  }

  h3 {
    margin: 0 0 10px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 13px;
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

  .tips {
    margin: 0;
    padding-left: 18px;
    list-style: disc;
  }

  .tips li {
    font-size: 12px;
    color: var(--fg-dim);
    line-height: 1.5;
    margin-bottom: 8px;
  }

  .tips li:last-child {
    margin-bottom: 0;
  }

  .tips code {
    background: var(--bg-dark);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 11px;
    color: var(--fg);
  }
</style>
