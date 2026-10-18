import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react';
import { cn } from '../cn';
import { X } from '../icons/lucide';

export const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root;
export const DialogTrigger: typeof DialogPrimitive.Trigger = DialogPrimitive.Trigger;
export const DialogClose: typeof DialogPrimitive.Close = DialogPrimitive.Close;

export interface DialogContentProps extends Omit<ComponentPropsWithRef<typeof DialogPrimitive.Content>, 'title'> {
  readonly title: ReactNode;
  /** Rendered under the title and used as the accessible description. */
  readonly description?: ReactNode;
  /** Hides the × button (dialogs that must be answered, e.g. first run). */
  readonly hideClose?: boolean;
  readonly width?: 'sm' | 'md' | 'lg';
}

const WIDTH = {
  sm: 'w-[min(420px,calc(100vw-32px))]',
  md: 'w-[min(560px,calc(100vw-32px))]',
  lg: 'w-[min(760px,calc(100vw-32px))]',
};

/** Modal dialog: overlay, centred panel, title, optional description and close button (research 09 §8.5). */
export function DialogContent({
  title,
  description,
  hideClose = false,
  width = 'md',
  className,
  children,
  ...props
}: DialogContentProps): JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-(--z-dialog) bg-scrim" />
      <DialogPrimitive.Content
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        className={cn(
          'fixed top-1/2 left-1/2 z-(--z-dialog) flex max-h-[calc(100dvh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-dialog border border-line-strong bg-panel text-dialog text-fg shadow-popover outline-none',
          WIDTH[width],
          className,
        )}
        {...props}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 pt-3 pb-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <DialogPrimitive.Title className="text-dialog-title font-semibold">{title}</DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="text-ui text-fg-2">{description}</DialogPrimitive.Description>
            )}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close
              aria-label="Close"
              data-ekza-dialog-close=""
              className="inline-flex size-[var(--size-hit)] items-center justify-center rounded-button text-fg-2 hover:bg-hover hover:text-fg"
            >
              <X size={16} />
            </DialogPrimitive.Close>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Action row at the bottom of a dialog body (primary action last). */
export function DialogFooter({ className, ...props }: ComponentPropsWithRef<'div'>): JSX.Element {
  return (
    <div className={cn('-mx-4 mt-3 flex justify-end gap-2 border-t border-line px-4 pt-3', className)} {...props} />
  );
}
