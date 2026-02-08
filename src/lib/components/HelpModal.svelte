<script lang="ts">
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
        <section>
          <h3>Tabs</h3>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>T</kbd> <span>New tab</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>W</kbd> <span>Close tab</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>1-9</kbd> <span>Switch to tab</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>[</kbd> <span>Previous tab</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>]</kbd> <span>Next tab</span></div>
        </section>

        <section>
          <h3>Panes</h3>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>D</kbd> <span>Split right</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> <span>Split down</span></div>
        </section>

        <section>
          <h3>Workspaces</h3>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>N</kbd> <span>New workspace</span></div>
        </section>

        <section>
          <h3>General</h3>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>F</kbd> <span>Find in terminal</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>K</kbd> <span>Clear terminal + scrollback</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>+</kbd> <span>Zoom in</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>-</kbd> <span>Zoom out</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>0</kbd> <span>Reset zoom</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>,</kbd> <span>Preferences</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>/</kbd> <span>Show this help</span></div>
          <div class="shortcut"><kbd>Cmd</kbd> + <kbd>Q</kbd> <span>Quit</span></div>
        </section>

        <section>
          <h3>Tips</h3>
          <p>Double-click on workspace, pane, or tab names to rename them.</p>
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
    margin-left: auto;
    color: var(--fg-dim);
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

  p {
    margin: 0;
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.5;
  }
</style>
