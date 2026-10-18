import { Toast as ToastPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX } from 'react';
import { cn } from '../cn';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from '../icons/lucide';

export const ToastProvider: typeof ToastPrimitive.Provider = ToastPrimitive.Provider;

/** Bottom-right stack above the timeline (research 09 §6.5). */
export function ToastViewport({
  className,
  ...props
}: ComponentPropsWithRef<typeof ToastPrimitive.Viewport>): JSX.Element {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'fixed right-4 bottom-[calc(var(--size-helpline)+var(--size-timeline)+var(--size-rangebar)+12px)] z-(--z-toast)',
        'm-0 flex w-[min(380px,calc(100vw-32px))] list-none flex-col gap-2 p-0 outline-none',
        className,
      )}
      {...props}
    />
  );
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

const KIND_ICON = {
  info: <Info size={16} className="text-info" />,
  success: <CircleCheck size={16} className="text-ok" />,
  warning: <TriangleAlert size={16} className="text-warn" />,
  error: <CircleAlert size={16} className="text-danger" />,
} as const;

export interface ToastProps extends ComponentPropsWithRef<typeof ToastPrimitive.Root> {
  readonly kind?: ToastKind;
}

/**
 * A Radix toast is a dismissable layer that mounts above an open modal dialog, so Escape would close the toast and
 * leave the dialog open. Escape belongs to the dialog: the toast stays and the topmost open dialog closes through its
 * own close button (same path as the ×, so each dialog keeps its close semantics). Dialogs without one ignore it.
 */
function escapeToOpenDialog(event: KeyboardEvent): void {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]');
  const top = dialogs[dialogs.length - 1];
  if (top === undefined) return;
  event.preventDefault();
  top.querySelector<HTMLButtonElement>('[data-ekza-dialog-close]')?.click();
}

export function Toast({ kind = 'info', className, children, onEscapeKeyDown, ...props }: ToastProps): JSX.Element {
  return (
    <ToastPrimitive.Root
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event);
        if (!event.defaultPrevented) escapeToOpenDialog(event);
      }}
      className={cn(
        'flex items-start gap-2.5 rounded-popover border border-line-strong bg-popover px-3 py-2.5 text-ui text-fg',
        'shadow-popover data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)',
        kind === 'error' && 'border-danger/60',
        className,
      )}
      {...props}
    >
      <span className="mt-px shrink-0">{KIND_ICON[kind]}</span>
      {children}
    </ToastPrimitive.Root>
  );
}

export function ToastTitle({ className, ...props }: ComponentPropsWithRef<typeof ToastPrimitive.Title>): JSX.Element {
  return <ToastPrimitive.Title className={cn('min-w-0 flex-1 text-ui text-fg', className)} {...props} />;
}

export function ToastDescription({
  className,
  ...props
}: ComponentPropsWithRef<typeof ToastPrimitive.Description>): JSX.Element {
  return <ToastPrimitive.Description className={cn('text-ui text-fg-2', className)} {...props} />;
}

export function ToastAction({ className, ...props }: ComponentPropsWithRef<typeof ToastPrimitive.Action>): JSX.Element {
  return (
    <ToastPrimitive.Action
      className={cn(
        'shrink-0 rounded-button px-2 py-0.5 text-ui font-semibold text-accent-text hover:bg-hover',
        className,
      )}
      {...props}
    />
  );
}

export function ToastClose({ className, ...props }: ComponentPropsWithRef<typeof ToastPrimitive.Close>): JSX.Element {
  return (
    <ToastPrimitive.Close
      aria-label="Dismiss"
      className={cn('shrink-0 rounded-button p-0.5 text-fg-3 hover:bg-hover hover:text-fg', className)}
      {...props}
    >
      <X size={14} />
    </ToastPrimitive.Close>
  );
}
