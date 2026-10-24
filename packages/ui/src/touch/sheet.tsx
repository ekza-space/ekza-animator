// Sheets and drawers (STUDIO-TOUCH-SPEC §4.1, §4.3, §18): docked to the right edge on wide containers (360 px) or
// rising from the bottom (portrait, phones) with peek / half / full heights set by the grab bar (tap it to step,
// drag it to size; a flick goes one detent). A `dialog` with an accessible name; a modal sheet traps focus behind a
// scrim, a docked one (`modal={false}`) leaves the canvas live and does not close on outside taps. Its body scrolls
// with `touch-action: pan-y` and `overscroll-behavior: contain` inside the shell's no-pan policy. Rendered in place
// (no portal) by default so it docks inside the shell frame and keeps the touch scope.
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type JSX, type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from 'react';
import { cn } from '../cn';
import { Glyph } from './glyphs';
import { type Detent, nextDetent, snapDetent } from './layout';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  /** A line under the title, also the accessible description. */
  readonly description?: ReactNode;
  /** `right` (wide containers) or `bottom` (portrait, phones). */
  readonly side?: 'right' | 'bottom';
  /** Bottom sheets: the current height. Uncontrolled when omitted (starts at `defaultDetent`). */
  readonly detent?: Detent;
  readonly defaultDetent?: Detent;
  readonly onDetentChange?: (detent: Detent) => void;
  /** Modal: scrim, focus trap, outside tap closes. Default true. */
  readonly modal?: boolean;
  /** Render into `document.body` instead of in place (then give the content a touch scope yourself). */
  readonly portal?: boolean;
  readonly footer?: ReactNode;
  /** Extra controls in the header, before ✕. */
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const DETENT_CLASS: Readonly<Record<Detent, string>> = {
  peek: 'h-[min(176px,100%)]',
  half: 'h-1/2',
  full: 'h-[92%]',
};

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  detent,
  defaultDetent = 'half',
  onDetentChange,
  modal = true,
  portal = false,
  footer,
  actions,
  children,
  className,
  'data-testid': testId,
}: SheetProps): JSX.Element {
  const [own, setOwn] = useState<Detent>(defaultDetent);
  const current = detent ?? own;
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{
    id: number;
    y: number;
    t: number;
    h: number;
    parent: number;
    lastY: number;
    lastT: number;
  } | null>(null);
  const content = useRef<HTMLDivElement>(null);
  /** The last grab-bar press was a drag: its click must not also step the detent. */
  const dragged = useRef(false);
  const bottom = side === 'bottom';

  const setDetent = (d: Detent): void => {
    if (detent === undefined) setOwn(d);
    onDetentChange?.(d);
  };

  const onGrabDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const el = content.current;
    const parent = el?.offsetParent ?? el?.parentElement;
    if (el === null || parent === null || parent === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    const now = event.timeStamp;
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      t: now,
      h: el.getBoundingClientRect().height,
      parent: parent.getBoundingClientRect().height,
      lastY: event.clientY,
      lastT: now,
    };
  };
  const onGrabMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== event.pointerId) return;
    if (dragHeight === null && Math.abs(event.clientY - d.y) < 6) return;
    dragged.current = true;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    setDragHeight(Math.max(96, Math.min(d.parent * 0.92, d.h - (event.clientY - d.y))));
  };
  const onGrabUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (d === null || d.id !== event.pointerId || dragHeight === null) return;
    const dt = Math.max(1, event.timeStamp - d.lastT);
    const velocity = (event.clientY - d.lastY) / dt;
    setDragHeight(null);
    setDetent(snapDetent(dragHeight, Math.abs(velocity) > 0 ? velocity : 0, d.parent, current));
  };

  const body = (
    <>
      {modal ? <DialogPrimitive.Overlay className="absolute inset-0 z-(--z-dialog) bg-scrim" /> : null}
      <DialogPrimitive.Content
        ref={content}
        data-density="touch"
        data-side={side}
        data-detent={bottom ? current : undefined}
        data-testid={testId}
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        onInteractOutside={(event) => {
          if (!modal) event.preventDefault();
        }}
        style={bottom && dragHeight !== null ? { height: dragHeight } : undefined}
        className={cn(
          'absolute z-(--z-dialog) flex flex-col border-line bg-panel text-fg shadow-sheet outline-none',
          'animate-[ekza-touch-in_var(--motion-touch)_cubic-bezier(0.2,0.8,0.2,1)]',
          bottom
            ? cn(
                'inset-x-0 bottom-0 max-h-full rounded-t-[22px] border-t',
                dragHeight === null && DETENT_CLASS[current],
              )
            : 'top-0 right-0 bottom-0 w-(--size-touch-sheet) max-w-full rounded-tl-[22px] border-l',
          className,
        )}
      >
        {bottom ? (
          <button
            type="button"
            aria-label={`Sheet size: ${current}. Tap to change`}
            className="mx-auto flex min-h-(--touch-hit) w-24 shrink-0 touch-none items-center justify-center"
            onClick={() => {
              if (dragged.current) dragged.current = false;
              else setDetent(nextDetent(current));
            }}
            onPointerDown={onGrabDown}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabUp}
            onPointerCancel={() => {
              drag.current = null;
              setDragHeight(null);
            }}
          >
            <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-line-strong" />
          </button>
        ) : null}
        <header className={cn('flex shrink-0 items-start gap-2 pr-2 pl-[18px]', bottom ? 'pt-0' : 'pt-3', 'pb-2')}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-2.5">
            <DialogPrimitive.Title className="text-touch-title font-semibold tracking-[-0.01em]">
              {title}
            </DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="text-touch-label text-fg-3">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          {actions}
          <DialogPrimitive.Close
            aria-label="Close"
            className="inline-flex size-(--touch-hit) shrink-0 items-center justify-center rounded-full text-fg-2 hover:text-fg active:bg-pressed"
          >
            <Glyph name="close" />
          </DialogPrimitive.Close>
        </header>
        {/* focusable, so a keyboard reaches a body with no control in it (WCAG 2.1.1, axe scrollable-region-focusable) */}
        <div
          data-touch-scroll=""
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- axe scrollable-region-focusable wins here
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {children}
        </div>
        {footer === undefined ? null : (
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3.5 pt-2.5 pb-(--touch-inset-bottom)">
            {footer}
          </footer>
        )}
      </DialogPrimitive.Content>
    </>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {portal ? <DialogPrimitive.Portal>{body}</DialogPrimitive.Portal> : body}
    </DialogPrimitive.Root>
  );
}

/** A row in a sheet's list: 52 px, a title, an optional second line and trailing content (More, Scene, Library). */
export function SheetRow({
  title,
  detail,
  icon,
  trailing,
  disabled,
  onClick,
  className,
}: {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly icon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      className={cn(
        'flex min-h-[52px] w-full items-center gap-3 rounded-touch px-2.5 py-1.5 text-left',
        'transition-colors duration-(--motion-hover) active:bg-header aria-disabled:cursor-default',
        className,
      )}
      onClick={() => {
        if (!disabled) onClick?.();
      }}
    >
      {icon === undefined ? null : (
        <span className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-header text-fg-2">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('font-medium', disabled ? 'text-fg-3' : 'text-fg')}>{title}</span>
        {detail === undefined ? null : <span className="truncate text-touch-label text-fg-3">{detail}</span>}
      </span>
      {trailing}
    </button>
  );
}

/** A group heading inside a sheet ("SHAPE", "SELECT"). */
export function SheetGroup({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <h3 className="px-2 pt-4 pb-1.5 text-[12px] font-semibold tracking-[0.06em] text-fg-3 uppercase">{children}</h3>
  );
}
