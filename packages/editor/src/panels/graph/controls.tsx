// Small form controls of the Graph Editor panel, styled with the design tokens (research 09 §8.2, §8.7). They stay
// local until the shared primitives of @ekza-animator/ui land (WP-8).
import {
  Component,
  type ErrorInfo,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

const BUTTON =
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
      className={BUTTON}
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
 * mixed placeholder '—'. `onCommit` returns an error message to mark the input invalid, or null.
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
  useEffect(() => {
    if (!editing.current) setText(props.value);
  }, [props.value]);

  const commit = (): void => {
    editing.current = false;
    if (text === props.value) {
      setError(null);
      return;
    }
    const failure = props.onCommit(text);
    setError(failure);
    if (failure === null) setText(props.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      e.currentTarget.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing.current = false;
      setText(props.value);
      setError(null);
      e.currentTarget.blur();
    }
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
        onBlur={commit}
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

/** Keeps a failing part of the panel from taking the whole Graph Editor down. */
export class PartBoundary extends Component<
  { readonly fallback: ReactNode; readonly children?: ReactNode; readonly resetKey?: unknown },
  { readonly failed: boolean; readonly resetKey: unknown }
> {
  override state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: { readonly resetKey?: unknown },
    state: { readonly failed: boolean; readonly resetKey: unknown },
  ): { readonly failed: boolean; readonly resetKey: unknown } | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn('Graph Editor part failed:', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
