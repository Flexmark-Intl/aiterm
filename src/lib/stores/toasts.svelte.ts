import { preferencesStore } from './preferences.svelte';

export interface ToastSource {
  tabId: string;
}

export interface Toast {
  id: string;
  title: string;
  body: string;
  type: 'success' | 'error' | 'info';
  createdAt: number;
  duration: number;
  source?: ToastSource;
}

const MAX_VISIBLE = 3;

interface TimerState {
  timer: ReturnType<typeof setTimeout>;
  remaining: number;
  pausedAt: number | null;
}

function createToastStore() {
  let toasts = $state<Toast[]>([]);
  const timers = new Map<string, TimerState>();

  function startTimer(id: string, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(id);
      removeToast(id);
    }, ms);
    timers.set(id, { timer, remaining: ms, pausedAt: null });
  }

  function removeToast(id: string) {
    const ts = timers.get(id);
    if (ts) {
      clearTimeout(ts.timer);
      timers.delete(id);
    }
    toasts = toasts.filter(t => t.id !== id);
  }

  function pauseToast(id: string) {
    const ts = timers.get(id);
    if (!ts || ts.pausedAt !== null) return;
    clearTimeout(ts.timer);
    ts.pausedAt = Date.now();
  }

  function resumeToast(id: string) {
    const ts = timers.get(id);
    if (!ts || ts.pausedAt === null) return;
    const elapsed = Date.now() - ts.pausedAt;
    const remaining = Math.max(0, ts.remaining - elapsed);
    ts.pausedAt = null;
    ts.remaining = remaining;
    ts.timer = setTimeout(() => {
      timers.delete(id);
      removeToast(id);
    }, remaining);
  }

  function addToast(title: string, body: string, type: Toast['type'] = 'info', source?: ToastSource) {
    const id = crypto.randomUUID();
    const durationMs = preferencesStore.toastDuration * 1000;
    const toast: Toast = { id, title, body, type, createdAt: Date.now(), duration: durationMs, source };
    toasts = [...toasts, toast];

    startTimer(id, durationMs);

    // Evict oldest if over max
    while (toasts.length > MAX_VISIBLE) {
      removeToast(toasts[0].id);
    }
  }

  return {
    get toasts() { return toasts; },
    addToast,
    removeToast,
    pauseToast,
    resumeToast,
  };
}

export const toastStore = createToastStore();
