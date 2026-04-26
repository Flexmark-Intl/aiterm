import { listen as rawListen } from '@tauri-apps/api/event';
import type { EventCallback, Options, UnlistenFn } from '@tauri-apps/api/event';

/**
 * Counted wrapper around Tauri `listen()`. Tracks the number of currently
 * registered listeners per event name so we can surface a leak indicator in
 * `getDiagnostics`. A listener that's `await listen(...)`'d but whose
 * unlisten is never called accumulates here forever — exactly the failure
 * mode we're hunting in the long-uptime memory leak.
 */
const counts = new Map<string, number>();
let totalRegistered = 0;
let totalUnregistered = 0;

export async function countedListen<T>(
  event: string,
  handler: EventCallback<T>,
  options?: Options
): Promise<UnlistenFn> {
  const unlisten = await rawListen<T>(event, handler, options);
  counts.set(event, (counts.get(event) ?? 0) + 1);
  totalRegistered++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (counts.get(event) ?? 1) - 1;
    if (next <= 0) counts.delete(event);
    else counts.set(event, next);
    totalUnregistered++;
    return unlisten();
  };
}

export function getListenerStats() {
  // Top 10 events by active count
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([event, count]) => ({ event, count }));
  let activeTotal = 0;
  for (const c of counts.values()) activeTotal += c;
  return {
    active_total: activeTotal,
    distinct_events: counts.size,
    lifetime_registered: totalRegistered,
    lifetime_unregistered: totalUnregistered,
    top_events: top,
  };
}
