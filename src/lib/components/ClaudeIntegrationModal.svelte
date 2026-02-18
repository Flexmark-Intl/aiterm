<script lang="ts">
  interface Props {
    open: boolean;
    onclose: () => void;
    onenable: () => void;
    onlater: () => void;
  }

  let { open, onclose, onenable, onlater }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onlater();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onlater();
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
        <h2>Enable Claude Code Integrations?</h2>
        <button class="close-btn" onclick={onclose}>&times;</button>
      </div>

      <div class="content">
        <p>aiTerm includes built-in triggers that enhance the experience when using Claude Code. These watch terminal output and react automatically:</p>

        <ul>
          <li><strong>Asking Question</strong> &mdash; notifies you and marks the tab when Claude stops to ask for confirmation</li>
          <li><strong>Plan Ready</strong> &mdash; alerts the tab and notifies you when Claude has a plan ready for review</li>
          <li><strong>Compacting</strong> &mdash; notifies you when Claude is compacting the conversation</li>
          <li><strong>Compaction Complete</strong> &mdash; alerts the tab when compaction finishes</li>
          <li><strong>Resume &amp; Session ID</strong> &mdash; captures session info for auto-resume</li>
          <li><strong>Auto-Resume</strong> &mdash; automatically enables auto-resume on a tab when a Claude session ID or resume command is captured</li>
        </ul>

        <p class="hint">You can customize or disable individual triggers anytime in Preferences &gt; Triggers.</p>
      </div>

      <div class="actions">
        <button class="btn-secondary" onclick={onclose}>No thanks</button>
        <button class="btn-later" onclick={onlater}>Ask me later</button>
        <button class="btn-primary" onclick={onenable}>Enable</button>
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
    width: 480px;
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
    font-size: 15px;
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

  p {
    margin: 0 0 12px 0;
    font-size: 13px;
    color: var(--fg);
    line-height: 1.5;
  }

  ul {
    margin: 0 0 12px 0;
    padding-left: 20px;
    list-style: disc;
  }

  li {
    font-size: 13px;
    color: var(--fg-dim);
    line-height: 1.6;
    margin-bottom: 4px;
  }

  li strong {
    color: var(--fg);
  }

  .hint {
    font-size: 12px;
    color: var(--fg-dim);
    margin-bottom: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--bg-light);
  }

  .btn-later {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--fg-dim);
    background: transparent;
    border: none;
  }

  .btn-later:hover {
    color: var(--fg);
  }

  .btn-secondary {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--fg-dim);
    background: transparent;
    border: 1px solid var(--bg-light);
  }

  .btn-secondary:hover {
    background: var(--bg-light);
    color: var(--fg);
  }

  .btn-primary {
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--bg-dark);
    background: var(--accent);
    border: none;
    font-weight: 600;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }
</style>
