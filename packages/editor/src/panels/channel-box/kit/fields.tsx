// Numeric entry of the data panels (research 09 §6.4): a text input that shows a live value, accepts expressions
// while focused, commits on Enter/Tab/blur and reverts on Esc. Invalid input keeps the draft, a red border and a
// message under the field with the reason. While the user types, the field drops its state colours (`style`), as
// Maya's edit field does, so the draft stays legible on a keyed (red) or changed (pink) field.
import {
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { formatFixed, parseNumericInput } from './kernel';
import { FieldMessage } from './message';
import { INPUT, INVALID } from './styles';

/** Keys that start or extend a typed value (a read-only field reports them through `onRejectedEdit`). */
const VALUE_KEY = /^[0-9.,+\-*/=]$/;

export interface NudgeModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly mod: boolean;
}

export interface ExpressionFieldProps {
  /** Shown while the user is not typing; live (it may change while the field has focus). */
  readonly text: string;
  /** Validates and applies a typed draft; returns the reason when the draft is rejected (the field keeps it). */
  readonly onCommit: (draft: string) => string | null;
  readonly ariaLabel: string;
  readonly placeholder?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** ↑/↓ while focused. The draft is dropped: a nudge edits the live value. */
  readonly onNudge?: ((direction: 1 | -1, modifiers: NudgeModifiers) => void) | undefined;
  /** The nudge burst ends: arrow released, Enter, Tab or blur (`cancel` false) or Esc (`cancel` true). */
  readonly onNudgeEnd?: ((cancel: boolean) => void) | undefined;
  /** Tab / Shift+Tab after a successful commit; without it the browser moves focus. */
  readonly onTab?: ((backwards: boolean) => void) | undefined;
  /**
   * A read-only field got a value key (digit, sign, operator) or ↑/↓: the caller explains why it cannot be edited
   * (a locked channel). Called once per focus.
   */
  readonly onRejectedEdit?: (() => void) | undefined;
  readonly onContextMenu?: ((event: MouseEvent<HTMLInputElement>) => void) | undefined;
  readonly className?: string | undefined;
  readonly style?: CSSProperties | undefined;
  readonly title?: string | undefined;
  readonly testId?: string | undefined;
  /** Callback ref of the input element (focus management). */
  readonly bindInput?: ((input: HTMLInputElement | null) => void) | undefined;
  readonly id?: string | undefined;
}

