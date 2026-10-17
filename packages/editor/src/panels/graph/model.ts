// Pure state of the Graph Editor panel: which controls and curves it lists and shows, the numeric fields of the
// selected keys and the toolbar's toggle states. Everything is derived from the document and the session.
import { type Fps, type InfinityMode, tangentFields } from '@ekza-animator/anim-core';
import { type ChannelTreeNode, channelDisplayScale, channelNodes } from '@ekza-animator/curve-editor';
import type {
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  CurveRecord,
  DocumentStore,
  KeyId,
  KeyRecord,
} from '@ekza-animator/doc';
import {
  type ChannelRef,
  type EditorApp,
  type KeyFieldsArgs,
  type KeyPartSelection,
  parseNumericInput,
} from '@ekza-animator/editor-core';

function characterOfControl(store: DocumentStore, control: ControlId): CharacterId | null {
  const record = store.get('controls', control);
  const rig = record === undefined ? undefined : store.get('rigs', record.rig);
  return rig?.character ?? null;
}

/** What the channel list follows: the active character and clip and the selected controls. */
export interface ListContext {
  readonly character: CharacterId | null;
  readonly clip: ClipId | null;
  readonly selectedControls: readonly ControlId[];
}

/**
 * Controls the channel list shows: the selected controls of the active character (Maya "auto load selected"), or,
 * with nothing selected, every control of the active character with a keyed curve in the active clip.
 */
export function listedControls(store: DocumentStore, context: ListContext): ControlId[] {
  const { character, clip } = context;
  if (character === null) return [];
  const selected = context.selectedControls.filter((control) => characterOfControl(store, control) === character);
  if (selected.length > 0) return selected;
  const rig = store.query.rigOfCharacter(character);
  if (clip === null || rig === undefined || store.get('clips', clip) === undefined) return [];
  const animated = new Set<ControlId>();
  for (const curve of store.query.curvesOfClip(clip)) {
    if (store.query.keysOfCurve(curve.id).length > 0) animated.add(curve.control);
  }
  return store.query
    .controlsOfRig(rig.id)
    .filter((control) => animated.has(control.id))
    .map((control) => control.id);
}

const sameRef = (node: ChannelTreeNode, ref: ChannelRef): boolean =>
  node.control === ref.control && node.channel === ref.channel;

/**
 * Curves to draw: the channels selected in the list (or in the Channel Box) when any of them is listed, else every
 * listed channel with a curve; channels whose eye is off are left out.
 */
export function visibleCurves(
  tree: readonly ChannelTreeNode[],
  channelSelection: readonly ChannelRef[],
  hidden: ReadonlySet<string>,
): CurveId[] {
  const withCurves = channelNodes(tree).filter((node) => node.curve !== undefined);
  const selected = withCurves.filter((node) => channelSelection.some((ref) => sameRef(node, ref)));
  const shown = selected.length > 0 ? selected : withCurves;
  return shown.filter((node) => !hidden.has(node.id)).map((node) => node.curve as CurveId);
}

/** True when two channel trees show the same rows (ids, labels, curves, colours, structure). */
export function sameTree(a: readonly ChannelTreeNode[], b: readonly ChannelTreeNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as ChannelTreeNode;
    const y = b[i] as ChannelTreeNode;
    if (
      x.id !== y.id ||
      x.kind !== y.kind ||
      x.label !== y.label ||
      x.curve !== y.curve ||
      x.color !== y.color ||
      x.control !== y.control ||
      x.channel !== y.channel ||
      !sameTree(x.children, y.children)
    ) {
      return false;
    }
  }
  return true;
}

export interface ChannelRow {
  readonly node: ChannelTreeNode;
  readonly depth: number;
  readonly expanded: boolean;
}

/** Depth-first rows of the channel tree; collapsed nodes hide their children. */
export function flattenRows(tree: readonly ChannelTreeNode[], collapsed: ReadonlySet<string>): ChannelRow[] {
  const rows: ChannelRow[] = [];
  const visit = (node: ChannelTreeNode, depth: number): void => {
    const expanded = !collapsed.has(node.id);
    rows.push({ node, depth, expanded });
    if (expanded) for (const child of node.children) visit(child, depth + 1);
  };
  for (const node of tree) visit(node, 0);
  return rows;
}

