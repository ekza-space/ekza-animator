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
//   three seam keys are frozen with their resolved handles as `fixed` (a `step`/`stepNext` out flag is kept: it
//   belongs to the span the key starts, which maps with it). Exact at every frame for periodic curves.
import {
  type AnimCurve,
  type CompiledAnimCurve,
  type CurveEngine,
  EkzaError,
  type Handle,
  type KeyData,
  type TangentType,
} from '@ekza-animator/anim-core';
import type {
  AttrDef,
  ChannelId,
  ClipRecord,
  ControlId,
  ControlRecord,
  CurveId,
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
  /** The source has no curve on the channel: the target's curve is removed (the channel reads its default). */
  readonly absent: boolean;
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
      absent: true,
    };
  }
  return {
    keys: view.query.keysOfCurve(curve.id).map(keyDataOf),
    weighted: curve.weighted,
    pre: curve.pre,
    post: curve.post,
    staticValue: curve.staticValue,
    absent: false,
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

/** Slopes this close count as one (a seam key whose in and out slopes differ is `broken`). */
const differentSlopes = (a: Handle, b: Handle): boolean => {
  const x = slopeOf(a);
  const y = slopeOf(b);
  return !(Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(x), Math.abs(y)));
};

/** AnimX's 1/3 (handles of computed sides are a third of the span, computed as `span * ONE_THIRD`). */
const ONE_THIRD = 1.0 / 3.0;
const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

/**
 * Handle readers for frozen copies of a curve's keys: the resolved handles of `compiled`, except on weighted curves,
 * whose compiled handles carry AnimX's monotonic-X correction of overlong handles. That correction is not idempotent
 * (a corrected handle sits just inside the bound, where a second correction may take the other branch), so a frozen
 * key gets the handle the engine started from: the stored one of a `fixed` side, a third of the span along the
 * resolved slope otherwise (anim-core `resolveTangents`). The engine then corrects the copy exactly as the source.
 */
function handleReaders(
  curve: AnimCurve,
  compiled: CompiledAnimCurve,
): { readonly in: (i: number) => Handle; readonly out: (i: number) => Handle } {
  const compiledIn = (i: number): Handle => ({ dt: compiled.inDt[i] as number, dv: compiled.inDv[i] as number });
  const compiledOut = (i: number): Handle => ({ dt: compiled.outDt[i] as number, dv: compiled.outDv[i] as number });
  if (!curve.weighted) return { in: compiledIn, out: compiledOut };
  const keys = curve.keys;
  const spans = (i: number): { readonly before: number; readonly after: number } => {
    const key = keys[i] as KeyData;
    const prev = keys[i - 1];
    const next = keys[i + 1];
    return {
      before: prev !== undefined ? key.t - prev.t : next !== undefined ? next.t - key.t : 1,
      after: next !== undefined ? next.t - key.t : prev !== undefined ? key.t - prev.t : 1,
    };
  };
  return {
    in: (i) => {
      const key = keys[i] as KeyData;
      if (key.inType === 'fixed') return { dt: finiteOr(key.inHandle.dt, 0), dv: finiteOr(key.inHandle.dv, 0) };
      const span = spans(i).before;
      // `0 −`: a flat side stays at +0 (a −0 frozen into the document would not survive a JSON round trip).
      return { dt: -(span * ONE_THIRD), dv: 0 - (compiled.inSlope[i] as number) * span * ONE_THIRD };
    },
    out: (i) => {
      const key = keys[i] as KeyData;
      if (key.outType === 'fixed') return { dt: finiteOr(key.outHandle.dt, 0), dv: finiteOr(key.outHandle.dv, 0) };
      const span = spans(i).after;
      return { dt: span * ONE_THIRD, dv: 0 + (compiled.outSlope[i] as number) * span * ONE_THIRD };
    },
  };
}

const isCyclic = (mode: AnimCurve['pre']): boolean =>
  mode === 'cycle' || mode === 'cycleOffset' || mode === 'oscillate';
const isStepFlag = (type: TangentType): boolean => type === 'step' || type === 'stepNext';
/** More keys than this from unrolling a cyclic infinity: the working copy falls back to the plain inserts. */
const MAX_UNROLLED_KEYS = 20_000;

