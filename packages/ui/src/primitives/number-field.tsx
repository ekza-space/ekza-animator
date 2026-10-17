import { type ComponentPropsWithRef, type FocusEvent, type JSX, type KeyboardEvent, useRef, useState } from 'react';
import { cn } from '../cn';

/**
 * Parses typed text against the current value. The default understands plain numbers and the relative forms
 * `+=n`, `-=n`, `*=n`, `/=n` (research 09 §6.4); the editor passes editor-core's full expression parser.
 */
export type NumberParser = (text: string, current: number) => number | null;

export const defaultNumberParser: NumberParser = (text, current) => {
  const trimmed = text.trim().replace(/^=/, '');
  const relative = /^([+\-*/])=\s*(.+)$/.exec(trimmed);
  if (relative !== null) {
    const operand = Number(relative[2]);
    if (relative[2] === undefined || !Number.isFinite(operand)) return null;
    const op = relative[1];
    if (op === '+') return current + operand;
    if (op === '-') return current - operand;
    if (op === '*') return current * operand;
    return operand === 0 ? null : current / operand;
  }
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};

export interface NumberFieldProps
  extends Omit<
    ComponentPropsWithRef<'input'>,
    'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'
  > {
  /** Current value; null shows the mixed state (`—`, several different values). */
  readonly value: number | null;
  /** Called with the parsed value on Enter, blur or an arrow-key step. Not called when the text is unchanged. */
  readonly onCommit: (value: number) => void;
  readonly parse?: NumberParser;
  /** Display text for a value; default: three decimals (research 09 §6.4). */
  readonly format?: (value: number) => string;
  /** Arrow-key step (Shift ×10, Alt ×0.1). Default 1. */
  readonly step?: number;
  readonly min?: number;
  readonly max?: number;
  /** Message shown (title) when typed text does not parse. */
  readonly invalidMessage?: string;
}

const defaultFormat = (value: number): string => value.toFixed(3);

/**
 * Numeric text field with expressions: Enter or blur commits, Esc reverts, ↑/↓ step. Invalid input keeps the
 * old value and shows a 1 px danger border plus a tooltip (research 09 §6.4, §8.7).
 */
export function NumberField({
  value,
  onCommit,
  parse = defaultNumberParser,
  format = defaultFormat,
  step = 1,
  min,
  max,
  invalidMessage = 'Not a number',
  className,
  onKeyDown,
  onBlur,
  onFocus,
  ...props
}: NumberFieldProps): JSX.Element {
  const shown = value === null ? '' : format(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const skipBlurCommit = useRef(false);

  const clamp = (v: number): number =>
    Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, v));

  const commitText = (raw: string): boolean => {
    if (raw === shown) {
      setInvalid(false);
      return true;
    }
    const parsed = parse(raw, value ?? 0);
    if (parsed === null || !Number.isFinite(parsed)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    onCommit(clamp(parsed));
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const input = event.currentTarget;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commitText(text)) {
        setEditing(false);
        input.select();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setInvalid(false);
      setText(shown);
      setEditing(false);
      skipBlurCommit.current = true;
      input.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const factor = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
      const next = clamp((value ?? 0) + (event.key === 'ArrowUp' ? 1 : -1) * step * factor);
      setInvalid(false);
      setEditing(false);
      onCommit(next);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>): void => {
    onBlur?.(event);
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      return;
    }
    if (editing && !commitText(text)) setText(shown);
    setInvalid(false);
    setEditing(false);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={editing ? text : shown}
      placeholder={value === null ? '—' : undefined}
      aria-invalid={invalid || undefined}
      title={invalid ? invalidMessage : undefined}
      onChange={(event) => {
        setEditing(true);
        setInvalid(false);
        setText(event.currentTarget.value);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        event.currentTarget.select();
      }}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className={cn(
        'ekza-numeric h-[var(--size-field)] w-full min-w-0 rounded-field border border-transparent bg-field px-1.5 text-right',
        'text-ui text-fg outline-none placeholder:text-fg-3 placeholder:italic hover:border-line-strong',
        'focus:border-accent aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    />
  );
}
