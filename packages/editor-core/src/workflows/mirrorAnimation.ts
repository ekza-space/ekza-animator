// M2A-SPEC §5.14 mirror animation (A4): mirrors the curves of controls on the active clip — flip, left → right or
// right → left — optionally half a cycle later on a loop clip.
//
// - Channel rule (world-aligned controls: every humanoid FK, IK and pole control): rx, ty, tz copy; ry, rz, tx negate;
//   scale copies; attributes by `AttrDef.mirror`. Values, handle `dv` and static values are mapped; tangent types,
//   `dt`, `broken`, `weightLocked`, `breakdown`, `weighted` and infinities are copied. Controls whose rest frame is not
//   world-aligned (humanoid secondary controls) cannot be mirrored curve by curve and are skipped with a warning.
// - Half cycle (s = start, e = end, T = e − s, m = s + T/2): on a working copy of each source curve, keys are inserted
//   at s, m and e without changing the shape; keys in [s, e) land at s + ((t − s + T/2) mod T); the key landing at m
//   takes value and out-handle from s and its in-handle from e, the key landing at s (from m) gets a copy at e; the
//   three seam keys are frozen with their resolved handles as `fixed`. Exact at every frame for periodic curves.
import { type AnimCurve, EkzaError, type Handle, type KeyData } from '@ekza-animator/anim-core';
import type {
  AttrDef,
  ChannelId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveRecord,
  KeyRecord,
  ReadView,
  Tx,
} from '@ekza-animator/doc';
import type { MirrorMode } from '@ekza-animator/rig';
import { internalsOf, newRecordId } from '../app/internals';
import { attrDefOf, channelDefaultOf, isKeyable, isLocked, isTrsChannel } from '../edit/channelMeta';
import { keyDataOf } from '../edit/context';
import { ensureCurve } from '../edit/keys';
import type { EditorApp } from '../types';
import { controlsOfCharacter } from './targets';

/** Keys this close (frames) share a frame (§4.11.1). */
const SAME_FRAME = 1e-6;
/** A control is world-aligned when its rest rotation is the identity within this (M1 `mirrorPose`). */
const ALIGNED_EPSILON = 1e-9;
/** A source curve whose values at s and e differ by more than this is not periodic over the clip (§5.14 step 4). */
const PERIODIC_EPSILON = 1e-9;

const NEGATED: ReadonlySet<ChannelId> = new Set(['tx', 'ry', 'rz'] as ChannelId[]);

export interface MirrorAnimationOptions {
  readonly mode: MirrorMode;
  readonly offset: 'none' | 'halfCycle';
  /** Controls to mirror (expanded to mirror pairs); null or empty: the whole character. */
  readonly controls: readonly ControlId[] | null;
}

export interface MirrorAnimationResult {
  /** Target channels written. */
  readonly count: number;
  readonly warnings: readonly string[];
}

/** −1 for channels the mirror negates, 1 for the ones it copies (§5.14 channel rule). */
export function mirrorSign(channel: ChannelId, def: AttrDef | undefined): 1 | -1 {
  if (channel.startsWith('@')) return def?.mirror === 'negate' ? -1 : 1;
  return NEGATED.has(channel) ? -1 : 1;
}

export function isWorldAligned(control: ControlRecord): boolean {
  const q = control.restWorld?.q;
  if (q === undefined) return false;
  return Math.abs(q[0]) < ALIGNED_EPSILON && Math.abs(q[1]) < ALIGNED_EPSILON && Math.abs(q[2]) < ALIGNED_EPSILON;
}

/** `0 − x` / `0 + x` keep zeros at +0 (−0 would leak into documents and comparisons). */
const signed = (sign: 1 | -1, value: number): number => (sign === 1 ? 0 + value : 0 - value);

function mapHandle(sign: 1 | -1, handle: Handle): Handle {
  return sign === 1 ? handle : { dt: handle.dt, dv: signed(sign, handle.dv) };
}

