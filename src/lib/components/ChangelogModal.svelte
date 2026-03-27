<script lang="ts">
  import changelogRaw from '../../../CHANGELOG.md?raw';
  import IconButton from '$lib/components/ui/IconButton.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    version: string;
    /** If provided, renders these entries instead of the bundled CHANGELOG.md */
    entries?: ChangelogEntry[];
    /** Custom modal title */
    title?: string;
    /** When provided, shows an "Install & Restart" button */
    oninstall?: () => void;
    /** Label for the install button (e.g. "Downloading…") */
    installLabel?: string;
    /** Disable the install button (e.g. while downloading) */
    installDisabled?: boolean;
  }

  let { open, onclose, version, entries, title, oninstall, installLabel, installDisabled }: Props = $props();

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

  export interface ChangelogEntry {
    version: string;
    items: string[];
  }

  function parseChangelog(raw: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    let current: ChangelogEntry | null = null;
    for (const line of raw.split('\n')) {
      const versionMatch = line.match(/^## v(.+)/);
      if (versionMatch) {
        current = { version: versionMatch[1], items: [] };
        entries.push(current);
        continue;
      }
      const itemMatch = line.match(/^- (.+)/);
      if (itemMatch && current) {
        // Strip markdown backticks for display
        current.items.push(itemMatch[1].replace(/`([^`]+)`/g, '$1'));
      }
    }
    return entries;
  }

  const changelog = $derived(entries ?? parseChangelog(changelogRaw));
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
        <h2>{title ?? 'Changelog'}</h2>
        <IconButton tooltip="Close" style="font-size: 1.538rem;padding:4px 8px;width:auto;height:auto" onclick={onclose}>&times;</IconButton>
      </div>

      <div class="content">
        {#each changelog as entry}
          <section>
            <h3 class:current={entry.version === version}>v{entry.version}{entry.version === version ? ' (current)' : ''}</h3>
            <ul>
              {#each entry.items as item}
                <li>{item}</li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>

      {#if oninstall}
        <div class="footer">
          <button class="install-btn" onclick={oninstall} disabled={installDisabled}>
            {installLabel ?? 'Install & Restart'}
          </button>
          <span class="install-hint">The app will restart to apply the update</span>
        </div>
      {/if}
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
    width: 420px;
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
    font-size: 1.231rem;
    font-weight: 600;
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
    margin: 0 0 8px 0;
    font-size: 0.923rem;
    font-weight: 600;
    color: var(--fg-dim);
    letter-spacing: 0.5px;
  }

  h3.current {
    color: var(--accent);
  }

  ul {
    margin: 0;
    padding-left: 18px;
    list-style: disc;
  }

  li {
    font-size: 1rem;
    color: var(--fg-dim);
    line-height: 1.5;
    margin-bottom: 4px;
  }

  li:last-child {
    margin-bottom: 0;
  }

  .footer {
    padding: 12px 20px;
    border-top: 1px solid var(--bg-light);
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .install-btn {
    font-size: 0.923rem;
    font-weight: 600;
    padding: 6px 16px;
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: var(--bg-dark);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .install-btn:hover:not(:disabled) {
    filter: brightness(1.15);
  }

  .install-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .install-hint {
    font-size: 0.769rem;
    color: var(--fg-dim);
  }
</style>
