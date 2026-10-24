// The Channel Box of a mesh or group object in Model (M6A-SPEC §8.6; B11), a lazy chunk the Channel Box loads when
// the lead selected object is a mesh or a group: the DCC layout — the object's Translate/Rotate/Scale rows (editing
// `placement` through `scene.object.transform`, every selected object gets the typed channel), SHAPES (the mesh) and
// INPUTS with up to two entries:
// - the **primitive entry** while the mesh's `generator` is live ("cylinder (primitive)", the DCC's `polyCylinder1`):
//   the §6.3 fields of its kind, persistent across selection changes; an edit right after the creation run is an
//   `edit.adjustLast` of `mesh.create.<kind>` (the id and the step stay), later ones run `mesh.primitive.set`;
// - the **last-op entry** ("extrude (last operation)") with the Last-op card's fields while `lastRun` is live and
//   targets this mesh (only the primitive entry when the last operation is the mesh's creation or a primitive edit).
// Selecting a field name makes the viewport MMB-drag run its virtual slider (§5.15; B12a reads `selectedInputsField`).
import {
  eulerToQuat,
  type ParamDef,
  type ParamValue,
  type ParamValues,
  quatToEuler,
  RAD2DEG,
  DEG2RAD,
  type ReadonlyXf,
} from '@ekza-studio/anim-core';
import type { DocumentStore, GroupRecord, MeshId, MeshRecord } from '@ekza-studio/doc';
import {
  type EditorApp,
  type LastRun,
  parseNumericInput,
  type RunContext,
  type SceneObjectId,
  selectedInputsField,
  selectInputsField,
  subscribeInputsField,
  visibleParams,
} from '@ekza-studio/editor-core';
import { PRIMITIVE_PARAMS } from '@ekza-studio/mesh-core/descriptors';
import type { PrimitiveKind } from '@ekza-studio/mesh-core';
import { cn } from '@ekza-studio/ui';
import { type JSX, type KeyboardEvent, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useDocQuery, useSession } from '../../hooks';
import { useOptionalShell } from '../../shell/context';
import { ParamField, ParamSections } from '../toolkit/ParamField';
import { INPUT, MUTED_TEXT, PANEL_ROOT, ROW_HOVER } from './kit/styles';

const CHANNELS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const;
type ObjectChannel = (typeof CHANNELS)[number];

const LABEL: Readonly<Record<ObjectChannel, string>> = {
  tx: 'Translate X',
  ty: 'Translate Y',
  tz: 'Translate Z',
  rx: 'Rotate X',
  ry: 'Rotate Y',
  rz: 'Rotate Z',
  sx: 'Scale X',
  sy: 'Scale Y',
  sz: 'Scale Z',
};

const AXIS = { x: 0, y: 1, z: 2 } as const;
const CTX: RunContext = { source: 'card', panel: 'channelBox' };

type ObjectRecord = MeshRecord | GroupRecord;

/** A channel of a placement in display units (metres, degrees, plain scale). */
export function channelOf(placement: ReadonlyXf, channel: ObjectChannel): number {
  const axis = AXIS[channel[1] as 'x' | 'y' | 'z'];
  if (channel[0] === 't') return placement.t[axis] ?? 0;
  if (channel[0] === 's') return placement.s[axis] ?? 1;
  return (quatToEuler(placement.q, 'xyz')[axis] ?? 0) * RAD2DEG;
}

/** The placement with one channel set (display units in). */
export function withChannel(placement: ReadonlyXf, channel: ObjectChannel, display: number): ReadonlyXf {
  const axis = AXIS[channel[1] as 'x' | 'y' | 'z'];
  if (channel[0] === 't') {
    const t: [number, number, number] = [placement.t[0], placement.t[1], placement.t[2]];
    t[axis] = display;
    return { ...placement, t };
  }
  if (channel[0] === 's') {
    const s: [number, number, number] = [placement.s[0], placement.s[1], placement.s[2]];
    s[axis] = display;
    return { ...placement, s };
  }
  const euler = quatToEuler(placement.q, 'xyz');
  euler[axis] = display * DEG2RAD;
  return { ...placement, q: eulerToQuat(euler, 'xyz') };
}

const fixed3 = (value: number): string => {
  const text = value.toFixed(3);
  return /^-0\.0+$/.test(text) ? text.slice(1) : text;
};

