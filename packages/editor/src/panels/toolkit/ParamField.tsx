// One operator parameter as a field (M6A-SPEC §8.6; B11), shared by the Last-op card, Channel Box INPUTS and option
// boxes: numbers take the §5.10 grammar (`parseParamInput`: `30%`, `50cm`, `+=0.1`; fractions shown as fractions);
// the label is a virtual slider (LMB drag after 3 px or an MMB press; `Shift` ×0.1, `Mod` ×10); booleans are
// checkboxes; enums and axes are segmented controls. Typed values commit on Enter, Tab or blur; Esc restores the shown
// value. Enter (once accepted) and Esc give the keyboard back to the editor (the input blurs, as the Channel Box's
// fields do): the hotkeys of the hovered pane (`T`, `G`, `Y`, digits) work again without a click elsewhere.
import { isNumericParam, type ParamDef, type ParamValue } from '@ekza-studio/anim-core';
import { type EditorApp, formatParamValue, paramEditText, parseParamInput } from '@ekza-studio/editor-core';
import { cn } from '@ekza-studio/ui';
import {
  Fragment,
  type JSX,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CHECK, INPUT, INVALID } from '../channel-box/kit/styles';
import { LABEL_DRAG_PX, type ParamSlide, startParamSlide } from './slider';

/** What a field's virtual slider drives (the card previews through the mesh runtime; others update on release). */
export interface ParamSliderHooks {
  /** Called when a drag starts; returns the live preview (or null: the value updates on release). */
  begin?(def: ParamDef): { update(value: number): void; end(value: number, commit: boolean): void } | null;
}

export interface ParamFieldProps {
  readonly app: EditorApp;
  readonly def: ParamDef;
  readonly value: ParamValue | undefined;
  /** `data-testid`s of the input (or control) and of the label. */
  readonly fieldTestId: string;
  readonly nameTestId: string;
  readonly onCommit: (value: ParamValue) => void;
  readonly slider?: ParamSliderHooks;
  /** Focuses (and selects) the input whenever this token changes and `focus` is true. */
  readonly focusToken?: number;
  readonly focus?: boolean;
  /** The label is selected (Channel Box INPUTS: the viewport MMB drag runs this field's slider). */
  readonly nameSelected?: boolean;
  readonly onName?: () => void;
  readonly onMessage?: (text: string) => void;
  readonly disabled?: boolean;
  /** Narrow layouts: the label above the control. */
  readonly stacked?: boolean;
}

const LABEL =
  'min-w-0 cursor-ew-resize truncate rounded-[3px] px-1 text-left text-fg-2 select-none ' +
  'hover:bg-[var(--bg-hover,#30323a)] hover:text-fg';

