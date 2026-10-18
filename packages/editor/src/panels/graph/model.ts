// Pure state of the Graph Editor panel: which controls and curves it lists and shows, the numeric fields of the
// selected keys and the toolbar's toggle states. Everything is derived from the document and the session.
import { EkzaError, type Fps, type InfinityMode, tangentFields } from '@ekza-animator/anim-core';
import { type ChannelTreeNode, channelDisplayScale, channelNodes } from '@ekza-animator/curve-editor';
import type {
  CharacterId,
  ClipId,
  ControlId,
  CurveId,
  CurveRecord,
  DocQueries,
  DocumentStore,
  KeyId,
  KeyRecord,
} from '@ekza-animator/doc';
import {
  type ChannelRef,
  channelUnit,
  type EvaluationService,
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
  // The channel's display unit (M2A-SPEC §5.1 rule 5): angle attributes show degrees like rotations and the canvas.
  // One control lookup per curve, not per key.
  const scales = new Map<CurveId, number>();
  for (const [id, parts] of selection) {
    if (!parts.key && !parts.in && !parts.out) continue;
    const key = store.get('keys', id);
    const curve = key === undefined ? undefined : store.get('curves', key.curve);
    const clip = key === undefined ? undefined : store.get('clips', key.clip);
    if (key === undefined || curve === undefined || clip === undefined) continue;
    let scale = scales.get(curve.id);
    if (scale === undefined) {
      scale = channelDisplayScale(
        curve.channel,
        channelUnit(store.get('controls', curve.control) ?? null, curve.channel),
      );
      scales.set(curve.id, scale);
    }
    out.push({ key, curve, parts, scale, fps: clip.fps });
  }
  return out;
}

/**
 * Running common value within 1e-9 (relative to the first value): null once two values differ, when a value is not
 * finite (nothing to show), or when empty.
 */
class CommonValue {
  private first: number | null = null;
  mixed = false;

  add(value: number): void {
    if (this.mixed) return;
    if (!Number.isFinite(value)) this.mixed = true;
    else if (this.first === null) this.first = value;
    else if (!(Math.abs(value - this.first) <= 1e-9 * Math.max(1, Math.abs(this.first)))) this.mixed = true;
  }

  get value(): number | null {
    return this.mixed ? null : this.first;
  }
}

/** Common value of a list within 1e-9 (relative), null when mixed or empty. */
export function common(values: readonly number[]): number | null {
  const acc = new CommonValue();
  for (const value of values) {
    acc.add(value);
    if (acc.mixed) break;
  }
  return acc.value;
}

export interface FrameValueFields {
  readonly count: number;
  readonly frame: number | null;
  readonly value: number | null;
}

/** Frame and display value of the selected keys (null = mixed). */
export function frameValueFields(keys: readonly SelectedKey[]): FrameValueFields {
  const frame = new CommonValue();
  const value = new CommonValue();
  for (const k of keys) {
    frame.add(k.key.t);
    value.add(k.key.v * k.scale);
    if (frame.mixed && value.mixed) break;
  }
  return { count: keys.length, frame: frame.value, value: value.value };
}

export interface TangentFieldValues {
  readonly inAngle: number | null;
  readonly outAngle: number | null;
  readonly inWeight: number | null;
  readonly outWeight: number | null;
  /** Weight fields apply only when every selected key's curve is weighted. */
  readonly weighted: boolean;
}

/** What `tangentFieldValues` reads: the curves' sorted keys and their compiled (resolved) handles. */
export interface TangentFieldSource {
  readonly store: { readonly query: Pick<DocQueries, 'keysOfCurve' | 'curveFor'> };
  readonly evaluation: Pick<EvaluationService, 'compiledCurve'>;
}

/** Index of `key` in a curve's keys (sorted by t, unique t per MVP-SPEC §4.2); -1 for a hidden duplicate. */
function indexOfKey(sorted: readonly KeyRecord[], key: KeyRecord): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as KeyRecord).t < key.t) lo = mid + 1;
    else hi = mid;
  }
  return sorted[lo]?.id === key.id ? lo : -1;
}

/**
 * In/out angle and weight of the selected keys in Maya's convention (MVP-SPEC §4.11.4 `tangentFields`), from the
 * resolved handles of the compiled curves. Linear in the selection: keys are grouped by curve, each curve is read
 * once and every key is found by binary search; the scan stops as soon as every shown field is mixed.
 */
