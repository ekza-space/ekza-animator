// Segmented control (STUDIO-TOUCH-SPEC §4.2, §5.6, §18): enums as one row of segments, each a full 44 px target — the component pill
// (Whole · Points · Edges · Faces), the Thread's layer switch (Timeline · Keys · Curves), brush modes. A radio group
// by default, or a tab list (the Path's stages, §18). Roving focus: Tab enters at the chosen segment, arrows move and
// choose, Home / End jump.
import { type JSX, type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from '../cn';
import { rovingIndex } from './layout';

export interface SegmentedItem<V extends string> {
  readonly value: V;
  readonly label: ReactNode;
  /** The accessible name when `label` is not plain text. */
  readonly ariaLabel?: string;
  readonly icon?: ReactNode;
  /** A trailing glyph or count (readiness `○ ◐ ● ⚠2`); shape and count, never colour alone. */
  readonly badge?: ReactNode;
  readonly disabled?: boolean;
  /** `aria-controls` of a tab. */
  readonly controls?: string;
  /** The segment's own test id; default `<the group's test id>-<value>` when the group has one. */
  readonly testId?: string;
}

export interface SegmentedProps<V extends string> {
  readonly items: readonly SegmentedItem<V>[];
  readonly value: V;
  readonly onValueChange: (value: V) => void;
  /** The group's accessible name ("Selection mode", "Stage"). */
  readonly label: string;
  /** `radiogroup` (default) or `tablist`. */
  readonly kind?: 'radiogroup' | 'tablist';
  /** `neutral`: the chosen segment lifts; `accent`: it fills with the accent (the Path). */
  readonly variant?: 'neutral' | 'accent';
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function Segmented<V extends string>({
  items,
  value,
  onValueChange,
  label,
  kind = 'radiogroup',
  variant = 'neutral',
  className,
  'data-testid': testId,
}: SegmentedProps<V>): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const tab = kind === 'tablist';

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const next = rovingIndex(index, event.key, items.length, 'horizontal', (i) => items[i]?.disabled === true);
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (item === undefined) return;
    refs.current[next]?.focus();
    if (item.value !== value) onValueChange(item.value);
  };

  return (
    <div
      role={kind}
      aria-label={label}
      data-testid={testId}
      className={cn('inline-flex shrink-0 items-center gap-0.5 rounded-touch bg-field p-0.5', className)}
    >
      {items.map((item, index) => {
        const on = index === chosen;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={tab ? 'tab' : 'radio'}
            {...(tab ? { 'aria-selected': on } : { 'aria-checked': on })}
            {...(item.ariaLabel === undefined ? {} : { 'aria-label': item.ariaLabel })}
            {...(item.controls === undefined ? {} : { 'aria-controls': item.controls })}
            tabIndex={on ? 0 : -1}
            disabled={item.disabled}
            data-on={on ? '' : undefined}
            data-testid={item.testId ?? (testId === undefined ? undefined : `${testId}-${item.value}`)}
            className={cn(
              'inline-flex min-h-(--touch-hit) min-w-(--touch-hit) select-none items-center',
              'justify-center gap-2 whitespace-nowrap rounded-touch-inner px-3 text-touch font-medium text-fg-2',
              'transition-colors duration-(--motion-hover) hover:enabled:text-fg disabled:cursor-not-allowed disabled:opacity-45',
              variant === 'accent'
                ? 'data-on:bg-accent-fill data-on:text-on-accent'
                : 'data-on:bg-pressed data-on:text-fg data-on:shadow-[0_1px_3px_rgba(0,0,0,0.35)]',
            )}
            onClick={() => {
              if (!on) onValueChange(item.value);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.icon}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
