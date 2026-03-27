import { SvelteSet } from 'svelte/reactivity';

/**
 * Tracks panes awaiting explicit user resume.
 * Set by +page.svelte when switching to a workspace where the active tab is suspended.
 * Read by SplitPane to show a resume overlay instead of an empty terminal slot.
 */
export const pendingResumePanes = new SvelteSet<string>();

export function resumePane(paneId: string) {
  pendingResumePanes.delete(paneId);
}
