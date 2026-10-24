// Stepper (STUDIO-TOUCH-SPEC §5.7, §6.6): `− n +` — the session bar's counts (replacing PgUp / PgDn) and the
// Numbers sheet's transform steppers. The value is a `spinbutton` (arrows step it); holding − or + repeats.
import { type JSX, useEffect, useRef } from 'react';
import { cn } from '../cn';
import { Glyph } from './glyphs';
import { clampValue, decimalsOf, formatValue, keyStep, roundTo } from './scrub';

export interface StepperProps {
  /** The accessible name ("Segments"); also shown before the value unless `hideLabel`. */
  readonly label: string;
  readonly value: number;
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  readonly unit?: string;
  readonly hideLabel?: boolean;
  readonly onChange: (value: number) => void;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 90;

export function Stepper({
  label,
  value,
  step = 1,
  min,
  max,
  unit,
  hideLabel = false,
  onChange,
  className,
  'data-testid': testId,
}: StepperProps): JSX.Element {
  const live = useRef(value);
  const repeat = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({ timer: null, fired: false });
  useEffect(() => {
    live.current = value;
  }, [value]);
  useEffect(() => {
    const r = repeat.current;
    return () => {
      if (r.timer !== null) clearTimeout(r.timer);
    };
  }, []);

  const by = (dir: 1 | -1): void => {
    const next = clampValue(roundTo(live.current + dir * step, decimalsOf(step)), min, max);
    if (next === live.current) return;
    live.current = next;
    onChange(next);
  };
  function stop(): void {
    if (repeat.current.timer !== null) clearTimeout(repeat.current.timer);
    repeat.current.timer = null;
  }
  const start = (dir: 1 | -1): void => {
    stop();
    repeat.current.fired = false;
    const tick = (): void => {
      repeat.current.fired = true;
      by(dir);
      repeat.current.timer = setTimeout(tick, REPEAT_EVERY_MS);
    };
    repeat.current.timer = setTimeout(tick, REPEAT_DELAY_MS);
  };
  const text = formatValue(value, step, unit);
  const atMin = min !== undefined && value <= min;
  const atMax = max !== undefined && value >= max;

  const button = (dir: 1 | -1, disabled: boolean): JSX.Element => (
    <button
      type="button"
      aria-label={`${dir < 0 ? 'Less' : 'More'} ${label.toLowerCase()}`}
      disabled={disabled}
      className={cn(
        'inline-flex size-(--touch-hit) shrink-0 select-none items-center justify-center rounded-touch-inner text-fg-2',
        'touch-none transition-colors duration-(--motion-hover) hover:enabled:text-fg active:enabled:bg-pressed',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
      onPointerDown={(event) => {
        if (event.button === 0) start(dir);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // A hold already stepped; the click at its end adds nothing.
        if (repeat.current.fired) {
          repeat.current.fired = false;
          return;
        }
        by(dir);
      }}
    >
      <Glyph name={dir < 0 ? 'minus' : 'plus'} />
    </button>
  );

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- − value + as one control, not a form (<fieldset>)
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-touch border border-line bg-panel p-0.5 shadow-touch',
        className,
      )}
    >
      {button(-1, atMin)}
      <div
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a number input would open the on-screen keyboard; the numpad and − / + edit it
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        {...(min === undefined ? {} : { 'aria-valuemin': min })}
        {...(max === undefined ? {} : { 'aria-valuemax': max })}
        aria-valuetext={text}
        className="flex min-h-(--touch-hit) min-w-[3.5ch] select-none items-center justify-center gap-1.5 px-1.5"
        onKeyDown={(event) => {
          const next = keyStep(event.key, value, step, min, max);
          if (next === null) return;
          event.preventDefault();
          if (next !== value) onChange(next);
        }}
      >
        {hideLabel ? null : <span className="text-touch-label text-fg-3">{label}</span>}
        <span className="font-mono text-touch-value font-medium tabular-nums">{text}</span>
      </div>
      {button(1, atMax)}
    </div>
  );
}
