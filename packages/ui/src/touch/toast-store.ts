// The toast queue (STUDIO-TOUCH-SPEC §3 P5, §5.3 C9): short messages above the tray, each optionally with one
// action ("Undid: select 2 faces · Redo"). At most three show; a newer one with the same `key` replaces the older
// one in place (repeated undos update one toast). The store has no DOM; `useSyncExternalStore` reads it.
import { TOUCH } from './constants';

export interface ToastInput {
  readonly text: string;
  /** One action button (Redo, Keep, Show me). */
  readonly action?: { readonly label: string; readonly run: () => void };
  /** A toast with the same key replaces the previous one. */
  readonly key?: string;
  /** Time on screen (ms); `Infinity` keeps it until dismissed. Default 4000. */
  readonly durationMs?: number;
  readonly tone?: 'neutral' | 'warning' | 'error';
}

export interface ToastItem extends ToastInput {
  readonly id: number;
}

export interface ToastTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ToastStore {
  push(toast: ToastInput): number;
  dismiss(id: number): void;
  clear(): void;
  /** Pause / resume the timers (a pointer resting on the region, a screen reader reading it). */
  hold(held: boolean): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ToastItem[];
}

const defaultTimers: ToastTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createToastStore(options: { readonly max?: number; readonly timers?: ToastTimers } = {}): ToastStore {
  const max = options.max ?? 3;
  const timers = options.timers ?? defaultTimers;
  let items: readonly ToastItem[] = [];
  let nextId = 1;
  let held = false;
  const handles = new Map<number, unknown>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const l of listeners) l();
  };
  const arm = (item: ToastItem): void => {
    const ms = item.durationMs ?? TOUCH.toastMs;
    if (held || !Number.isFinite(ms)) return;
    handles.set(
      item.id,
      timers.set(() => store.dismiss(item.id), ms),
    );
  };
  const disarm = (id: number): void => {
    const h = handles.get(id);
    if (h !== undefined) timers.clear(h);
    handles.delete(id);
  };

  const store: ToastStore = {
    push(toast) {
      const item: ToastItem = { ...toast, id: nextId++ };
      const same = toast.key === undefined ? -1 : items.findIndex((t) => t.key === toast.key);
      if (same >= 0) {
        const old = items[same];
        if (old !== undefined) disarm(old.id);
        items = items.map((t, i) => (i === same ? item : t));
      } else {
        items = [...items, item];
        while (items.length > max) {
          const first = items[0];
          if (first !== undefined) disarm(first.id);
          items = items.slice(1);
        }
      }
      arm(item);
      emit();
      return item.id;
    },
    dismiss(id) {
      if (!items.some((t) => t.id === id)) return;
      disarm(id);
      items = items.filter((t) => t.id !== id);
      emit();
    },
    clear() {
      for (const id of handles.keys()) disarm(id);
      items = [];
      emit();
    },
    hold(next) {
      if (held === next) return;
      held = next;
      if (held) for (const id of handles.keys()) disarm(id);
      else for (const item of items) arm(item);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return items;
    },
  };
  return store;
}
