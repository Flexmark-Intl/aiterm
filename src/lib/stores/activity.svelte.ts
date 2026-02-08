function createActivityStore() {
  let active = $state<Set<string>>(new Set());

  return {
    hasActivity(tabId: string): boolean {
      return active.has(tabId);
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
