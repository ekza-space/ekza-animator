// Chips (STUDIO-TOUCH-SPEC §5.6, §6.6, §18): the value chip (ScrubChip) — drag sideways to scrub, farther away
// vertically for finer steps, tap for the numpad, long-press for its menu; a `slider` with its value and unit as
// `aria-valuetext` — plus the toggle chip (booleans) and the action chip. Enums are segmented chips (segmented.tsx).
import { type ComponentPropsWithRef, type JSX, type ReactNode, useRef, useState } from 'react';
import { cn } from '../cn';
import { createScrub, formatValue, keyStep, type ScrubSession } from './scrub';
import { useLongPress } from './use-long-press';

const chipBase = cn(
  'inline-flex min-h-(--touch-hit) min-w-(--touch-hit) select-none items-center gap-2 whitespace-nowrap rounded-touch',
  'border border-line bg-panel px-3.5 shadow-touch transition-[border-color,box-shadow] duration-(--motion-hover)',
);

export interface ValueChipProps {
  /** Plain label, e.g. "Distance" (§10.1: Pro's number, unit and sign). */
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  /** The Pro channel name, read after the value ("Side · Rotate Z"). */
  readonly proName?: string;
  /** The Thumb key's drag meaning: ×0.1 (Fine) or ×10 (Coarse). */
  readonly modifier?: number;
  /** Keyed (red) or altered (amber) state of a channel. */
  readonly state?: 'keyed' | 'altered';
  readonly disabled?: boolean;
  /** Live value while scrubbing or stepping. */
  readonly onChange?: (value: number) => void;
  /** The scrub or key step ended with this value (one undo step). */
  readonly onCommit?: (value: number) => void;
  /** A tap: open the numpad anchored to this chip. */
  readonly onOpenNumpad?: (chip: HTMLElement) => void;
  /** A long-press (right-click): the chip's menu. */
  readonly onMenu?: (chip: HTMLElement) => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

/** ScrubChip: a value beside the work. */
export function ValueChip({
  label,
  value,
  step,
  unit,
  min,
  max,
  proName,
  modifier = 1,
  state,
  disabled = false,
  onChange,
  onCommit,
  onOpenNumpad,
  onMenu,
  className,
  'data-testid': testId,
}: ValueChipProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const scrub = useRef<ScrubSession | null>(null);
  const [scrubbing, setScrubbing] = useState<{ readonly factor: number } | null>(null);
  const text = formatValue(value, step, unit);

  const handlers = useLongPress({
    onTap: () => {
      if (!disabled && ref.current !== null) onOpenNumpad?.(ref.current);
    },
    onLongPress: () => {
      if (!disabled && ref.current !== null) onMenu?.(ref.current);
    },
    onDragStart: (e) => {
      if (disabled) return;
      const options = { value, step, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
      scrub.current = createScrub(options);
      const v = scrub.current.move(e.dx, e.dy, modifier);
      setScrubbing({ factor: scrub.current.factor });
      onChange?.(v);
    },
    onDrag: (e) => {
      const s = scrub.current;
      if (s === null) return;
      const v = s.move(e.dx, e.dy, modifier);
      setScrubbing((prev) => (prev?.factor === s.factor ? prev : { factor: s.factor }));
      onChange?.(v);
    },
    onDragEnd: () => {
      const s = scrub.current;
      scrub.current = null;
      setScrubbing(null);
      if (s !== null) onCommit?.(s.value);
    },
    onCancel: () => {
      scrub.current = null;
      setScrubbing(null);
      onChange?.(value);
    },
  });

  return (
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a range input cannot scrub by distance or open the numpad on a tap
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuenow={value}
      {...(min === undefined ? {} : { 'aria-valuemin': min })}
      {...(max === undefined ? {} : { 'aria-valuemax': max })}
      aria-valuetext={proName === undefined ? text : `${text}, ${proName}`}
      aria-disabled={disabled || undefined}
      data-state={state}
      data-scrubbing={scrubbing === null ? undefined : ''}
      data-testid={testId}
      className={cn(
        chipBase,
        'relative cursor-ew-resize touch-none',
        'data-scrubbing:border-accent data-scrubbing:shadow-[0_0_0_3px_var(--accent-soft),var(--elevation-touch)]',
        'data-[state=keyed]:border-autokey data-[state=altered]:border-warn',
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-45',
        className,
      )}
      {...handlers}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (ref.current !== null) onOpenNumpad?.(ref.current);
          return;
        }
        const next = keyStep(event.key, value, step * modifier, min, max, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        onChange?.(next);
        onCommit?.(next);
      }}
    >
      <span className="text-touch-label text-fg-3">{label}</span>
      <span
        className={cn(
          'font-mono text-touch-value font-medium tabular-nums text-fg',
          state === 'keyed' && 'text-danger',
          state === 'altered' && 'text-warn',
        )}
      >
        {text}
      </span>
      {scrubbing !== null && scrubbing.factor !== 1 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full rounded-[8px] border border-line bg-panel px-2 py-0.5 text-touch-label font-semibold text-accent-text"
        >
          ×{scrubbing.factor}
        </span>
      ) : null}
    </div>
  );
}

export interface ToggleChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  readonly label: ReactNode;
  readonly pressed: boolean;
  readonly onPressedChange?: (pressed: boolean) => void;
}

/** A boolean as a chip (Mirror edits, Falloff, Snap, Pressure): `aria-pressed`, a switch drawn beside the word. */
export function ToggleChip({
  label,
  pressed,
  onPressedChange,
  className,
  type = 'button',
  onClick,
  ...props
}: ToggleChipProps): JSX.Element {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cn(
        chipBase,
        'cursor-pointer text-touch font-medium text-fg-2 aria-pressed:border-accent/60 aria-pressed:bg-accent-soft aria-pressed:text-fg',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onPressedChange?.(!pressed);
      }}
      {...props}
    >
      {label}
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-(--motion-hover)',
          pressed ? 'bg-accent-fill' : 'bg-pressed',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-3 rounded-full transition-transform duration-(--motion-hover)',
            pressed ? 'translate-x-3 bg-on-accent' : 'bg-fg-3',
          )}
        />
      </span>
    </button>
  );
}

export interface ActionChipProps extends ComponentPropsWithRef<'button'> {
  readonly icon?: ReactNode;
}

/** A chip that runs something (Options, Reselect, Next ›). */
export function ActionChip({ icon, className, type = 'button', children, ...props }: ActionChipProps): JSX.Element {
  return (
    <button
      type={type}
      className={cn(
        chipBase,
        'cursor-pointer text-touch font-medium text-fg-2 hover:enabled:text-fg active:enabled:bg-pressed',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
