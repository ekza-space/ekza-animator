// Toasts (research 09 §6.5): bottom-right above the timeline, at most three, with an optional action (Undo).
import { Toast, ToastAction, ToastClose, ToastTitle, ToastViewport } from '@ekza-animator/ui';
import type { JSX } from 'react';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { ToastItem, ToastNotifier } from '../services/notify';
import { useShell } from './context';

const selectToasts = (state: { readonly toasts: readonly ToastItem[] }): readonly ToastItem[] => state.toasts;

export function Toaster(props: { readonly notifier: ToastNotifier }): JSX.Element {
  const shell = useShell();
  const toasts = useStoreSelector(props.notifier.store, selectToasts);
  return (
    <>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          kind={toast.kind}
          duration={shell.params.e2e ? Math.max(toast.duration, 15_000) : toast.duration}
          onOpenChange={(open) => {
            if (!open) props.notifier.dismiss(toast.id);
          }}
          data-testid="toast"
          data-kind={toast.kind}
        >
          <ToastTitle>{toast.text}</ToastTitle>
          {toast.action === null ? null : (
            <ToastAction
              altText={toast.action.label}
              data-testid="toast-action"
              onClick={() => {
                const action = toast.action;
                if (action !== null) void shell.runFromUi(action.op, action.args);
              }}
            >
              {toast.action.label}
            </ToastAction>
          )}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport data-testid="toasts" />
    </>
  );
}
