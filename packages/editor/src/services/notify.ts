// Toast queue behind the Notifier service (research 09 §6.5: bottom-right, 4 s, at most 3 visible, Undo action).
import type { Notifier, OperatorId } from '@ekza-animator/editor-core';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface ToastItem {
  readonly id: number;
  readonly kind: 'info' | 'success' | 'warning' | 'error';
  readonly text: string;
  readonly action: { readonly label: string; readonly op: OperatorId; readonly args?: unknown } | null;
  /** ms; errors stay longer. */
  readonly duration: number;
}

export interface ToastNotifier extends Notifier {
  readonly store: StoreApi<{ readonly toasts: readonly ToastItem[] }>;
  dismiss(id: number): void;
  /** Dismisses every toast `match` accepts (a state message that no longer holds, e.g. a restored context). */
  dismissWhere(match: (toast: ToastItem) => boolean): void;
  clear(): void;
}

export const MAX_TOASTS = 3;

export function createToastNotifier(): ToastNotifier {
  const store = createStore<{ readonly toasts: readonly ToastItem[] }>()(() => ({ toasts: [] }));
  let nextId = 1;
  return {
    store,
    toast(t): void {
      const item: ToastItem = {
        id: nextId++,
        kind: t.kind,
        text: t.text,
        action: t.action === undefined ? null : t.action,
        duration: t.kind === 'error' ? 8000 : t.action === undefined ? 4000 : 6000,
      };
      const toasts = [...store.getState().toasts, item];
      store.setState({ toasts: toasts.slice(Math.max(0, toasts.length - MAX_TOASTS)) });
    },
    dismiss(id: number): void {
      const toasts = store.getState().toasts;
      if (toasts.some((toast) => toast.id === id))
        store.setState({ toasts: toasts.filter((toast) => toast.id !== id) });
    },
    dismissWhere(match: (toast: ToastItem) => boolean): void {
      const toasts = store.getState().toasts;
      if (toasts.some(match)) store.setState({ toasts: toasts.filter((toast) => !match(toast)) });
    },
    clear(): void {
      store.setState({ toasts: [] });
    },
  };
}
