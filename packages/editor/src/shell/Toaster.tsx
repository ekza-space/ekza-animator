// Toasts (research 09 §6.5): bottom-right above the timeline, at most three, with an optional action (Undo).
import { Toast, ToastAction, ToastClose, ToastTitle, ToastViewport } from '@ekza-studio/ui';
import type { JSX } from 'react';
import { useStoreSelector } from '../hooks/useStoreSelector';
import type { ToastItem, ToastNotifier } from '../services/notify';
import { useHost } from '../host/context';

const selectToasts = (state: { readonly toasts: readonly ToastItem[] }): readonly ToastItem[] => state.toasts;

/**
 * A toast closed with its × (or swiped away) leaves the focus in the toast viewport, where Radix puts it, and the
 * next key then showed the viewport's focus ring as a box over the Dope Sheet (M2a fix round 1). Once the closing
 * toast has unmounted, focus inside an empty viewport goes back to the page, where the shell's keymap works anyway.
 */
function releaseToastFocus(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const viewport = active.closest('[data-ekza-toast-viewport]');
    if (viewport !== null && viewport.querySelector('li') === null) active.blur();
  });
}

export function Toaster(props: { readonly notifier: ToastNotifier }): JSX.Element {
  const shell = useHost();
  const toasts = useStoreSelector(props.notifier.store, selectToasts);
  return (
    <>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          kind={toast.kind}
          duration={shell.params.e2e ? Math.max(toast.duration, 15_000) : toast.duration}
          onOpenChange={(open) => {
            if (open) return;
            props.notifier.dismiss(toast.id);
            releaseToastFocus();
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
