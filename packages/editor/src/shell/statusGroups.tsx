// Status-line groups of the Model workspace (M6A-SPEC §8.2, §8.10; B9 the slots, B10/B12a the bodies): `Mode
// [Obj|Vtx|Edg|Face] │ Sym [Object X▾] │ Soft ○ 0.50 m │ Snap #X .V ~J │ Piv D`. Each slot carries its `data-testid`
// and a default body that reads the session and runs the owner's operator (disabled with the operator's reason until
// it lands); an owner replaces a body with `registerStatusGroup(id, Component)` (./statusGroupRegistry.ts). A lazy
// chunk: only Model draws these groups.
import {
  type ComponentMode,
  type EditorApp,
  PANEL,
  type RunContext,
  type SymmetryMode,
} from '@ekza-studio/editor-core';
import { NativeSelect, Toggle, ToggleGroup, ToggleGroupItem, Tooltip } from '@ekza-studio/ui';
import { type ComponentType, createElement, type JSX } from 'react';
import { useDocQuery, useSession } from '../hooks';
import { useShell } from './context';
import { shortcutFor } from './menus';
import { type StatusGroupProps, useStatusGroup } from './statusGroupRegistry';

/** The poll reason of an operator run from the status line, or null when it can run. */
function reasonOf(app: EditorApp, op: string, args?: unknown): string | null {
  const ctx: RunContext = { panel: PANEL.viewport };
  if (app.operators.get(op) === undefined) return `Unknown operator '${op}'`;
  const poll = app.operators.poll(op, ctx, args);
  return poll === true ? null : poll.reason;
}

const docVersion = (): number => 0;
const sameReasons = (a: readonly (string | null)[], b: readonly (string | null)[]): boolean =>
  a.length === b.length && a.every((reason, i) => reason === b[i]);

/**
 * The live poll reasons of status-line operator runs: re-read on every session change (selection, hilite, mode,
 * workspace) and every mesh or group write, so a control never keeps the enablement of an earlier render (a
 * Symmetry select disabled after a cube was created and selected; acceptance fix round 1).
 */
function useReasons(app: EditorApp, calls: readonly (readonly [string, unknown?])[]): readonly (string | null)[] {
  useDocQuery(docVersion, ['meshes', 'groups']);
  return useSession(() => calls.map(([op, args]) => reasonOf(app, op, args)), sameReasons);
}

function useReason(app: EditorApp, op: string, args?: unknown): string | null {
  return useReasons(app, [[op, args]])[0] ?? null;
}

function Tip(props: { readonly text: string; readonly children: JSX.Element }): JSX.Element {
  return <Tooltip content={props.text}>{props.children}</Tooltip>;
}

const MODES: readonly { readonly mode: ComponentMode; readonly short: string; readonly label: string }[] = [
  { mode: 'object', short: 'Obj', label: 'Object mode' },
  { mode: 'vertex', short: 'Vtx', label: 'Vertex mode' },
  { mode: 'edge', short: 'Edg', label: 'Edge mode' },
  { mode: 'face', short: 'Face', label: 'Face mode' },
];
const MODE_POLLS = MODES.map((entry) => ['select.mode', { mode: entry.mode }] as const);

function ModeBody(props: StatusGroupProps): JSX.Element {
  const mode = useSession((s) => s.model.componentMode);
  const reasons = useReasons(props.app, MODE_POLLS);
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(value) => {
        if (value !== '') props.run('select.mode', { mode: value });
      }}
    >
      {MODES.map((entry, i) => {
        const reason = reasons[i] ?? null;
        const key = shortcutFor(props.app.keymap, 'select.mode', { mode: entry.mode });
        const text = `${entry.label}${key === null ? '' : `  ${key}`}${reason === null ? '' : ` (${reason})`}`;
        return (
          <Tip key={entry.mode} text={text}>
            <ToggleGroupItem
              value={entry.mode}
              aria-label={entry.label}
              data-testid={`status-mode-${entry.mode}`}
              disabled={reason !== null && entry.mode !== mode}
            >
              <span className="text-ui">{entry.short}</span>
            </ToggleGroupItem>
          </Tip>
        );
      })}
    </ToggleGroup>
  );
}

const SYMMETRY: readonly { readonly value: SymmetryMode; readonly label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'object-x', label: 'Object X' },
  { value: 'object-y', label: 'Object Y' },
  { value: 'object-z', label: 'Object Z' },
  { value: 'world-x', label: 'World X' },
  { value: 'world-y', label: 'World Y' },
  { value: 'world-z', label: 'World Z' },
];
const SYMMETRY_POLL = { mode: 'object-x' } as const;

