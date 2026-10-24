// The parts T6b's sheets share (STUDIO-TOUCH-SPEC §4.1, §6.3, §18; T6b): the docked sheet with its frame contract, a
// hook that re-renders on document, session and preference changes, field rows, and a parameter field at touch
// density (the option box's fields — numbers as scrub chips with the numpad, booleans as toggle chips, enums as
// segments). Lives with More, the first sheet; the other T6b sheets import it.
import type { ParamDef } from '@ekza-studio/anim-core';
import type { EditorApp } from '@ekza-studio/editor-core';
import { Numpad, Segmented, Sheet, SheetGroup, ToggleChip, TouchButton, ValueChip } from '@ekza-studio/ui/touch';
import { type JSX, type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { HaloSheetContext } from '../../manifest/sheets';
import type { SheetId } from '../../manifest/types';

export interface HaloSheetFrameProps {
  readonly ctx: HaloSheetContext;
  readonly id: SheetId;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly footer?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}

/** A docked sheet (§4.1: the canvas stays live; right edge on wide containers, bottom otherwise). */
export function HaloSheet({
  ctx,
  id,
  title,
  description,
  footer,
  actions,
  children,
}: HaloSheetFrameProps): JSX.Element {
  // A scrolling body must be reachable by keyboard (WCAG 2.1.1, axe `scrollable-region-focusable`) even when the
  // sheet holds no control (About of a character from a file). The kit's body has no tabindex yet (patch P-T6B-4).
  useEffect(() => {
    const body = document.querySelector<HTMLElement>(`[data-testid="halo-sheet-${id}"] [data-touch-scroll]`);
    if (body !== null && !body.hasAttribute('tabindex')) body.tabIndex = 0;
  }, [id]);
  return (
    <Sheet
      open
      modal={false}
      side={ctx.side}
      defaultDetent="half"
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(footer === undefined ? {} : { footer })}
      {...(actions === undefined ? {} : { actions })}
      onOpenChange={(open) => {
        if (!open) ctx.close();
      }}
      data-testid={`halo-sheet-${id}`}
    >
      {children}
    </Sheet>
  );
}

/** Re-renders on every document batch, session change and preference change; returns a version counter. */
export function useAppVersion(app: EditorApp): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const offs = [app.store.subscribe(() => notify()), app.session.subscribe(notify), app.prefs.subscribe(notify)];
      return () => {
        for (const off of offs) off();
      };
    },
    [app],
  );
  const get = useCallback(
    () => app.store.version * 1_000_003 + versionOf(app.session.getState()) + versionOf(app.prefs.getState()),
    [app],
  );
  return useSyncExternalStore(subscribe, get, get);
}

/** A cheap identity number of an immutable state object (changes when the object does). */
const ids = new WeakMap<object, number>();
let nextId = 1;
function versionOf(state: object): number {
  let id = ids.get(state);
  if (id === undefined) {
    id = nextId;
    nextId += 1;
    ids.set(state, id);
  }
  return id;
}

/** A labelled row: the plain label, the Pro name in grey and the control (§6.6: "Pro's channel name in grey"). */
export function FieldRow(props: {
  readonly label: ReactNode;
  readonly pro?: ReactNode;
  readonly children?: ReactNode;
  readonly testId?: string;
  /** Handlers on the label area only (a long-press menu), so a chip in the row keeps its own drag. */
  readonly labelHandlers?: Readonly<Record<string, unknown>>;
}): JSX.Element {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-2.5 py-1.5" data-testid={props.testId}>
      <span className="flex min-w-0 flex-1 flex-col" {...props.labelHandlers}>
        <span className="font-medium text-fg">{props.label}</span>
        {props.pro === undefined || props.pro === '' || props.pro === props.label ? null : (
          <span className="truncate text-touch-label text-fg-3">{props.pro}</span>
        )}
      </span>
      {props.children}
    </div>
  );
}

export { SheetGroup };

/** Shown values of a ParamDef: angles in degrees, fractions in percent, distances in metres. */
export function paramShown(param: ParamDef, stored: number): number {
  if (param.kind === 'angle') return (stored * 180) / Math.PI;
  if (param.kind === 'fraction') return stored * 100;
  return stored;
}

