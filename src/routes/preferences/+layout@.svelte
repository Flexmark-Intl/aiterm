<script lang="ts">
  import '../../app.css';
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { getTheme, applyUiTheme } from '$lib/themes';
  import { error as logError } from '@tauri-apps/plugin-log';
  import { attachConsole } from '@tauri-apps/plugin-log';
  import type { Preferences } from '$lib/tauri/types';

  interface Props {
    children: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  // Apply UI theme reactively
  $effect(() => {
    const t = getTheme(preferencesStore.theme, preferencesStore.customThemes);
    applyUiTheme(t.ui);
  });

  onMount(() => {
    let detachConsole: (() => void) | undefined;
    attachConsole().then(detach => { detachConsole = detach; });

    preferencesStore.load().catch((e: unknown) => logError(`Failed to load preferences: ${e}`));

    let unlistenPrefs: (() => void) | undefined;
    listen<Preferences>('preferences-changed', (event) => {
      preferencesStore.applyFromBackend(event.payload);
    }).then(unlisten => { unlistenPrefs = unlisten; });

    return () => {
      unlistenPrefs?.();
      detachConsole?.();
    };
  });
</script>

{@render children()}
