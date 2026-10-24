// The Loupe, v1 chips only (STUDIO-TOUCH-SPEC §5.4): when hit candidates collide under a finger, a row of named
// chips opens above it — "Index 1 · Index 2 · Hand control · Body mesh". Tap a chip, or keep the finger down,
// slide onto one and lift: the caller forwards the press's position (`hover`) and calls `pickAt` on lift.
import { type JSX, type Ref, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { cn } from '../cn';
import { boxAt, type Point } from './layout';

export interface LoupeCandidate {
  readonly id: string;
  readonly label: string;
}

export interface LoupeHandle {
  /** The candidate under a page point (a lift after sliding), or null. */
  pickAt(point: Point): string | null;
}

export interface LoupeChipsProps {
  readonly candidates: readonly LoupeCandidate[];
  /** The finger, in the container's px: the chips open above it. */
  readonly anchor: Point;
  readonly onPick: (id: string) => void;
  /** The still-pressed finger, in page px: the chip under it lights. */
  readonly hover?: Point | null;
  readonly label?: string;
  readonly ref?: Ref<LoupeHandle>;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const SLIDE_SLOP = 6;

export function LoupeChips({
  candidates,
  anchor,
  onPick,
  hover = null,
  label = 'Which one?',
  ref,
  className,
  'data-testid': testId,
}: LoupeChipsProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const under = (point: Point): number => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-candidate]') ?? [])];
    return boxAt(
      point,
      items.map((el) => el.getBoundingClientRect()),
      SLIDE_SLOP,
    );
  };
  useImperativeHandle(ref, () => ({
    pickAt(point) {
      const i = under(point);
      return i < 0 ? null : (candidates[i]?.id ?? null);
    },
  }));
  // The chip under a still-pressed finger lights (a DOM attribute: positions are known only after layout).
  useLayoutEffect(() => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-candidate]') ?? [])];
    const at =
      hover === null
        ? -1
        : boxAt(
            hover,
            items.map((el) => el.getBoundingClientRect()),
            SLIDE_SLOP,
          );
    items.forEach((el, i) => el.toggleAttribute('data-lit', i === at));
  }, [hover]);

  return (
    <div
      ref={root}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row of buttons, not a form (<fieldset>)
      role="group"
      aria-label={label}
      data-testid={testId}
      style={{ left: anchor.x, top: anchor.y - 28 }}
      className={cn(
        'absolute z-(--z-popover) flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-full flex-wrap',
        'justify-center gap-1.5 rounded-touch-card border border-line bg-touch-surface p-2 shadow-sheet backdrop-blur-md',
        className,
      )}
    >
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          data-candidate={c.id}
          className={cn(
            'inline-flex min-h-(--touch-hit) items-center rounded-full border border-line bg-panel px-4 font-medium text-fg',
            'transition-colors duration-(--motion-hover) data-lit:border-transparent data-lit:bg-accent-fill data-lit:text-on-accent',
          )}
          onClick={() => onPick(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