/**
 * The working copy's first step for cyclic infinities (§5.14 step 1, "without changing the shape"): a key inserted
 * outside the key range takes the infinity's value and slope, but a cyclic infinity cannot survive it (the cycle
 * range changes), so where the clip range [s, e] reaches past the keys into a `cycle`, `cycleOffset` or `oscillate`
 * infinity, that side is first written out as copies of the key range (AnimX mapping: forward copies, every odd
 * oscillation reversed). Copied keys take their values from the source curve's evaluation at their time (AnimX's
 * junction values included), their resolved handles as `fixed` (reversed copies swap and mirror the two sides) and
 * the step flag of the span they start (a reversed copy turns `step` into `stepNext` and back). The original end keys
 * are frozen the same way, because their neighbourhood (and with it any auto or cycle-aware tangent) changes. A
 * single key or an empty key range under a cyclic infinity behaves as constant (AnimX) and is treated as such.
 */
function unrollCycles(engine: CurveEngine, curve: AnimCurve, s: number, e: number): AnimCurve {
  const keys = curve.keys;
  const n = keys.length;
  if (n === 0) return curve;
  const first = (keys[0] as KeyData).t;
  const last = (keys[n - 1] as KeyData).t;
  const P = last - first;
  if (!(P > 0)) {
    if (!isCyclic(curve.pre) && !isCyclic(curve.post)) return curve;
    return {
      ...curve,
      pre: isCyclic(curve.pre) ? 'constant' : curve.pre,
      post: isCyclic(curve.post) ? 'constant' : curve.post,
    };
  }
  const before = isCyclic(curve.pre) && s < first - SAME_FRAME ? Math.ceil((first - s) / P - 1e-12) : 0;
  const after = isCyclic(curve.post) && e > last + SAME_FRAME ? Math.ceil((e - last) / P - 1e-12) : 0;
  if (before + after === 0 || (before + after + 1) * n > MAX_UNROLLED_KEYS) return curve;
  const compiled = engine.compile(curve);
  // Forward copies repeat the source spans: the uncorrected handles make the engine correct them the same way.
  // Reversed copies take the corrected (monotonic) ones mirrored: AnimX corrects a span keeping its first handle,
  // which a reversed span cannot reproduce, so a weighted span the correction changed is not exact under oscillate.
  const { in: inOf, out: outOf } = handleReaders(curve, compiled);
  const correctedIn = (i: number): Handle => ({ dt: compiled.inDt[i] as number, dv: compiled.inDv[i] as number });
  const correctedOut = (i: number): Handle => ({ dt: compiled.outDt[i] as number, dv: compiled.outDv[i] as number });
  /** The out type of a key starting a copy of source span k (`fixed` unless the span steps). */
  const flagOf = (k: number, reversed: boolean): TangentType => {
    const type = (keys[k] as KeyData).outType;
    if (!isStepFlag(type)) return 'fixed';
    if (!reversed) return type;
    return type === 'step' ? 'stepNext' : 'step';
  };
  interface Image {
    readonly t: number;
    readonly source: KeyData;
    readonly inHandle: Handle;
    readonly outHandle: Handle;
    /** Out type of the span this key starts (null at a copy's last key: the next copy decides). */
    readonly outType: TangentType | null;
  }
  /** Copy j of the key range in time order: forward, or reversed for odd oscillations. */
  const copy = (j: number): Image[] => {
    const reversed = (j < 0 ? curve.pre : curve.post) === 'oscillate' && Math.abs(j) % 2 === 1;
    const out: Image[] = [];
    for (let idx = 0; idx < n; idx++) {
      if (!reversed) {
        out.push({
          t: (keys[idx] as KeyData).t + j * P,
          source: keys[idx] as KeyData,
          inHandle: inOf(idx),
          outHandle: outOf(idx),
          outType: idx < n - 1 ? flagOf(idx, false) : null,
        });
        continue;
      }
      const i = n - 1 - idx;
      const o = correctedOut(i);
      const h = correctedIn(i);
      out.push({
        t: first + last - (keys[i] as KeyData).t + j * P,
        source: keys[i] as KeyData,
        inHandle: { dt: 0 - o.dt, dv: o.dv },
        outHandle: { dt: 0 - h.dt, dv: h.dv },
        outType: i > 0 ? flagOf(i - 1, true) : null,
      });
    }
    return out;
  };
  const original = (): Image[] =>
    keys.map((key, i) => ({
      t: key.t,
      source: key,
      inHandle: inOf(i),
      outHandle: outOf(i),
      outType: i < n - 1 ? flagOf(i, false) : null,
    }));
  // Copies −before … after joined at their shared end keys: the left copy gives the in side, the right one the out
  // side and its step flag.
  const images: Image[] = [];
  for (let j = -before; j <= after; j++) {
    const piece = j === 0 ? original() : copy(j);
    const left = images.pop();
    const head = piece[0] as Image;
    images.push(left === undefined ? head : { ...head, inHandle: left.inHandle }, ...piece.slice(1));
  }
  const firstIndex = before * (n - 1);
  const lastIndex = firstIndex + n - 1;
  const frozen = (image: Image, index: number): KeyData => {
    const outType = image.outType ?? 'fixed';
    // The original end keys keep their own data and value; copied keys take the source's value at their time.
    const own = index === firstIndex || index === lastIndex ? (keys[index - firstIndex] as KeyData) : null;
    const base = own ?? image.source;
    return {
      ...base,
      t: image.t,
      v: own?.v ?? engine.evaluate(compiled, image.t),
      inType: 'fixed',
      outType,
      inHandle: image.inHandle,
      outHandle: image.outHandle,
      broken: base.broken || (!isStepFlag(outType) && differentSlopes(image.inHandle, image.outHandle)),
    };
  };
  return {
    ...curve,
    keys: images.map((image, index) =>
      index > firstIndex && index < lastIndex ? (keys[index - firstIndex] as KeyData) : frozen(image, index),
    ),
  };
}

