// Small form controls of the Graph Editor panel, styled with the design tokens (research 09 §8.2, §8.7). They stay
// local until the shared primitives of @ekza-animator/ui land (WP-8).
import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from 'react';

/** Look of the toolbar's buttons (exported for menu triggers that render their own button). */
export const BUTTON_CLASS =
  'inline-flex h-6 shrink-0 items-center rounded-[4px] px-1.5 text-[11px] leading-none text-fg-2 ' +
  'hover:bg-[var(--bg-hover,#30323a)] hover:text-fg disabled:pointer-events-none disabled:opacity-40 ' +
  'aria-pressed:bg-[var(--bg-pressed,#3a3d46)] aria-pressed:text-fg aria-pressed:shadow-[inset_0_-2px_0_var(--accent)] ' +
  'focus-visible:outline-2 focus-visible:outline-[var(--accent-text)]';

export function ToolButton(props: {
  readonly testId: string;
  readonly label: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={BUTTON_CLASS}
      data-testid={props.testId}
      title={props.title}
      aria-pressed={props.pressed}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function Separator(): JSX.Element {
  return <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />;
}

const FIELD =
  'h-6 w-[68px] rounded-[3px] border border-transparent bg-[var(--bg-field,#17181b)] px-1 font-mono text-[11px] ' +
  'text-fg outline-none placeholder:italic placeholder:text-fg-3 focus:border-[var(--accent)] ' +
  'disabled:opacity-40 aria-invalid:border-[var(--danger,#ef6b6b)]';

/**
 * Numeric field with expression entry (research 09 §6.4): Enter or blur commits, Esc reverts. `value` '' shows the
 * mixed placeholder '—'. `onCommit` returns an error message to mark the input invalid, or null. Like the Channel
 * Box, Enter (when the value is valid) and Esc give the keyboard back to the editor, so Mod+Z and the tangent digits
 * work at once (acceptance round 2); an invalid entry keeps the focus and its red border.
 */
export function NumberField(props: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly title?: string;
  readonly onCommit: (text: string) => string | null;
}): JSX.Element {
  const [text, setText] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  /** Enter or Esc already settled the draft before the blur they cause. */
  const settled = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(props.value);
  }, [props.value]);

  /** Commits the draft; false when `onCommit` rejected it. */
  const commit = (): boolean => {
    editing.current = false;
    if (text === props.value) {
      setError(null);
      return true;
    }
    const failure = props.onCommit(text);
    setError(failure);
    if (failure === null) setText(props.value);
    return failure === null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!commit()) {
        editing.current = true;
        e.currentTarget.select();
        return;
      }
      settled.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing.current = false;
      settled.current = true;
      setText(props.value);
      setError(null);
      e.currentTarget.blur();
    }
  };
  const onBlur = (): void => {
    if (settled.current) {
      settled.current = false;
      return;
    }
    commit();
  };
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-3">
      <span>{props.label}</span>
      <input
        className={FIELD}
        data-testid={props.testId}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        value={text}
        placeholder={props.value === '' && !props.disabled ? '—' : ''}
        disabled={props.disabled}
        title={error ?? props.title}
        aria-invalid={error === null ? undefined : true}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          editing.current = true;
          setText(e.currentTarget.value);
          setError(null);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}

export function SelectField<T extends string>(props: {
  readonly testId: string;
  readonly label: string;
  readonly value: T | null;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}): JSX.Element {
  return (
    <label className="flex shrink-0 items-center gap-1 text-[11px] text-fg-3">
      <span>{props.label}</span>
      <select
        className="h-6 rounded-[3px] bg-[var(--bg-field,#17181b)] px-1 text-[11px] text-fg disabled:opacity-40"
        data-testid={props.testId}
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(e) => {
          const next = props.options.find((option) => option.value === e.currentTarget.value);
          if (next !== undefined) props.onChange(next.value);
        }}
      >
        {props.value === null ? (
          <option value="" disabled>
            —
          </option>
        ) : null}
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