function objectOf(store: DocumentStore, id: SceneObjectId): ObjectRecord | null {
  if (id.startsWith('msh_')) return store.get('meshes', id as MeshId) ?? null;
  if (id.startsWith('grp_')) return store.get('groups', id as GroupRecord['id']) ?? null;
  return null;
}

function useRun(app: EditorApp): (op: string, args: unknown) => void {
  const shell = useOptionalShell();
  return (op, args) => {
    if (shell !== null) void shell.runFromUi(op, args, CTX);
    else void app.runUntyped(op, args, CTX);
  };
}

function TrsRow(props: {
  readonly channel: ObjectChannel;
  readonly value: number;
  readonly onCommit: (channel: ObjectChannel, text: string) => string | null;
}): JSX.Element {
  const { channel, value } = props;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = fixed3(value);
  /** Set while Enter or Esc blurs the input: that blur's handler (it still sees the draft) commits nothing. */
  const settled = useRef(false);
  const commit = (raw: string): boolean => {
    if (raw === shown) {
      setText(null);
      return true;
    }
    const problem = props.onCommit(channel, raw);
    setError(problem);
    if (problem === null) setText(null);
    return problem === null;
  };
  /** Enter (accepted) and Esc give the keyboard back to the editor: the hovered pane's hotkeys work again. */
  const release = (element: HTMLInputElement): void => {
    if (element.ownerDocument.activeElement !== element) return;
    settled.current = true;
    try {
      element.blur();
    } finally {
      settled.current = false;
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commit(event.currentTarget.value)) release(event.currentTarget);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setText(null);
      setError(null);
      release(event.currentTarget);
    }
  };
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)_minmax(0,7.5rem)] items-center gap-1 px-1', ROW_HOVER)}>
      <span className="truncate text-fg-2" data-testid={`cb-name-${channel}`}>
        {LABEL[channel]}
      </span>
      <input
        type="text"
        inputMode="decimal"
        spellCheck={false}
        className={cn(
          INPUT,
          'w-full text-right font-mono tabular-nums',
          error !== null && 'border-[var(--danger,#ef6b6b)]',
        )}
        data-testid={`cb-field-${channel}`}
        aria-label={LABEL[channel]}
        title={error ?? undefined}
        value={text ?? shown}
        onChange={(event) => setText(event.currentTarget.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          if (!settled.current && text !== null) commit(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function InputsEntry(props: {
  readonly app: EditorApp;
  readonly title: string;
  readonly testId: string;
  readonly prefix: 'cb-prim' | 'cb-inputs';
  readonly entry: 'lastop' | 'primitive';
  readonly mesh: MeshId;
  readonly params: readonly ParamDef[];
  readonly values: ParamValues;
  readonly onCommit: (name: string, value: ParamValue) => void;
}): JSX.Element {
  const { app, prefix } = props;
  const selected = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeInputsField(app, listener), [app]),
    () => selectedInputsField(app),
  );
  return (
    <div className="flex flex-col gap-0.5 px-1" data-testid={props.testId}>
      <div className="truncate font-semibold text-fg-2" data-testid={`${props.testId}-title`}>
        {props.title}
      </div>
      <ParamSections params={props.params} testId={prefix}>
        {(def) => (
          <ParamField
            key={def.name}
            app={app}
            def={def}
            value={props.values[def.name] ?? def.default}
            fieldTestId={`${prefix}-field-${def.name}`}
            nameTestId={`${prefix}-name-${def.name}`}
            nameSelected={
              selected !== null &&
              selected.entry === props.entry &&
              selected.mesh === props.mesh &&
              selected.param === def.name
            }
            onName={() => selectInputsField(app, { entry: props.entry, mesh: props.mesh, param: def.name })}
            onCommit={(value) => props.onCommit(def.name, value)}
          />
        )}
      </ParamSections>
    </div>
  );
}

/** Whether the last operation is this mesh's own creation or primitive edit (only the primitive entry shows). */
function isPrimitiveRun(last: LastRun, mesh: MeshId): boolean {
  return (last.id.startsWith('mesh.create.') || last.id === 'mesh.primitive.set') && last.targets.includes(mesh);
}

export default function MeshChannels(props: { readonly app: EditorApp; readonly lead: SceneObjectId }): JSX.Element {
  const { app, lead } = props;
  const run = useRun(app);
  const objects = useSession((s) => s.selection.objects);
  const lastRun = useSession((s) => s.lastRun);
  const read = useCallback((store: DocumentStore) => objectOf(store, lead), [lead]);
  const record = useDocQuery(read, ['meshes', 'groups']);

  if (record === null) {
    return (
      <div className={PANEL_ROOT} data-testid="channel-box-panel">
        <div className="grid flex-1 place-items-center p-4 text-center text-fg-3">The object no longer exists.</div>
      </div>
    );
  }

  const commitChannel = (channel: ObjectChannel, text: string): string | null => {
    const ids = objects.filter((id) => id.startsWith('msh_') || id.startsWith('grp_'));
    const targets = ids.includes(lead) ? ids : [lead];
    const placements: ReadonlyXf[] = [];
    for (const id of targets) {
      const object = objectOf(app.store, id);
      if (object === null) continue;
      const next = parseNumericInput(text, channelOf(object.placement, channel));
      if (next === null) return `'${text}' is not a number or expression`;
      placements.push(withChannel(object.placement, channel, next));
    }
    run('scene.object.transform', { ids: targets, placements });
    return null;
  };

  const mesh = lead.startsWith('msh_') ? (record as MeshRecord) : null;
  const generator = mesh?.generator ?? null;
  const live = lastRun !== null && lastRun.closed === null ? lastRun : null;
  const kind: PrimitiveKind | undefined = generator?.kind;
  const primitiveParams = kind === undefined ? [] : visibleParams(PRIMITIVE_PARAMS[kind] ?? []);
  const lastOpParams =
    mesh !== null && live !== null && live.targets.includes(mesh.id) && !isPrimitiveRun(live, mesh.id)
      ? visibleParams(live.params)
      : [];

  const commitPrimitive = (name: string, value: ParamValue): void => {
    if (mesh === null || generator === null) return;
    if (live !== null && live.id === `mesh.create.${generator.kind}` && live.targets[0] === mesh.id) {
      run('edit.adjustLast', { args: { [name]: value } });
      return;
    }
    run('mesh.primitive.set', { mesh: mesh.id, params: { ...generator.params, [name]: value } });
  };

  return (
    <div className={PANEL_ROOT} data-testid="channel-box-panel">
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-header px-2">
        <span className="truncate font-semibold" data-testid="cb-lead-name">
          {record.name}
        </span>
        {objects.length > 1 ? (
          <span className={MUTED_TEXT} title={`${objects.length - 1} more selected: edits apply to all`}>
            +{objects.length - 1}
          </span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto py-1" data-testid="cb-object-rows">
        {CHANNELS.map((channel) => (
          <TrsRow
            key={channel}
            channel={channel}
            value={channelOf(record.placement, channel)}
            onCommit={commitChannel}
          />
        ))}
        {mesh === null ? null : (
          <>
            <div className="mt-1 border-t border-line px-1 pt-1 font-semibold text-fg-3">SHAPES</div>
            <div className="truncate px-1 text-fg-2" data-testid="cb-shape">
              {mesh.name}Shape
            </div>
            {/* §8.10 `cb-inputs` is the INPUTS section: its header and both entries (M6A-INT-7). */}
            <section className="flex flex-col gap-1" data-testid="cb-inputs" aria-label="Inputs">
              <div className="mt-1 border-t border-line px-1 pt-1 font-semibold text-fg-3">INPUTS</div>
              {generator !== null && kind !== undefined ? (
                <InputsEntry
                  app={app}
                  title={`${kind} (primitive)`}
                  testId="cb-prim"
                  prefix="cb-prim"
                  entry="primitive"
                  mesh={mesh.id}
                  params={primitiveParams}
                  values={generator.params}
                  onCommit={commitPrimitive}
                />
              ) : null}
              {lastOpParams.length > 0 && live !== null ? (
                <InputsEntry
                  app={app}
                  title={`${live.label.toLowerCase()} (last operation)`}
                  testId="cb-lastop"
                  prefix="cb-inputs"
                  entry="lastop"
                  mesh={mesh.id}
                  params={lastOpParams}
                  values={live.args}
                  onCommit={(name, value) => run('edit.adjustLast', { args: { [name]: value } })}
                />
              ) : null}
              {generator === null && lastOpParams.length === 0 ? (
                <div className={cn('px-1', MUTED_TEXT)}>No inputs</div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
