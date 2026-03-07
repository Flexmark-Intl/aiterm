<script lang="ts">
  import type { ImportPreview, ImportConfig } from '$lib/tauri/commands';
  import { importStateSelective } from '$lib/tauri/commands';
  import { dispatch } from '$lib/stores/notificationDispatch';
  import { error as logError } from '@tauri-apps/plugin-log';
  import Button from '$lib/components/ui/Button.svelte';
  import IconButton from '$lib/components/ui/IconButton.svelte';

  interface Props {
    open: boolean;
    preview: ImportPreview | null;
    filePath: string;
    onclose: () => void;
    onimported: () => void;
  }

  let { open, preview, filePath, onclose, onimported }: Props = $props();

  let mode = $state<'overwrite' | 'merge'>('overwrite');
  let importPreferences = $state(true);
  let selectedWorkspaces = $state(new Set<string>());
  let importing = $state(false);
  let expandedWorkspaces = $state(new Set<string>());

  // Initialize selections when preview changes
  $effect(() => {
    if (preview) {
      const allIds = new Set<string>();
      for (const win of preview.windows) {
        for (const ws of win.workspaces) {
          allIds.add(ws.id);
        }
      }
      selectedWorkspaces = allIds;
      expandedWorkspaces = new Set<string>();
      mode = 'overwrite';
      importPreferences = true;
      importing = false;
    }
  });

  const allWorkspaces = $derived.by(() => {
    if (!preview) return [];
    return preview.windows.flatMap(w => w.workspaces);
  });

  const selectedCount = $derived(selectedWorkspaces.size);
  const totalCount = $derived(allWorkspaces.length);

  function toggleWorkspace(id: string) {
    const updated = new Set(selectedWorkspaces);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    selectedWorkspaces = updated;
  }

  function toggleAll() {
    if (selectedCount === totalCount) {
      selectedWorkspaces = new Set();
    } else {
      selectedWorkspaces = new Set(allWorkspaces.map(ws => ws.id));
    }
  }

  function toggleExpand(id: string) {
    const updated = new Set(expandedWorkspaces);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    expandedWorkspaces = updated;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function tabTypeIcon(type: string): string {
    switch (type) {
      case 'terminal': return '>';
      case 'editor': return '#';
      default: return '?';
    }
  }

  async function handleImport() {
    if (selectedCount === 0) return;
    importing = true;
    try {
      const config: ImportConfig = {
        mode,
        selected_workspace_ids: [...selectedWorkspaces],
        import_preferences: importPreferences,
      };
      await importStateSelective(filePath, config);
      dispatch('Import complete', `${selectedCount} workspace${selectedCount === 1 ? '' : 's'} imported (${mode})`, 'info');
      onimported();
    } catch (e) {
      logError(`Import failed: ${e}`);
      dispatch('Import failed', String(e), 'error');
      importing = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

{#if open && preview}
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
        <h2>Import Backup</h2>
        <IconButton tooltip="Close" style="font-size:20px;padding:4px 8px;width:auto;height:auto" onclick={onclose}>&times;</IconButton>
      </div>

      <div class="content">
        <div class="file-info">
          <span class="file-name">{filePath.split('/').pop()}</span>
          <span class="file-size">{formatSize(preview.file_size)}</span>
        </div>

        <div class="options-row">
          <div class="mode-select">
            <label class="mode-label">Mode</label>
            <select bind:value={mode}>
              <option value="overwrite">Overwrite</option>
              <option value="merge">Merge</option>
            </select>
          </div>

          <label class="checkbox-option">
            <input type="checkbox" bind:checked={importPreferences} />
            Import preferences
          </label>
        </div>

        <p class="mode-hint">
          {#if mode === 'overwrite'}
            Replaces all current workspaces with the selected ones from the backup.
          {:else}
            Adds the selected workspaces alongside your existing ones.
          {/if}
        </p>

        <div class="workspace-header">
          <label class="checkbox-option select-all">
            <input
              type="checkbox"
              checked={selectedCount === totalCount}
              indeterminate={selectedCount > 0 && selectedCount < totalCount}
              onchange={toggleAll}
            />
            Workspaces ({selectedCount}/{totalCount})
          </label>
        </div>

        <div class="workspace-list">
          {#each allWorkspaces as ws (ws.id)}
            <div class="workspace-item" class:deselected={!selectedWorkspaces.has(ws.id)}>
              <div class="workspace-row">
                <input
                  type="checkbox"
                  checked={selectedWorkspaces.has(ws.id)}
                  onchange={() => toggleWorkspace(ws.id)}
                />
                <button class="expand-btn" onclick={() => toggleExpand(ws.id)} class:expanded={expandedWorkspaces.has(ws.id)}>
                  {expandedWorkspaces.has(ws.id) ? '\u25BE' : '\u25B8'}
                </button>
                <span class="ws-name">{ws.name}</span>
                <span class="ws-meta">
                  {ws.tab_count} tab{ws.tab_count === 1 ? '' : 's'}
                  {#if ws.note_count > 0}, {ws.note_count} note{ws.note_count === 1 ? '' : 's'}{/if}
                  {#if ws.archived_count > 0}, {ws.archived_count} archived{/if}
                </span>
              </div>
              {#if expandedWorkspaces.has(ws.id)}
                <div class="tab-list">
                  {#each ws.tabs as tab (tab.id)}
                    <div class="tab-item">
                      <span class="tab-type">{tabTypeIcon(tab.tab_type)}</span>
                      <span class="tab-name">{tab.name}</span>
                      {#if tab.editor_file_path}
                        <span class="tab-detail">{tab.editor_file_path}</span>
                      {/if}
                      <span class="tab-badges">
                        {#if tab.has_auto_resume}<span class="badge">resume</span>{/if}
                        {#if tab.has_notes}<span class="badge">notes</span>{/if}
                      </span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <div class="footer">
        <Button variant="secondary" onclick={onclose} disabled={importing}>Cancel</Button>
        <Button onclick={handleImport} disabled={importing || selectedCount === 0}>
          {#if importing}
            Importing...
          {:else}
            Import {selectedCount} workspace{selectedCount === 1 ? '' : 's'}
          {/if}
        </Button>
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
    border-radius: 10px;
    width: 520px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--bg-light);
  }

  .header h2 {
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    margin: 0;
  }

  .content {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 14px;
    padding: 8px 10px;
    background: var(--bg-dark);
    border-radius: 6px;
  }

  .file-name {
    font-size: 12px;
    color: var(--fg);
    font-family: monospace;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    font-size: 11px;
    color: var(--fg-dim);
    white-space: nowrap;
  }

  .options-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 8px;
  }

  .mode-select {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mode-label {
    font-size: 12px;
    color: var(--fg-dim);
  }

  .mode-select select {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--bg-light);
    background: var(--bg-dark);
    color: var(--fg);
  }

  .checkbox-option {
    font-size: 12px;
    color: var(--fg);
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .checkbox-option input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .mode-hint {
    font-size: 11px;
    color: var(--fg-dim);
    margin: 0 0 14px;
  }

  .workspace-header {
    margin-bottom: 6px;
  }

  .select-all {
    font-weight: 600;
    font-size: 12px;
  }

  .workspace-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 300px;
    overflow-y: auto;
  }

  .workspace-item {
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
  }

  .workspace-item.deselected {
    opacity: 0.5;
  }

  .workspace-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
  }

  .workspace-row input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .expand-btn {
    background: none;
    border: none;
    color: var(--fg-dim);
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    line-height: 1;
  }

  .ws-name {
    font-size: 12px;
    color: var(--fg);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ws-meta {
    font-size: 11px;
    color: var(--fg-dim);
    white-space: nowrap;
  }

  .tab-list {
    padding: 0 8px 6px 32px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    font-size: 11px;
  }

  .tab-type {
    color: var(--fg-dim);
    font-family: monospace;
    width: 10px;
    text-align: center;
  }

  .tab-name {
    color: var(--fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-detail {
    color: var(--fg-dim);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .tab-badges {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-light);
    color: var(--fg-dim);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--bg-light);
  }
</style>
