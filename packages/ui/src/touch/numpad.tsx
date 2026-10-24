// Numpad (STUDIO-TOUCH-SPEC §5.6): opened by a tap on a value chip and anchored to it (the caller places it).
// Pen-sized keys, 16 px+ text, minus and decimal point, expressions (+ − × ÷ ( ) =), ±1 / ±10 nudges, Next / Done.
// The field is a real text input with `inputmode="none"`: a hardware keyboard and handwriting (Scribble) write in it,
// the on-screen keyboard stays away. The header names the Pro channel ("Side · Rotate Z").
import { type CSSProperties, type JSX, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../cn';
import { Glyph } from './glyphs';
import { evaluateExpression, keyFromKeyboard, type NumpadKey, numpadInit, numpadReduce } from './numpad-model';
import { clampValue } from './scrub';

export interface NumpadProps {
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  /** The Pro channel or parameter name, shown in grey after the label. */
  readonly proName?: string;
  readonly min?: number;
  readonly max?: number;
  /** Done (or Enter): the evaluated value, clamped. */
  readonly onDone: (value: number) => void;
  /** Next: commit and move to the next chip. Shown only when given. */
  readonly onNext?: (value: number) => void;
  /** ✕ or Escape: nothing changes. */
  readonly onCancel: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly 'data-testid'?: string;
}

const KEY_ROWS: readonly (readonly NumpadKey[])[] = [
  ['(', ')', '±', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '=', '⌫'],
  ['-10', '-1', '+1', '+10'],
];

const SPOKEN: Partial<Record<NumpadKey, string>> = {
  '(': 'open bracket',
  ')': 'close bracket',
  '±': 'change sign',
  '÷': 'divided by',
  '×': 'times',
  '−': 'minus',
  '+': 'plus',
  '=': 'equals',
  '⌫': 'delete',
  '.': 'decimal point',
  '-10': 'minus 10',
  '-1': 'minus 1',
  '+1': 'plus 1',
  '+10': 'plus 10',
};

const SHOWN: Partial<Record<NumpadKey, string>> = { '-10': '−10', '-1': '−1', '+1': '+1', '+10': '+10' };

export function Numpad({
  label,
  value,
  unit,
  proName,
  min,
  max,
  onDone,
  onNext,
  onCancel,
  className,
  style,
  'data-testid': testId,
}: NumpadProps): JSX.Element {
  const [state, setState] = useState(() => numpadInit(value));
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const statusId = useId();
  const result = evaluateExpression(state.text);
  const plain = /^-?(\d+\.?\d*|\.\d+)$/.test(state.text);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const finish = (then: (v: number) => void): void => {
    if (result === null) return;
    then(clampValue(result, min, max));
  };
  const press = (key: NumpadKey): void => setState((s) => numpadReduce(s, key));

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape anywhere in the numpad cancels it
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a non-modal panel anchored to its chip; <dialog> brings its own positioning
      role="dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      style={style}
      className={cn(
        'flex w-(--size-touch-numpad) max-w-[calc(100vw-32px)] flex-col gap-2 rounded-touch-card border border-line',
        'bg-panel p-3 shadow-sheet',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex min-h-(--touch-hit) items-center gap-2 pl-1">
        <div id={titleId} className="min-w-0 flex-1 truncate text-touch-label">
          <span className="text-fg-2">{label}</span>
          {proName === undefined ? null : <span className="text-fg-3"> · {proName}</span>}
        </div>
        <button
          type="button"
          aria-label="Cancel"
          className="inline-flex size-(--touch-hit) items-center justify-center rounded-full text-fg-2 hover:text-fg active:bg-pressed"
          onClick={onCancel}
        >
          <Glyph name="close" />
        </button>
      </div>
      <div className="flex items-center gap-2 rounded-touch bg-field px-3 py-1">
        <input
          ref={input}
          type="text"
          inputMode="none"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${label} value`}
          aria-describedby={statusId}
          aria-invalid={result === null || undefined}
          value={state.text}
          className="min-h-(--touch-hit) min-w-0 flex-1 bg-transparent font-mono text-[max(28px,var(--touch-input-text))] leading-tight tabular-nums text-fg outline-none"
          onChange={(event) => setState({ text: event.target.value, fresh: false })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              finish(onDone);
              return;
            }
            // Typed characters go into the field as typed; `±` and nudges have no key of their own.
            // The first key acts on the fresh value as the on-screen key would (a digit replaces it, an operator
            // extends it); later keys edit the field as typed.
            const key = keyFromKeyboard(event.key);
            if (key === null || !state.fresh) return;
            event.preventDefault();
            press(key);
          }}
        />
        {unit === undefined ? null : <span className="font-mono text-touch-value text-fg-3">{unit}</span>}
      </div>
      <output id={statusId} aria-live="polite" className="min-h-4 px-1 text-touch-label text-fg-3">
        {result === null ? (state.text === '' ? '' : 'Not a number yet') : plain ? '' : `= ${result}`}
      </output>
      <div className="grid grid-cols-4 gap-2">
        {KEY_ROWS.flat().map((key) => {
          const op = ['÷', '×', '−', '+', '(', ')', '±', '='].includes(key);
          const nudge = key.length > 1 && key !== '⌫';
          return (
            <button
              key={key}
              type="button"
              aria-label={SPOKEN[key] ?? key}
              className={cn(
                'inline-flex min-h-[max(48px,var(--touch-hit))] select-none items-center justify-center rounded-touch',
                'border border-line font-mono text-[17px] transition-colors duration-(--motion-hover) active:bg-pressed',
                op || nudge ? 'bg-header text-fg-2' : 'bg-hover text-fg',
                nudge && 'text-touch-value',
              )}
              onPointerDown={(event) => {
                // Keep the caret in the field (mouse); touch never moves focus to a button.
                if (event.pointerType === 'mouse') event.preventDefault();
              }}
              onClick={() => press(key)}
            >
              {key === '⌫' ? <Glyph name="backspace" /> : (SHOWN[key] ?? key)}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1">
        {onNext === undefined ? null : (
          <button
            type="button"
            disabled={result === null}
            className="inline-flex min-h-(--touch-hit) flex-1 items-center justify-center gap-1.5 rounded-touch border border-line bg-header text-touch font-medium text-fg disabled:opacity-45"
            onClick={() => finish(onNext)}
          >
            Next <Glyph name="next" size={18} />
          </button>
        )}
        <button
          type="button"
          disabled={result === null}
          className="inline-flex min-h-(--touch-hit) flex-1 items-center justify-center rounded-touch bg-accent-fill text-touch font-semibold text-on-accent disabled:opacity-45"
          onClick={() => finish(onDone)}
        >
          Done
        </button>
      </div>
    </div>
  );
}