/** What a channel holds: its curve's keys and settings, or only a static value (no curve, or no keys). */
interface ChannelContent {
  readonly keys: readonly KeyData[];
  readonly weighted: boolean;
  readonly pre: CurveRecord['pre'];
  readonly post: CurveRecord['post'];
  /** `staticValue` of the curve, or the channel default when there is no curve. */
  readonly staticValue: number | null;
}

function contentOf(
  view: ReadView,
  curve: CurveRecord | undefined,
  control: ControlRecord,
  channel: ChannelId,
): ChannelContent {
  if (curve === undefined) {
    return {
      keys: [],
      weighted: false,
      pre: 'constant',
      post: 'constant',
      staticValue: channelDefaultOf(control, channel),
    };
  }
  return {
    keys: view.query.keysOfCurve(curve.id).map(keyDataOf),
    weighted: curve.weighted,
    pre: curve.pre,
    post: curve.post,
    staticValue: curve.staticValue,
  };
}

/** True when the channel can be written on `control` (keyable and unlocked TRS, keyable attribute). */
function writable(control: ControlRecord, channel: ChannelId): 'yes' | 'locked' | 'no' {
  if (isTrsChannel(channel)) {
    if (!isKeyable(control, channel)) return 'no';
    return isLocked(control, channel) ? 'locked' : 'yes';
  }
  return attrDefOf(control, channel)?.keyable === true ? 'yes' : 'no';
}

const slopeOf = (h: Handle): number => (h.dt === 0 ? (h.dv === 0 ? 0 : Math.sign(h.dv) * Infinity) : h.dv / h.dt);

/**
 * The half-cycle remap of §5.14 on a working copy of `curve` (keys at s, m and e inserted without changing its
 * shape); returns the remapped keys in time order and whether the curve is periodic over [s, e].
 */
export function halfCycleKeys(
  app: EditorApp,
  curve: AnimCurve,
  range: { readonly start: number; readonly end: number },
): { readonly keys: KeyData[]; readonly periodic: boolean } {
  const deps = internalsOf(app).deps;
  const s = range.start;
  const e = range.end;
  const T = e - s;
  const m = s + T / 2;
  if (!(T > 0)) throw new EkzaError('invalid-record', 'halfCycleKeys: the clip range is empty');
  let work: AnimCurve = curve;
  for (const frame of [s, m, e]) {
    if (work.keys.some((key) => Math.abs(key.t - frame) < SAME_FRAME)) continue;
    work = { ...work, keys: deps.curves.insertKeyPreservingShape(work, frame).keys };
  }
  const keys = work.keys;
  const compiled = deps.curves.engine.compile(work);
  const indexAt = (frame: number): number => keys.findIndex((key) => Math.abs(key.t - frame) < SAME_FRAME);
  const is = indexAt(s);
  const im = indexAt(m);
  const ie = indexAt(e);
  if (is === -1 || im === -1 || ie === -1) throw new EkzaError('internal', 'halfCycleKeys: seam keys missing');
  const resolvedIn = (i: number): Handle => ({ dt: compiled.inDt[i] as number, dv: compiled.inDv[i] as number });
  const resolvedOut = (i: number): Handle => ({ dt: compiled.outDt[i] as number, dv: compiled.outDv[i] as number });
  /** A seam key: frozen with resolved handles, broken where its two slopes differ. */
  const seam = (from: KeyData, t: number, inHandle: Handle, outHandle: Handle): KeyData => {
    const a = slopeOf(inHandle);
    const b = slopeOf(outHandle);
    const differ = !(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));
    return {
      ...from,
      t,
      inType: 'fixed',
      outType: 'fixed',
      inHandle,
      outHandle,
      broken: from.broken || differ,
    };
  };
  const out: KeyData[] = [];
  keys.forEach((key, i) => {
    if (i === is) {
      out.push(seam(key, m, resolvedIn(ie), resolvedOut(is)));
      return;
    }
    if (i === im) {
      out.push(seam(key, s, resolvedIn(im), resolvedOut(im)));
      out.push(seam(key, e, resolvedIn(im), resolvedOut(im)));
      return;
    }
    if (key.t < s || key.t >= e - SAME_FRAME) return;
    let u = key.t - s + T / 2;
    if (u >= T) u -= T;
    out.push({ ...key, t: s + u });
  });
  out.sort((a, b) => a.t - b.t);
  const periodic = Math.abs((keys[is] as KeyData).v - (keys[ie] as KeyData).v) <= PERIODIC_EPSILON;
  return { keys: out, periodic };
}