/** The channel refs a channel-list row stands for (a control row: its channels with curves). */
export function rowRefs(node: ChannelTreeNode): ChannelRef[] {
  if (node.kind === 'channel' && node.control !== undefined && node.channel !== undefined) {
    return [{ control: node.control, channel: node.channel }];
  }
  return channelNodes([node]).flatMap((child) =>
    child.control !== undefined && child.channel !== undefined && child.curve !== undefined
      ? [{ control: child.control, channel: child.channel }]
      : [],
  );
}

/** Channel selection after a click with Maya modifiers (replace, toggle, remove, add). */
export function applyChannelSelection(
  current: readonly ChannelRef[],
  refs: readonly ChannelRef[],
  mode: 'replace' | 'toggle' | 'add' | 'remove',
): ChannelRef[] {
  const has = (list: readonly ChannelRef[], ref: ChannelRef) =>
    list.some((other) => other.control === ref.control && other.channel === ref.channel);
  switch (mode) {
    case 'replace':
      return [...refs];
    case 'add':
      return [...current, ...refs.filter((ref) => !has(current, ref))];
    case 'remove':
      return current.filter((ref) => !has(refs, ref));
    case 'toggle': {
      const all = refs.length > 0 && refs.every((ref) => has(current, ref));
      return all ? current.filter((ref) => !has(refs, ref)) : [...current, ...refs.filter((ref) => !has(current, ref))];
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Selected keys, numeric fields and toolbar states

export interface SelectedKey {
  readonly key: KeyRecord;
  readonly curve: CurveRecord;
  readonly parts: KeyPartSelection;
  readonly scale: number;
  readonly fps: Fps;
}

export function selectedKeys(store: DocumentStore, selection: ReadonlyMap<KeyId, KeyPartSelection>): SelectedKey[] {
  const out: SelectedKey[] = [];
  for (const [id, parts] of selection) {
    if (!parts.key && !parts.in && !parts.out) continue;
    const key = store.get('keys', id);
    const curve = key === undefined ? undefined : store.get('curves', key.curve);
    const clip = key === undefined ? undefined : store.get('clips', key.clip);
    if (key === undefined || curve === undefined || clip === undefined) continue;
    out.push({ key, curve, parts, scale: channelDisplayScale(curve.channel), fps: clip.fps });
  }
  return out;
}

/** Common value of a list within 1e-9 (relative), null when mixed or empty. */
export function common(values: readonly number[]): number | null {
  const first = values[0];
  if (first === undefined) return null;
  const tolerance = 1e-9 * Math.max(1, Math.abs(first));
  return values.every((value) => Math.abs(value - first) <= tolerance) ? first : null;
}

export interface FrameValueFields {
  readonly count: number;
  readonly frame: number | null;
  readonly value: number | null;
}

/** Frame and display value of the selected keys (null = mixed). */
export function frameValueFields(keys: readonly SelectedKey[]): FrameValueFields {
  return {
    count: keys.length,
    frame: common(keys.map((k) => k.key.t)),
    value: common(keys.map((k) => k.key.v * k.scale)),
  };
}

export interface TangentFieldValues {
  readonly inAngle: number | null;
  readonly outAngle: number | null;
  readonly inWeight: number | null;
  readonly outWeight: number | null;
  /** Weight fields apply only when every selected key's curve is weighted. */
  readonly weighted: boolean;
}

/**
 * In/out angle and weight of the selected keys in Maya's convention (MVP-SPEC §4.11.4 `tangentFields`), from the
 * resolved handles of the compiled curves.
 */
export function tangentFieldValues(app: EditorApp, keys: readonly SelectedKey[]): TangentFieldValues {
  const inAngles: number[] = [];
  const outAngles: number[] = [];
  const inWeights: number[] = [];
  const outWeights: number[] = [];
  for (const k of keys) {
    const compiled = app.evaluation.compiledCurve(k.curve.id);
    const index = app.store.query.keysOfCurve(k.curve.id).findIndex((other) => other.id === k.key.id);
    if (index === -1 || index >= compiled.keyCount) continue;
    const inHandle = { dt: compiled.inDt[index] as number, dv: compiled.inDv[index] as number };
    const outHandle = { dt: compiled.outDt[index] as number, dv: compiled.outDv[index] as number };
    const inFields = tangentFields(inHandle, 'in', k.fps, k.scale);
    const outFields = tangentFields(outHandle, 'out', k.fps, k.scale);
    inAngles.push(inFields.angleDeg);
    outAngles.push(outFields.angleDeg);
    inWeights.push(inFields.weight);
    outWeights.push(outFields.weight);
  }
  const weighted = keys.length > 0 && keys.every((k) => k.curve.weighted);
  return {
    inAngle: common(inAngles),
    outAngle: common(outAngles),
    inWeight: weighted ? common(inWeights) : null,
    outWeight: weighted ? common(outWeights) : null,
    weighted,
  };
}

export type KeyField = 'frame' | 'value' | 'inAngleDeg' | 'outAngleDeg' | 'inWeight' | 'outWeight';

const RELATIVE = /^\s*([+-])=\s*(.+)$/;

/**
 * `graph.keys.setFields` arguments for typed text (research 09 §6.4 grammar via `parseNumericInput`). With a common
 * current value the expression is evaluated against it; with mixed values `+=`/`-=` apply relatively to every key
 * and a plain value sets them all. Null when the text is not a valid expression.
 */
export function fieldArgs(field: KeyField, text: string, current: number | null): KeyFieldsArgs | null {
  if (text.trim() === '') return null;
  if (current !== null) {
    const value = parseNumericInput(text, current);
    return value === null || !Number.isFinite(value) ? null : { [field]: value };
  }
  const relative = RELATIVE.exec(text);
  if (relative !== null) {
    const amount = parseNumericInput(relative[2] as string, 0);
    if (amount === null || !Number.isFinite(amount)) return null;
    return { [field]: relative[1] === '-' ? -amount : amount, relative: true };
  }
  const value = parseNumericInput(text, 0);
  return value === null || !Number.isFinite(value) ? null : { [field]: value };
}

/** Text of a field: three decimals (frames without decimals when whole), '' when mixed. */
export function formatField(value: number | null, field: KeyField): string {
  if (value === null) return '';
  if (field === 'frame' && Number.isInteger(value)) return String(value);
  const text = value.toFixed(3);
  return text === '-0.000' ? '0.000' : text;
}

export interface ToolbarState {
  /** Curves the curve-level buttons act on: curves of selected keys, else of selected channels, else visible. */
  readonly curves: readonly CurveRecord[];
  readonly hasKeys: boolean;
  readonly weighted: boolean | null;
  readonly weightLocked: boolean | null;
  readonly pre: InfinityMode | null;
  readonly post: InfinityMode | null;
}

const commonOf = <T>(values: readonly T[]): T | null =>
  values.length > 0 && values.every((value) => value === values[0]) ? (values[0] as T) : null;

export function toolbarState(
  store: DocumentStore,
  keys: readonly SelectedKey[],
  channelSelection: readonly ChannelRef[],
  visible: readonly CurveId[],
): ToolbarState {
  const visibleRecords = visible.flatMap((id) => {
    const curve = store.get('curves', id);
    return curve === undefined ? [] : [curve];
  });
  const fromKeys = [...new Map(keys.map((k) => [k.curve.id, k.curve])).values()];
  const fromChannels = visibleRecords.filter((curve) =>
    channelSelection.some((ref) => ref.control === curve.control && ref.channel === curve.channel),
  );
  const curves = fromKeys.length > 0 ? fromKeys : fromChannels.length > 0 ? fromChannels : visibleRecords;
  return {
    curves,
    hasKeys: keys.length > 0,
    weighted: commonOf(curves.map((curve) => curve.weighted)),
    weightLocked: commonOf(keys.map((k) => k.key.weightLocked)),
    pre: commonOf(curves.map((curve) => curve.pre)),
    post: commonOf(curves.map((curve) => curve.post)),
  };
}
