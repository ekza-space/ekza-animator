// Anchored popover of the data panels (clip settings): rendered into document.body under its anchor, closed by Esc
// or a pointer press outside. A stand-in until `@ekza-animator/ui` ships the Radix Popover (WP-8); wp-notes D-3.
import { type JSX, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])';

export interface PopoverProps {
  readonly anchor: HTMLElement;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly testId?: string | undefined;
  readonly width?: number | undefined;
}

export function Popover(props: PopoverProps): JSX.Element {
  const { anchor, onClose, width = 320 } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [position, setPosition] = useState<{ readonly left: number; readonly top: number } | null>(null);

  useLayoutEffect(() => {
    const popover = ref.current;
    if (popover === null) return;
    const place = (): void => {
      const a = anchor.getBoundingClientRect();
      const size = popover.getBoundingClientRect();
      const below = a.bottom + 4;
      const top = below + size.height <= window.innerHeight - 4 ? below : Math.max(4, a.top - size.height - 4);
      const left = Math.max(4, Math.min(a.left, window.innerWidth - size.width - 4));
      setPosition({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popover);
    return () => observer.disconnect();
  }, [anchor]);

  // Focus moves in once the popover is placed (a `visibility: hidden` element cannot take focus).
  const placed = position !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [placed]);

  useEffect(() => {
    // Esc closes the popover unless a field inside used it first (a field reverting its draft prevents default).
    // A document listener runs after React's own handlers, which see the event at the portal root.
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (ref.current?.contains(document.activeElement) === true && anchor.isConnected) anchor.focus();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [anchor, onClose]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target) === true || anchor.contains(target)) return;
      // Context menus opened from inside the popover live in their own portal.
      if (target instanceof Element && target.closest('[role="menu"]') !== null) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, onClose]);

  return createPortal(
    <dialog
      ref={ref}
      open
      aria-label={props.label}
      data-testid={props.testId}
      className="fixed right-auto bottom-auto z-40 m-0 max-h-[80vh] overflow-auto rounded-[6px] border border-line bg-[var(--bg-popover,#2c2e34)] p-3 text-xs text-fg shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
      style={{
        width,
        left: position?.left ?? -10_000,
        top: position?.top ?? -10_000,
        visibility: position === null ? 'hidden' : 'visible',
      }}
    >
      {props.children}
    </dialog>,
    document.body,
  );
}