function SymmetryBody(props: StatusGroupProps): JSX.Element {
  // The lead hilited (else selected) mesh's remembered symmetry (§5.14; B12a owns the setting).
  const mode = useSession((s) => {
    const lead = s.model.hilite.at(-1) ?? s.selection.objects.at(-1);
    return lead === undefined ? 'off' : (s.model.symmetry.get(lead as never)?.mode ?? 'off');
  });
  const reason = useReason(props.app, 'model.symmetry.set', SYMMETRY_POLL);
  return (
    <Tip text={reason === null ? 'Symmetry' : `Symmetry (${reason})`}>
      <NativeSelect
        aria-label="Symmetry"
        data-testid="status-sym"
        className="h-6"
        value={mode}
        disabled={reason !== null}
        options={SYMMETRY}
        onChange={(event) => props.run('model.symmetry.set', { mode: event.target.value })}
      />
    </Tip>
  );
}

function SoftBody(props: StatusGroupProps): JSX.Element {
  const soft = useSession((s) => s.model.softSelect);
  const reason = useReason(props.app, 'model.softSelect.toggle');
  return (
    <Tip text={reason === null ? 'Soft selection  B' : `Soft selection (${reason})`}>
      <Toggle
        pressed={soft.on}
        aria-label="Soft selection"
        data-testid="status-soft"
        disabled={reason !== null}
        onPressedChange={() => props.run('model.softSelect.toggle')}
      >
        <span className="text-ui">
          Soft {soft.on ? '●' : '○'} {soft.radius.toFixed(2)} m
        </span>
      </Toggle>
    </Tip>
  );
}

const SNAPS: readonly {
  readonly kind: 'grid' | 'vertex' | 'increment';
  readonly short: string;
  readonly label: string;
}[] = [
  { kind: 'grid', short: '#X', label: 'Snap to grid (hold X)' },
  { kind: 'vertex', short: '.V', label: 'Snap to vertices (hold V)' },
  { kind: 'increment', short: '~J', label: 'Snap in increments (hold J)' },
];
const SNAP_POLLS = SNAPS.map((entry) => ['model.snap.toggle', { kind: entry.kind }] as const);

function SnapBody(props: StatusGroupProps): JSX.Element {
  const snap = useSession((s) => s.model.snap);
  const reasons = useReasons(props.app, SNAP_POLLS);
  return (
    <>
      {SNAPS.map((entry, i) => {
        const reason = reasons[i] ?? null;
        return (
          <Tip key={entry.kind} text={reason === null ? entry.label : `${entry.label} (${reason})`}>
            <Toggle
              pressed={snap[entry.kind]}
              aria-label={entry.label}
              data-testid={`status-snap-${entry.kind}`}
              disabled={reason !== null}
              onPressedChange={() => props.run('model.snap.toggle', { kind: entry.kind })}
            >
              <span className="text-ui">{entry.short}</span>
            </Toggle>
          </Tip>
        );
      })}
    </>
  );
}

function PivotBody(props: StatusGroupProps): JSX.Element {
  const on = useSession((s) => s.model.pivotEdit);
  const reason = useReason(props.app, 'model.pivot.editToggle');
  return (
    <Tip text={reason === null ? 'Edit pivot  D / Insert' : `Edit pivot (${reason})`}>
      <Toggle
        pressed={on}
        aria-label="Edit pivot"
        data-testid="status-pivot"
        disabled={reason !== null}
        onPressedChange={() => props.run('model.pivot.editToggle')}
      >
        <span className="text-ui">Piv</span>
      </Toggle>
    </Tip>
  );
}

/** Model's default group bodies (§8.2). */
export const MODEL_STATUS_BODIES: Readonly<Record<string, ComponentType<StatusGroupProps>>> = {
  mode: ModeBody,
  symmetry: SymmetryBody,
  soft: SoftBody,
  snap: SnapBody,
  pivot: PivotBody,
};

const GROUP_LABELS: Readonly<Record<string, string>> = {
  mode: 'Component mode',
  symmetry: 'Symmetry',
  soft: 'Soft selection',
  snap: 'Snapping',
  pivot: 'Pivot',
};

/** One Model group: the registered body, else the default one. */
export function ModelStatusGroup(props: { readonly id: string }): JSX.Element | null {
  const shell = useShell();
  const registered = useStatusGroup(props.id);
  const body = registered ?? MODEL_STATUS_BODIES[props.id];
  if (body === undefined) return null;
  const run = (op: string, args?: unknown): void => {
    void shell.runFromUi(op, args, { panel: PANEL.viewport, source: 'menu' });
  };
  return (
    <fieldset
      className="m-0 flex min-w-0 items-center gap-1 border-0 border-r border-line p-0 pr-2 last:border-r-0"
      aria-label={GROUP_LABELS[props.id] ?? props.id}
      data-testid={`status-group-${props.id}`}
    >
      {createElement(body, { app: shell.app, run })}
    </fieldset>
  );
}