export function ParamField(props: ParamFieldProps): JSX.Element {
  const { app, def, value } = props;
  const numeric = isNumericParam(def);
  const shown = formatParamValue(def, value);
  // The typed draft belongs to the value it was typed over: a new value from outside (an adjust, a reset) drops it.
  const [draft, setDraft] = useState<{
    readonly text: string;
    readonly base: string;
    readonly invalid: boolean;
  } | null>(null);
  const live = draft !== null && draft.base === shown ? draft : null;
  const text = live?.text ?? null;
  const invalid = live?.invalid === true;
  const setText = (next: string | null): void =>
    setDraft(next === null ? null : { text: next, base: shown, invalid: false });
  const setInvalid = (bad: boolean): void => {
    if (live !== null) setDraft({ ...live, invalid: bad });
  };
  const [dragValue, setDragValue] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const slide = useRef<ParamSlide | null>(null);
  const press = useRef<{ x: number; pointerId: number } | null>(null);
  /** Set while Enter or Esc blurs the input: that blur's handler (it still sees the draft) commits nothing. */
  const settled = useRef(false);
  const release = (element: HTMLInputElement): void => {
    if (element.ownerDocument.activeElement !== element) return;
    settled.current = true;
    try {
      element.blur(); // dispatches the blur synchronously
    } finally {
      settled.current = false;
    }
  };

  useEffect(() => {
    if (props.focus !== true || props.focusToken === undefined) return;
    const element = input.current;
    if (element === null) return;
    element.focus();
    element.select();
  }, [props.focus, props.focusToken]);

  useEffect(() => () => slide.current?.finish(false), []);

  const commitText = (raw: string): boolean => {
    if (raw === shown || raw === paramEditText(def, value)) {
      setText(null);
      return true;
    }
    const parsed = parseParamInput(raw, value, def);
    if ('error' in parsed) {
      setInvalid(true);
      props.onMessage?.(parsed.error);
      return false;
    }
    if (parsed.problem !== null) props.onMessage?.(parsed.problem);
    setText(null); // drops the draft and its invalid mark (a `setInvalid` after it would bring the draft back)
    props.onCommit(parsed.value);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // An accepted value hands the keyboard back to the editor; a refused one keeps the field for correcting.
      if (commitText(event.currentTarget.value)) release(event.currentTarget);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setText(null);
      release(event.currentTarget);
    } else if (event.key === 'Tab') {
      // The browser moves the focus; commit what was typed first.
      if (text !== null) commitText(event.currentTarget.value);
    }
  };

  const beginSlide = (
    element: HTMLElement,
    event: {
      readonly pointerId: number;
      readonly shiftKey: boolean;
      readonly ctrlKey: boolean;
      readonly metaKey: boolean;
    },
    initialDx: number,
    startEvent: Event,
  ): void => {
    if (!numeric || props.disabled === true) return;
    const start = typeof value === 'number' ? value : typeof def.default === 'number' ? def.default : 0;
    const preview = props.slider?.begin?.(def) ?? null;
    slide.current = startParamSlide(
      app,
      def,
      start,
      element,
      event,
      {
        update(next) {
          setDragValue(next);
          preview?.update(next);
        },
        end(next, commit) {
          slide.current = null;
          setDragValue(null);
          if (preview !== null) preview.end(next, commit);
          else if (commit && next !== start) props.onCommit(next);
        },
      },
      initialDx,
      startEvent,
    );
  };

  // A native listener: overlays inside a viewport pane stop `pointerdown` before it reaches React's root (the pane
  // would take the press and capture the pointer), so the label listens to its own presses.
  const onNamePointerDown = (event: PointerEvent): void => {
    if (!numeric || !(event.currentTarget instanceof HTMLElement)) return;
    if (event.button === 1) {
      event.preventDefault();
      beginSlide(event.currentTarget, event, 0, event);
      return;
    }
    if (event.button !== 0) return;
    press.current = { x: event.clientX, pointerId: event.pointerId };
  };
  const latestPointerDown = useRef(onNamePointerDown);
  useLayoutEffect(() => {
    latestPointerDown.current = onNamePointerDown;
  });
  const labelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = labelRef.current;
    if (element === null) return undefined;
    const listener = (event: PointerEvent): void => latestPointerDown.current(event);
    element.addEventListener('pointerdown', listener);
    return () => element.removeEventListener('pointerdown', listener);
  }, []);
  const onNamePointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const start = press.current;
    if (start === null || slide.current !== null || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < LABEL_DRAG_PX) return;
    press.current = null;
    beginSlide(event.currentTarget, event, dx, event.nativeEvent);
  };
  const onNamePointerUp = (): void => {
    if (press.current !== null) props.onName?.();
    press.current = null;
  };

  const label = (
    <button
      ref={labelRef}
      type="button"
      className={cn(LABEL, props.nameSelected === true && 'bg-[var(--bg-selected,#3b3270)] text-fg')}
      data-testid={props.nameTestId}
      title={def.description === undefined ? def.label : `${def.label}: ${def.description}`}
      aria-pressed={props.nameSelected === true}
      disabled={props.disabled}
      onPointerMove={numeric ? onNamePointerMove : undefined}
      onPointerUp={numeric ? onNamePointerUp : () => props.onName?.()}
      onAuxClick={(event) => event.preventDefault()}
    >
      {def.label}
    </button>
  );

  let control: JSX.Element;
  if (def.kind === 'bool') {
    control = (
      <input
        type="checkbox"
        className={cn(CHECK, 'justify-self-start')}
        data-testid={props.fieldTestId}
        aria-label={def.label}
        checked={value === true}
        disabled={props.disabled}
        onChange={(event) => props.onCommit(event.currentTarget.checked)}
      />
    );
  } else if (def.kind === 'enum' || def.kind === 'axis') {
    control = (
      <fieldset
        className="flex min-w-0 overflow-hidden rounded-[3px] border border-line"
        aria-label={def.label}
        data-testid={props.fieldTestId}
        data-value={typeof value === 'string' ? value : ''}
        disabled={props.disabled}
      >
        {(def.options ?? []).map((option) => (
          <label
            key={option.value}
            data-testid={`${props.fieldTestId}-${option.value}`}
            className={cn(
              'min-w-0 flex-1 cursor-pointer truncate px-1 py-0.5 text-center text-ui-dense',
              value === option.value ? 'bg-[var(--bg-selected,#3b3270)] text-fg' : 'text-fg-2 hover:text-fg',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={`${props.fieldTestId}-options`}
              value={option.value}
              checked={value === option.value}
              onChange={() => value !== option.value && props.onCommit(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  } else {
    const display = dragValue === null ? shown : formatParamValue(def, dragValue);
    control = (
      <input
        ref={input}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        className={cn(INPUT, 'w-full font-mono tabular-nums', invalid && INVALID)}
        data-testid={props.fieldTestId}
        aria-label={def.label}
        aria-invalid={invalid}
        disabled={props.disabled}
        readOnly={!numeric}
        value={text ?? display}
        onChange={(event) => setText(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (settled.current) return;
          if (text !== null && !commitText(event.currentTarget.value)) setText(null);
        }}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <div
      className={cn(
        'grid min-w-0 items-center gap-1',
        props.stacked === true ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)]',
      )}
      data-param={def.name}
    >
      {label}
      {control}
    </div>
  );
}

// ---------- sections (§8.6: param groups) ----------

/** Fields grouped into sections by `ParamDef.group`: sections in order of first appearance, fields in list order. */
export function paramSections(
  params: readonly ParamDef[],
): readonly { readonly group: string | null; readonly params: readonly ParamDef[] }[] {
  const sections: { group: string | null; params: ParamDef[] }[] = [];
  for (const def of params) {
    const group = def.group ?? null;
    let section = sections.find((candidate) => candidate.group === group);
    if (section === undefined) {
      section = { group, params: [] };
      sections.push(section);
    }
    section.params.push(def);
  }
  return sections;
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * The fields of a card, an option box or an INPUTS entry with their param groups as sections (a header per group;
 * ungrouped fields have none). `testId` prefixes each section's `data-testid` (`<testId>-section-<group>`).
 */
export function ParamSections(props: {
  readonly params: readonly ParamDef[];
  readonly testId: string;
  readonly children: (def: ParamDef) => JSX.Element;
}): JSX.Element {
  return (
    <>
      {paramSections(props.params).map((section) =>
        section.group === null ? (
          <Fragment key="(ungrouped)">{section.params.map(props.children)}</Fragment>
        ) : (
          <fieldset
            key={section.group}
            className="m-0 flex min-w-0 flex-col gap-0.5 border-0 p-0"
            data-testid={`${props.testId}-section-${slug(section.group)}`}
          >
            <legend className="truncate p-0 pt-1 text-ui-dense text-fg-3">{section.group}</legend>
            {section.params.map(props.children)}
          </fieldset>
        ),
      )}
    </>
  );
}