/** Replaces a target channel's curve with mirrored content (new key IDs). */
function writeChannel(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  target: ControlRecord,
  channel: ChannelId,
  existing: CurveRecord | undefined,
  content: ChannelContent,
  sign: 1 | -1,
): boolean {
  if (existing === undefined && content.keys.length === 0 && content.staticValue === null) return false;
  const curveId = existing?.id ?? ensureCurve(app, tx, clip.id, target.id, channel);
  for (const key of tx.query.keysOfCurve(curveId)) tx.remove('keys', key.id);
  for (const key of tx.query.hiddenKeys(curveId)) if (tx.get('keys', key.id) !== undefined) tx.remove('keys', key.id);
  for (const data of content.keys) {
    const key: KeyRecord = {
      ...keyDataOf({
        ...data,
        v: signed(sign, data.v),
        inHandle: mapHandle(sign, data.inHandle),
        outHandle: mapHandle(sign, data.outHandle),
      }),
      id: newRecordId(app, 'key'),
      clip: clip.id,
      curve: curveId,
    };
    tx.put('keys', key);
  }
  const record = tx.get('curves', curveId);
  if (record === undefined) return true;
  const staticValue = content.staticValue === null ? null : signed(sign, content.staticValue);
  const patch: {
    weighted?: boolean;
    pre?: CurveRecord['pre'];
    post?: CurveRecord['post'];
    staticValue?: number | null;
  } = {};
  if (record.weighted !== content.weighted) patch.weighted = content.weighted;
  if (record.pre !== content.pre) patch.pre = content.pre;
  if (record.post !== content.post) patch.post = content.post;
  if (record.staticValue !== staticValue) patch.staticValue = staticValue;
  if (Object.keys(patch).length > 0) tx.patch('curves', curveId, patch);
  return true;
}

interface Write {
  readonly source: ControlRecord;
  readonly target: ControlRecord;
}

/** The (source → target) control writes of `mode` over the scope, and the warnings of unpaired controls (§5.14). */
function planWrites(
  view: ReadView,
  controls: readonly ControlRecord[],
  mode: MirrorMode,
  requested: readonly ControlId[] | null,
): { readonly writes: readonly Write[]; readonly warnings: string[] } {
  const byId = new Map(controls.map((control) => [control.id, control] as const));
  const counterpart = (control: ControlRecord): ControlRecord | undefined =>
    control.mirror === null ? undefined : (byId.get(control.mirror) ?? view.get('controls', control.mirror));
  let scope: Set<ControlId> | null = null;
  if (requested !== null && requested.length > 0) {
    scope = new Set<ControlId>();
    for (const id of requested) {
      const control = byId.get(id);
      if (control === undefined) continue;
      scope.add(id);
      const other = counterpart(control);
      if (other !== undefined) scope.add(other.id);
    }
    // Only centre controls selected: left → right and right → left act on the whole character (§5.14).
    const sided = [...scope].some((id) => byId.get(id)?.side !== 'C');
    if (!sided && mode !== 'flip') scope = null;
  }
  const writes: Write[] = [];
  const warnings: string[] = [];
  const ordered = [...controls].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const control of ordered) {
    if (scope !== null && !scope.has(control.id)) continue;
    if (control.side === 'C' || control.mirror === control.id) {
      if (mode === 'flip') writes.push({ source: control, target: control });
      continue;
    }
    const source = counterpart(control);
    if (source === undefined) {
      warnings.push(`${control.name} has no mirror counterpart and was left unchanged`);
      continue;
    }
    const writesThis =
      mode === 'flip' ||
      (mode === 'leftToRight' && control.side === 'R' && source.side === 'L') ||
      (mode === 'rightToLeft' && control.side === 'L' && source.side === 'R');
    if (writesThis) writes.push({ source, target: control });
  }
  return { writes, warnings };
}