export function paramStored(param: ParamDef, shown: number): number {
  if (param.kind === 'angle') return (shown * Math.PI) / 180;
  if (param.kind === 'fraction') return shown / 100;
  if (param.kind === 'int') return Math.round(shown);
  return shown;
}

const UNIT: Partial<Record<ParamDef['kind'], string>> = { angle: '°', distance: ' m', fraction: '%' };

/** One ParamDef as a touch control (the option box and pre-run form fields at touch density, §6.3). */
export function ParamControl(props: {
  readonly param: ParamDef;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}): JSX.Element | null {
  const { param, value, onChange } = props;
  if (param.kind === 'bool') {
    return (
      <ToggleChip
        label={param.label}
        pressed={value === true}
        onPressedChange={(pressed) => onChange(pressed)}
        data-testid={`halo-param-${param.name}`}
      />
    );
  }
  if (param.kind === 'enum' || param.kind === 'axis') {
    const options = param.options ?? [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ];
    return (
      <Segmented<string>
        label={param.label}
        value={typeof value === 'string' ? value : typeof param.default === 'string' ? param.default : ''}
        onValueChange={(next) => onChange(next)}
        items={options.map((option) => ({ value: option.value, label: option.label }))}
        data-testid={`halo-param-${param.name}`}
      />
    );
  }
  if (param.kind === 'data') return null;
  const stored = typeof value === 'number' ? value : typeof param.default === 'number' ? param.default : 0;
  const step =
    param.kind === 'int' ? 1 : param.kind === 'angle' ? 1 : param.kind === 'fraction' ? 1 : (param.step ?? 0.01);
  const min = param.min === undefined ? undefined : paramShown(param, param.min);
  const max = param.max === undefined ? undefined : paramShown(param, param.max);
  const unit = UNIT[param.kind];
  return (
    <NumberControl
      label={param.label}
      value={paramShown(param, stored)}
      step={step}
      {...(unit === undefined ? {} : { unit })}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      onCommit={(shown) => onChange(paramStored(param, shown))}
      testId={`halo-param-${param.name}`}
    />
  );
}

/** A number as a scrub chip; a tap opens the numpad under it, in the sheet (§5.6). */
export function NumberControl(props: {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly proName?: string;
  readonly disabled?: boolean;
  readonly onCommit: (value: number) => void;
  readonly testId?: string;
}): JSX.Element {
  const [numpad, setNumpad] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const range = {
    ...(props.min === undefined ? {} : { min: props.min }),
    ...(props.max === undefined ? {} : { max: props.max }),
  };
  return (
    <span className="flex flex-col items-end gap-2">
      <ValueChip
        label={props.label}
        value={live ?? props.value}
        step={props.step}
        {...(props.unit === undefined ? {} : { unit: props.unit })}
        {...(props.proName === undefined ? {} : { proName: props.proName })}
        {...range}
        {...(props.disabled === true ? { disabled: true } : {})}
        onChange={setLive}
        onCommit={(value) => {
          setLive(null);
          props.onCommit(value);
        }}
        onOpenNumpad={() => setNumpad(true)}
        {...(props.testId === undefined ? {} : { 'data-testid': props.testId })}
      />
      {numpad ? (
        <Numpad
          label={props.label}
          value={props.value}
          {...(props.unit === undefined ? {} : { unit: props.unit.trim() })}
          {...(props.proName === undefined ? {} : { proName: props.proName })}
          {...range}
          onDone={(value) => {
            setNumpad(false);
            props.onCommit(value);
          }}
          onCancel={() => setNumpad(false)}
          {...(props.testId === undefined ? {} : { 'data-testid': `${props.testId}-numpad` })}
        />
      ) : null}
    </span>
  );
}

/** A footer button that opens the Pro layout (§6.3, §16). */
export function OpenInProButton(props: { readonly ctx: HaloSheetContext }): JSX.Element {
  return (
    <TouchButton className="flex-1" onClick={() => props.ctx.openPro()} data-testid="halo-open-pro">
      Open this in the Pro layout ▸
    </TouchButton>
  );
}