/**
 * The half-cycle remap of §5.14 on a working copy of `curve` (cyclic infinities over the clip range written out as
 * keys, then keys at s, m and e inserted, both without changing its shape); returns the remapped keys in time order
 * and whether the curve is periodic over [s, e].
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
  let work: AnimCurve = unrollCycles(deps.curves.engine, curve, s, e);
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
  const { in: resolvedIn, out: resolvedOut } = handleReaders(work, compiled);
  /**
   * A seam key: frozen with resolved handles, broken where its two slopes differ. A `step`/`stepNext` out type is an
   * interpolation flag of the span the key starts, not a handle: that span maps with the key (the key landing at m
   * starts the span that followed s, the keys at s and e the one that followed m), so the flag is kept, or the span
   * would turn into a ramp (also when the seam key was inserted inside a step span, which gives it the span's flag).
   */
  const seam = (from: KeyData, t: number, inHandle: Handle, outHandle: Handle): KeyData => {
    const stepped = isStepFlag(from.outType);
    const differ = !stepped && differentSlopes(inHandle, outHandle);
    return {
      ...from,
      t,
      inType: 'fixed',
      outType: stepped ? from.outType : 'fixed',
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
/** Removes every key of a curve, the hidden duplicates too. */
function removeKeys(tx: Tx, curve: CurveId): void {
  for (const key of tx.query.keysOfCurve(curve)) tx.remove('keys', key.id);
  for (const key of tx.query.hiddenKeys(curve)) if (tx.get('keys', key.id) !== undefined) tx.remove('keys', key.id);
}

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
  if (content.absent) {
    // No source curve: no target curve either, so the target reads the channel default like the source (a key-less
    // curve left behind made flip ∘ flip differ from the identity, fix round 1). The mirrored default is the default
    // for every built-in channel (0 or 1; negating 0 gives 0).
    if (existing === undefined) return false;
    removeKeys(tx, existing.id);
    tx.remove('curves', existing.id);
    return true;
  }
  if (existing === undefined && content.keys.length === 0 && content.staticValue === null) return false;
  const curveId = existing?.id ?? ensureCurve(app, tx, clip.id, target.id, channel);
  removeKeys(tx, curveId);
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

const UNPAIRED_SUFFIX = ' has no mirror counterpart and was left unchanged';
/** Names an unpaired-control summary lists before "and N more". */
export const UNPAIRED_NAMES_SHOWN = 3;

/**
 * Collapses the per-control "X has no mirror counterpart and was left unchanged" lines of a mirror (Mirror Pose,
 * Mirror Animation) into one line with the count and at most three names, first; other warnings follow unchanged.
 * A whole-character mirror of a rig with many unpaired secondary controls otherwise raised a toast of ~1,000
 * characters over the panels (acceptance fix round 1). One unpaired control keeps its own line.
 */
export function summarizeMirrorWarnings(warnings: readonly string[]): string[] {
  const names: string[] = [];
  const rest: string[] = [];
  for (const warning of warnings) {
    if (warning.endsWith(UNPAIRED_SUFFIX)) names.push(warning.slice(0, -UNPAIRED_SUFFIX.length));
    else rest.push(warning);
  }
  if (names.length <= 1) return [...names.map((name) => `${name}${UNPAIRED_SUFFIX}`), ...rest];
  const shown = names.slice(0, UNPAIRED_NAMES_SHOWN);
  const more = names.length - shown.length;
  const list =
    more > 0 ? `${shown.join(', ')} and ${more} more` : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return [`${names.length} controls have no mirror counterpart and were left unchanged (${list})`, ...rest];
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
  return { count, warnings: summarizeMirrorWarnings(warnings) };
}