/**
 * Mirrors the animation of a character's controls on `clip` inside `tx` (§5.14). All sources are read before the
 * first write, so a flip of a pair swaps exactly. Returns the number of target channels written and the warnings
 * (unpaired controls, secondary controls, locked channels, non-periodic curves).
 */
export function mirrorAnimation(
  app: EditorApp,
  tx: Tx,
  clip: ClipRecord,
  opts: MirrorAnimationOptions,
): MirrorAnimationResult {
  const controls = controlsOfCharacter(tx, clip.character);
  const layer = tx.query.baseLayer(clip.id);
  const { writes, warnings } = planWrites(tx, controls, opts.mode, opts.controls);
  const curveOf = (control: ControlId, channel: ChannelId): CurveRecord | undefined =>
    layer === undefined ? undefined : tx.query.curveFor(clip.id, layer.id, control, channel);
  const channelsOf = (control: ControlId): readonly ChannelId[] =>
    tx.query
      .curvesOfControl(clip.id, control)
      .filter((curve) => curve.layer === layer?.id)
      .map((c) => c.channel);

  let secondary = 0;
  let locked = 0;
  let nonPeriodic = 0;
  const planned: {
    readonly target: ControlRecord;
    readonly channel: ChannelId;
    readonly existing: CurveRecord | undefined;
    readonly content: ChannelContent;
    readonly sign: 1 | -1;
  }[] = [];
  for (const { source, target } of writes) {
    if (!isWorldAligned(source) || !isWorldAligned(target)) {
      secondary++;
      continue;
    }
    for (const channel of [...new Set([...channelsOf(source.id), ...channelsOf(target.id)])].sort()) {
      const access = writable(target, channel);
      if (access === 'no') continue;
      const existing = curveOf(target.id, channel);
      if (access === 'locked' || existing?.locked === true) {
        locked++;
        continue;
      }
      const sourceCurve = curveOf(source.id, channel);
      let content = contentOf(tx, sourceCurve, source, channel);
      if (opts.offset === 'halfCycle' && content.keys.length > 0) {
        const shifted = halfCycleKeys(
          app,
          { keys: content.keys, weighted: content.weighted, pre: content.pre, post: content.post },
          clip.range,
        );
        if (!shifted.periodic) nonPeriodic++;
        content = { ...content, keys: shifted.keys };
      }
      const def = attrDefOf(target, channel) ?? attrDefOf(source, channel);
      planned.push({ target, channel, existing, content, sign: mirrorSign(channel, def) });
    }
  }
  let count = 0;
  for (const write of planned) {
    if (writeChannel(app, tx, clip, write.target, write.channel, write.existing, write.content, write.sign)) count++;
  }
  if (secondary > 0) {
    warnings.push(`${secondary} secondary control${secondary === 1 ? ' was' : 's were'} not mirrored`);
  }
  if (locked > 0) warnings.push(`${locked} locked channel${locked === 1 ? ' was' : 's were'} not changed`);
  if (nonPeriodic > 0) {
    warnings.push(
      `${nonPeriodic} curve${nonPeriodic === 1 ? ' does' : 's do'} not loop over ${clip.range.start}…${clip.range.end}`,
    );
  }
  return { count, warnings };
}
