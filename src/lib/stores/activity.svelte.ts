function createActivityStore() {
  let active = $state<Set<string>>(new Set());

  return {
    hasActivity(tabId: string): boolean {
      return active.has(tabId);
    },

    /** Check if any tab in the given list has activity. */
    hasAnyActivity(tabIds: string[]): boolean {
      for (const id of tabIds) {
        if (active.has(id)) return true;
      }
      return false;
    },

    markActive(tabId: string) {
      if (active.has(tabId)) return;
      active = new Set(active);
      active.add(tabId);
    },

    clearActive(tabId: string) {
      if (!active.has(tabId)) return;
      active = new Set(active);
      active.delete(tabId);
    },
  };
}

export const activityStore = createActivityStore();
