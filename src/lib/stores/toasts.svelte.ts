export interface Toast {
  id: string;
  title: string;
  body: string;
  type: 'success' | 'error' | 'info';
  createdAt: number;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;

function createToastStore() {
  let toasts = $state<Toast[]>([]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function removeToast(id: string) {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    toasts = toasts.filter(t => t.id !== id);
  }

  function addToast(title: string, body: string, type: Toast['type'] = 'info') {
    const id = crypto.randomUUID();
    const toast: Toast = { id, title, body, type, createdAt: Date.now() };
    toasts = [...toasts, toast];

    // Auto-dismiss after timeout
    const timer = setTimeout(() => {
      timers.delete(id);
      removeToast(id);
    }, AUTO_DISMISS_MS);
    timers.set(id, timer);

    // Evict oldest if over max
    while (toasts.length > MAX_VISIBLE) {
      removeToast(toasts[0].id);
    }
  }

  return {
    get toasts() { return toasts; },
    addToast,
    removeToast,
  };
}

export const toastStore = createToastStore();
