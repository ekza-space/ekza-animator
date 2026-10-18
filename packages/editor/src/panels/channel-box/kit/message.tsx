// A validation message under a field (numeric entry, inline rename). Rendered into document.body at the field's
// edge, so table cells, virtualized rows and scrolling panels cannot clip it; the field points at it with
// aria-describedby. Below the field when there is room, else above; kept inside the window horizontally.
import { type JSX, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ERROR_TEXT } from './styles';

export interface FieldMessageProps {
  /** The field the message belongs to; nothing renders without it. */
  readonly anchor: HTMLElement | null;
  /** Referenced by the field's aria-describedby. */
  readonly id: string;
  readonly text: string;
  readonly testId?: string | undefined;
}

const GAP = 2;
const MARGIN = 4;

export function FieldMessage(props: FieldMessageProps): JSX.Element | null {
  const { anchor } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ readonly left: number; readonly top: number } | null>(null);

  useLayoutEffect(() => {
    const message = ref.current;
    if (anchor === null || message === null) return;
    const place = (): void => {
      const field = anchor.getBoundingClientRect();
      const size = message.getBoundingClientRect();
      const below = field.bottom + GAP;
      const top =
        below + size.height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, field.top - size.height - GAP);
      // Right-aligned fields (Channel Box values) keep the message under their right edge.
      const preferred = field.left + size.width <= window.innerWidth - MARGIN ? field.left : field.right - size.width;
      const left = Math.max(MARGIN, Math.min(preferred, window.innerWidth - size.width - MARGIN));
      setPosition((previous) =>
        previous !== null && previous.left === left && previous.top === top ? previous : { left, top },
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(anchor);
    observer.observe(message);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  if (anchor === null) return null;
  return createPortal(
    <div
      ref={ref}
      id={props.id}
      role="alert"
      data-testid={props.testId}
      className={`pointer-events-none fixed z-50 max-w-80 rounded-[4px] border border-[var(--danger,#ef6b6b)] bg-[var(--bg-popover,#2c2e34)] px-1.5 py-0.5 text-xs shadow-[0_4px_12px_rgba(0,0,0,0.4)] ${ERROR_TEXT}`}
      style={{
        left: position?.left ?? -10_000,
        top: position?.top ?? -10_000,
        visibility: position === null ? 'hidden' : 'visible',
      }}
    >
      {props.text}
    </div>,
    document.body,
  );
}