export function ExpressionField(props: ExpressionFieldProps): JSX.Element {
  const {
    text,
    onCommit,
    onNudge,
    onNudgeEnd,
    onTab,
    onRejectedEdit,
    readOnly = false,
    disabled = false,
    bindInput,
    id,
    placeholder,
    ariaLabel,
    title,
    testId,
    className = '',
    style,
    onContextMenu,
  } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Enter, Tab and Esc already settled the draft before the blur they cause. */
  const settled = useRef(false);
  /** A pointer focus selects the text; the following mouseup must not collapse that selection. */
  const keepSelection = useRef(false);
  /** `onRejectedEdit` already ran during this focus. */
  const rejected = useRef(false);
  const messageId = useId();

  // A stable callback ref: the element is state (the message anchors to it) and `bindInput` may change identity on
  // every render of the caller.
  const [element, setElement] = useState<HTMLInputElement | null>(null);
  const bindRef = useRef(bindInput);
  useLayoutEffect(() => {
    bindRef.current = bindInput;
  });
  const setInput = useCallback((input: HTMLInputElement | null) => {
    setElement(input);
    bindRef.current?.(input);
  }, []);

  const reset = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  /** True when there was nothing to commit or the draft was accepted. */
  const commit = useCallback((): boolean => {
    if (draft === null || draft === text) {
      reset();
      return true;
    }
    const problem = onCommit(draft);
    if (problem !== null) {
      setError(problem);
      return false;
    }
    reset();
    return true;
  }, [draft, text, onCommit, reset]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    if (
      readOnly &&
      !disabled &&
      onRejectedEdit !== undefined &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      (VALUE_KEY.test(event.key) || event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      if (!rejected.current) {
        rejected.current = true;
        onRejectedEdit();
      }
      return;
    }
    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        event.stopPropagation();
        onNudgeEnd?.(false);
        if (!commit()) return;
        settled.current = true;
        input.blur();
        return;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        onNudgeEnd?.(true);
        reset();
        settled.current = true;
        input.blur();
        return;
      }
      case 'Tab': {
        onNudgeEnd?.(false);
        if (!commit()) {
          event.preventDefault();
          return;
        }
        if (onTab === undefined) return;
        event.preventDefault();
        settled.current = true;
        onTab(event.shiftKey);
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (onNudge === undefined || readOnly || disabled) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
        onNudge(event.key === 'ArrowUp' ? 1 : -1, {
          shift: event.shiftKey,
          alt: event.altKey,
          mod: event.metaKey || event.ctrlKey,
        });
        return;
      }
      default:
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') onNudgeEnd?.(false);
  };

  const onBlur = (): void => {
    rejected.current = false;
    onNudgeEnd?.(false);
    if (settled.current) {
      settled.current = false;
      reset();
      return;
    }
    if (!commit()) reset(); // an invalid draft is dropped on blur
  };

  const invalid = error !== null;
  const drafting = draft !== null;
  return (
    <>
      <input
        ref={setInput}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? text}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        aria-readonly={readOnly}
        aria-describedby={invalid ? messageId : undefined}
        title={error ?? title}
        data-testid={testId}
        data-invalid={invalid ? 'true' : undefined}
        data-drafting={drafting ? 'true' : undefined}
        className={`${INPUT} ${invalid ? INVALID : ''} ${className}`}
        style={drafting ? undefined : style}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setError(null);
        }}
        onFocus={(event) => {
          rejected.current = false;
          event.currentTarget.select();
          keepSelection.current = true;
        }}
        onMouseUp={(event) => {
          if (!keepSelection.current) return;
          keepSelection.current = false;
          event.preventDefault();
        }}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onBlur}
        onContextMenu={onContextMenu}
      />
      {invalid ? (
        <FieldMessage
          anchor={element}
          id={messageId}
          text={error}
          testId={testId === undefined ? undefined : `${testId}-message`}
        />
      ) : null}
    </>
  );
}

export interface NumberFieldProps
  extends Omit<ExpressionFieldProps, 'text' | 'onCommit' | 'onNudge' | 'onNudgeEnd' | 'placeholder'> {
  /** In the field's display unit; null shows `emptyText`. */
  readonly value: number | null;
  readonly onValue: (value: number) => void;
  readonly format?: ((value: number) => string) | undefined;
  /** Extra rule for a parsed value; returns the reason it is rejected. */
  readonly validate?: ((value: number) => string | null) | undefined;
  /** An empty draft: clears an optional value (returns a reason to reject); without it, empty is invalid. */
  readonly onEmpty?: (() => string | null) | undefined;
  readonly emptyText?: string | undefined;
}

const defaultFormat = (value: number): string => formatFixed(value, 3);

/** An `ExpressionField` over one number: `parseNumericInput` relative to the current value, then `validate`. */
export function NumberField(props: NumberFieldProps): JSX.Element {
  const { value, onValue, format = defaultFormat, validate, onEmpty, emptyText = '', ...rest } = props;
  const onCommit = useCallback(
    (draft: string): string | null => {
      if (draft.trim() === '') return onEmpty === undefined ? 'Enter a number' : onEmpty();
      const next = parseNumericInput(draft, value ?? 0);
      if (next === null) return `'${draft}' is not a number or expression`;
      const problem = validate?.(next) ?? null;
      if (problem !== null) return problem;
      onValue(next);
      return null;
    },
    [value, onValue, validate, onEmpty],
  );
  return (
    <ExpressionField
      {...rest}
      text={value === null ? emptyText : format(value)}
      placeholder={value === null ? emptyText : undefined}
      onCommit={onCommit}
    />
  );
}