export function tangentFieldValues(
  source: TangentFieldSource,
  keys: readonly SelectedKey[],
  fieldsOf: typeof tangentFields = tangentFields,
): TangentFieldValues {
  const weighted = keys.length > 0 && keys.every((k) => k.curve.weighted);
  const inAngle = new CommonValue();
  const outAngle = new CommonValue();
  const inWeight = new CommonValue();
  const outWeight = new CommonValue();
  const allMixed = (): boolean => inAngle.mixed && outAngle.mixed && (!weighted || (inWeight.mixed && outWeight.mixed));

  const byCurve = new Map<CurveId, SelectedKey[]>();
  for (const k of keys) {
    const group = byCurve.get(k.curve.id);
    if (group === undefined) byCurve.set(k.curve.id, [k]);
    else group.push(k);
  }
  for (const [id, group] of byCurve) {
    const { clip, layer, control, channel } = (group[0] as SelectedKey).curve;
    // Duplicate curves of a channel are read through the canonical one, which unions their keys (§4.2).
    const canonical = source.store.query.curveFor(clip, layer, control, channel)?.id ?? id;
    const compiled = source.evaluation.compiledCurve(canonical);
    const sorted = source.store.query.keysOfCurve(canonical);
    // Compiled arrays and records must align index by index; a stale compiled curve is skipped.
    if (sorted.length !== compiled.keyCount) continue;
    for (const k of group) {
      const index = indexOfKey(sorted, k.key);
      if (index === -1) continue;
      const inFields = fieldsOf(
        { dt: compiled.inDt[index] as number, dv: compiled.inDv[index] as number },
        'in',
        k.fps,
        k.scale,
      );
      const outFields = fieldsOf(
        { dt: compiled.outDt[index] as number, dv: compiled.outDv[index] as number },
        'out',
        k.fps,
        k.scale,
      );
      inAngle.add(inFields.angleDeg);
      outAngle.add(outFields.angleDeg);
      if (weighted) {
        inWeight.add(inFields.weight);
        outWeight.add(outFields.weight);
      }
      if (allMixed()) return { inAngle: null, outAngle: null, inWeight: null, outWeight: null, weighted };
    }
  }
  return {
    inAngle: inAngle.value,
    outAngle: outAngle.value,
    inWeight: weighted ? inWeight.value : null,
    outWeight: weighted ? outWeight.value : null,
    weighted,
  };
}

const NO_TANGENT_FIELDS: TangentFieldValues = {
  inAngle: null,
  outAngle: null,
  inWeight: null,
  outWeight: null,
  weighted: false,
};

/** Everything the numeric fields show, small enough to hand to components (not the selected keys themselves). */
export interface KeyFieldValues extends FrameValueFields {
  /** Null when the curve engine cannot resolve the handles (WP-1 not landed, or it failed): the fields hide. */
  readonly tangent: TangentFieldValues | null;
}

/**
 * Field values of the selected keys. A failure of the curve engine only takes the angle and weight fields away
 * (logged unless the engine is not implemented yet); frame and value stay usable.
 */
export function keyFieldValues(
  source: TangentFieldSource,
  keys: readonly SelectedKey[],
  fieldsOf: typeof tangentFields = tangentFields,
): KeyFieldValues {
  const base = frameValueFields(keys);
  if (keys.length === 0) return { ...base, tangent: NO_TANGENT_FIELDS };
  let tangent: TangentFieldValues | null;
  try {
    tangent = tangentFieldValues(source, keys, fieldsOf);
  } catch (error) {
    if (!(error instanceof EkzaError && error.code === 'not-implemented')) {
      console.warn('Graph Editor: tangent fields unavailable:', error);
    }
    tangent = null;
  }
  return { ...base, tangent };
}

export type KeyField = 'frame' | 'value' | 'inAngleDeg' | 'outAngleDeg' | 'inWeight' | 'outWeight';

/** Parsed field text: the `graph.keys.setFields` arguments, or why the text cannot be applied. */
export type FieldInput =
  | { readonly ok: true; readonly args: KeyFieldsArgs }
  | { readonly ok: false; readonly error: string };

const RELATIVE = /^([+-])=\s*(.*)$/;
const MULTIPLICATIVE = /^[*/]/;
/** An operator left at the start of a relative operand (`+=*2`, `-=+=1`). */
const OPERATOR_AT_START = /^(?:[*/]|[+-]=)/;

export const FIELD_HINT = 'Not a number or expression (e.g. 30, +=10, *2, 90deg)';
export const MIXED_FIELD_HINT = 'Not a number or relative change (e.g. 30, +=10, -=5)';
export const MIXED_SCALE_ERROR = '× and ÷ need a common value: the selected keys differ (use += or -=)';

const invalid = (error: string): FieldInput => ({ ok: false, error });

/**
 * `graph.keys.setFields` arguments for typed text (research 09 §6.4 grammar, evaluated by `parseNumericInput`; a
 * leading `=` is accepted). With a common current value the expression is evaluated against it. With mixed values
 * `+=`/`-=` apply relatively to every key (`relative: true`) and a plain value sets them all; `*`, `/`, `*=` and `/=`
 * are refused, since `KeyFieldsArgs` has no per-key scale and evaluating against 0 would zero every key.
 */
export function fieldArgs(field: KeyField, text: string, current: number | null): FieldInput {
  let source = text.trim();
  if (source.startsWith('=')) source = source.slice(1).trim();
  if (source === '') return invalid(current === null ? MIXED_FIELD_HINT : FIELD_HINT);
  if (current !== null) {
    const value = parseNumericInput(source, current);
    return value === null || !Number.isFinite(value) ? invalid(FIELD_HINT) : { ok: true, args: { [field]: value } };
  }
  if (MULTIPLICATIVE.test(source)) return invalid(MIXED_SCALE_ERROR);
  const relative = RELATIVE.exec(source);
  if (relative !== null) {
    const operand = (relative[2] as string).trim();
    if (OPERATOR_AT_START.test(operand)) return invalid(MIXED_FIELD_HINT);
    const amount = operand === '' ? null : parseNumericInput(operand, 0);
    if (amount === null || !Number.isFinite(amount)) return invalid(MIXED_FIELD_HINT);
    return { ok: true, args: { [field]: relative[1] === '-' ? -amount : amount, relative: true } };
  }
  const value = parseNumericInput(source, 0);
  return value === null || !Number.isFinite(value) ? invalid(MIXED_FIELD_HINT) : { ok: true, args: { [field]: value } };
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
