// M2A-SPEC §5.13 tween family (A4): tween, blend to a neighbour, ease, push/pull and blend to the default, on the pose
// at a frame (keys set or patched there, breakdowns by default) or on runs of selected keys (values changed in place).
//
// The work splits in two: a *plan* reads the committed document once (neighbours, current values, defaults, ranges)
// and a *value* step maps a slider amount to target values without reading anything. `tweenEdits` is both in one
// call; the slider gesture plans when the drag starts ("captured when the gesture starts") and re-evaluates the plan
// for every amount, so its preview updates never read the preview overlay they replace.
import { EkzaError, type Frame, type TangentType } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, ControlRecord, CurveId, CurveRecord, KeyId, KeyRecord, Tx } from '@ekza-studio/doc';
import { internalsOf } from '../app/internals';
import { activeClipOf } from '../evaluation/time';
import type { ChannelRef, EditorApp, TweenMode } from '../types';
import { keyTargetControls } from '../workflows/targets';
import { attrDefOf, channelDefaultOf, isKeyable, isLocked, isTrsChannel } from './channelMeta';
import { SAME_FRAME_EPS } from './context';
import { beginKeyEditGesture } from './gesture';
import { writeKeyAt } from './keys';

/** The five tween modes (§5.13), in menu order. */
export const TWEEN_MODES: readonly TweenMode[] = ['tween', 'neighbor', 'ease', 'pushPull', 'toDefault'];

/** Slider range without and with overshoot (§5.13). */
export const TWEEN_LIMIT = 100;
export const TWEEN_OVERSHOOT_LIMIT = 150;

export type TweenTarget =
  | {
      readonly kind: 'frame';
      readonly controls: readonly ControlId[];
      readonly channels: readonly ChannelRef[] | null;
      readonly frame: Frame;
    }
  | { readonly kind: 'keys'; readonly keys: readonly KeyId[] };

export interface TweenEdit {
  readonly curve: CurveId | null;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly t: Frame;
  readonly value: number;
}

/** One tweened channel at one time: everything the value step needs (§5.13 notation). */
export interface TweenPlanEntry {
  readonly curve: CurveId;
  readonly control: ControlId;
  readonly channel: ChannelId;
  /** The key the value is written to: the selected key ('keys'), a key already at the frame, or null (new key). */
  readonly key: KeyId | null;
  readonly t: Frame;
  /** Time weight r = (t − t_p)/(t_n − t_p). */
  readonly r: number;
  readonly vp: number;
  readonly vn: number;
  /** Current value v_c (curve ⊕ overrides for 'frame'; the key's own value for 'keys'). */
  readonly vc: number;
  /** Channel default d (`channelDefaultOf`). */
  readonly d: number;
  /** Attribute range (clamped, §5.13 "values of attributes are clamped to their range"). */
  readonly min: number;
  readonly max: number;
  /** New keys of `stepped` attributes get flat/step tangents (§5.1 rule 4). */
  readonly stepped: boolean;
}

export interface TweenPlan {
  readonly kind: 'frame' | 'keys';
  readonly entries: readonly TweenPlanEntry[];
}

/** The amount limited to the slider range (±100, ±150 with overshoot) and rounded to the slider step. */
export function clampTweenAmount(amount: number, overshoot: boolean): number {
  const limit = overshoot ? TWEEN_OVERSHOOT_LIMIT : TWEEN_LIMIT;
  if (!Number.isFinite(amount)) return 0;
  return Math.min(Math.max(amount, -limit), limit);
}

/** The §5.13 formula of `mode` at slider amount `a` for one plan entry (no reads, no clamping of `a`). */
export function tweenValue(mode: TweenMode, a: number, e: TweenPlanEntry): number {
  let v: number;
  switch (mode) {
    case 'tween': {
      const w = (a + 100) / 200;
      v = e.vp + w * (e.vn - e.vp);
      break;
    }
    case 'neighbor': {
      const u = Math.abs(a) / 100;
      v = e.vc + u * ((a < 0 ? e.vp : e.vn) - e.vc);
      break;
    }
    case 'ease': {
      const u = Math.min(Math.abs(a), 100) / 100;
      const k = 1 + 3 * u;
      const ease = a < 0 ? e.r ** k : a > 0 ? 1 - (1 - e.r) ** k : e.r;
      v = e.vp + ease * (e.vn - e.vp);
      break;
    }
    case 'pushPull': {
      const ref = e.vp + e.r * (e.vn - e.vp);
      v = e.vc + (a / 100) * (e.vc - ref);
      break;
    }
    case 'toDefault':
      v = e.vc + (a / 100) * (e.d - e.vc);
      break;
  }
  return Math.min(Math.max(v, e.min), e.max);
}

// ---------- planning ----------

/** Range of a channel: the attribute's min/max, unbounded for TRS channels. */
function rangeOf(control: ControlRecord, channel: ChannelId): { readonly min: number; readonly max: number } {
  const def = attrDefOf(control, channel);
  const min = typeof def?.min === 'number' && Number.isFinite(def.min) ? def.min : Number.NEGATIVE_INFINITY;
  const max = typeof def?.max === 'number' && Number.isFinite(def.max) ? def.max : Number.POSITIVE_INFINITY;
  return min <= max ? { min, max } : { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY };
}

/** True when a channel can be edited: keyable and unlocked TRS channels, keyable attributes. */
function editable(control: ControlRecord, channel: ChannelId): boolean {
  if (isTrsChannel(channel)) return isKeyable(control, channel) && !isLocked(control, channel);
  return attrDefOf(control, channel)?.keyable === true;
}

/** Channels the 'frame' target tweens on a control without a Channel Box channel selection (§5.13). */
function poseChannels(control: ControlRecord): readonly ChannelId[] {
  const channels: ChannelId[] = (['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'] as const).filter((channel) =>
    editable(control, channel),
  );
  const attrs = typeof control.attrs === 'object' && control.attrs !== null ? control.attrs : {};
  for (const [name, def] of Object.entries(attrs)) {
    // keyAll: false attributes (modes and settings, §5.1 rule 4) only when they are selected Channel Box channels.
    if (typeof def !== 'object' || def === null || def.keyable !== true || def.keyAll === false) continue;
    channels.push(`@${name}` as ChannelId);
  }
  return channels;
}

/** True when the channel's curve may be edited: not locked in the Graph Editor, its TRS channel not locked. */
function curveEditable(curve: CurveRecord, control: ControlRecord | undefined): boolean {
  if (curve.locked) return false;
  return control === undefined || !isTrsChannel(curve.channel) || !isLocked(control, curve.channel);
}

function planFrame(app: EditorApp, target: Extract<TweenTarget, { readonly kind: 'frame' }>): TweenPlanEntry[] {
  const view = app.store;
  const state = app.session.getState();
  const engine = internalsOf(app).deps.curves.engine;
  const entries: TweenPlanEntry[] = [];
  const t = target.frame;
  for (const id of target.controls) {
    const control = view.get('controls', id);
    if (control === undefined) continue;
    const character = view.get('rigs', control.rig)?.character;
    const clip = character === undefined ? undefined : activeClipOf(view, state, character);
    const layer = clip === undefined ? undefined : view.query.baseLayer(clip.id);
    if (character === undefined || clip === undefined || layer === undefined) continue;
    const channels =
      target.channels === null
        ? poseChannels(control)
        : target.channels.filter((ref) => ref.control === id && editable(control, ref.channel)).map((r) => r.channel);
    const current = app.evaluation.clipFrame(character);
    const atCurrent = current !== null && Math.abs(current - t) < 1e-9;
    for (const channel of new Set(channels)) {
      const curve = view.query.curveFor(clip.id, layer.id, id, channel);
      if (curve === undefined || !curveEditable(curve, control)) continue;
      const keys = view.query.keysOfCurve(curve.id);
      if (keys.length === 0) continue;
      let p: KeyRecord | undefined;
      let n: KeyRecord | undefined;
      let at: KeyRecord | undefined;
      for (const key of keys) {
        if (key.t < t - SAME_FRAME_EPS) p = key;
        else if (key.t > t + SAME_FRAME_EPS) {
          n = key;
          break;
        } else at = key;
      }
      if (p === undefined || n === undefined) continue;
      const vc = atCurrent
        ? app.evaluation.channelValue(id, channel)
        : engine.evaluate(app.evaluation.compiledCurve(curve.id), t);
      const { min, max } = rangeOf(control, channel);
      entries.push({
        curve: curve.id,
        control: id,
        channel,
        key: at?.id ?? null,
        t,
        r: (t - p.t) / (n.t - p.t),
        vp: p.v,
        vn: n.v,
        vc,
        d: channelDefaultOf(control, channel),
        min,
        max,
        stepped: attrDefOf(control, channel)?.stepped === true,
      });
    }
  }
  return entries;
}

function planKeys(app: EditorApp, keys: readonly KeyId[]): TweenPlanEntry[] {
  const view = app.store;
  const byCurve = new Map<CurveId, Set<KeyId>>();
  for (const id of keys) {
    const key = view.get('keys', id);
    if (key === undefined) continue;
    let set = byCurve.get(key.curve);
    if (set === undefined) {
      set = new Set();
      byCurve.set(key.curve, set);
    }
    set.add(id);
  }
  const entries: TweenPlanEntry[] = [];
  for (const [curveId, selected] of byCurve) {
    const curve = view.get('curves', curveId);
    const control = curve === undefined ? undefined : view.get('controls', curve.control);
    if (curve === undefined || control === undefined || !curveEditable(curve, control)) continue;
    const ordered = view.query.keysOfCurve(curveId);
    const { min, max } = rangeOf(control, curve.channel);
    const d = channelDefaultOf(control, curve.channel);
    const stepped = attrDefOf(control, curve.channel)?.stepped === true;
    // Runs: maximal sequences of consecutive selected keys; each run tweens against the unselected keys around it.
    for (let i = 0; i < ordered.length; ) {
      if (!selected.has((ordered[i] as KeyRecord).id)) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < ordered.length && selected.has((ordered[j + 1] as KeyRecord).id)) j++;
      const p = ordered[i - 1];
      const n = ordered[j + 1];
      if (p !== undefined && n !== undefined) {
        for (let k = i; k <= j; k++) {
          const key = ordered[k] as KeyRecord;
          entries.push({
            curve: curveId,
            control: control.id,
            channel: curve.channel,
            key: key.id,
            t: key.t,
            r: (key.t - p.t) / (n.t - p.t),
            vp: p.v,
            vn: n.v,
            vc: key.v,
            d,
            min,
            max,
            stepped,
          });
        }
      }
      i = j + 1;
    }
  }
  return entries;
}

/** Reads what a tween of `target` needs from the committed document and the session (§5.13 neighbours). */
export function planTween(app: EditorApp, target: TweenTarget): TweenPlan {
  if (target.kind === 'frame') {
    if (!Number.isFinite(target.frame)) throw new EkzaError('invalid-record', 'tween: the frame must be finite');
    return { kind: 'frame', entries: planFrame(app, target) };
  }
  return { kind: 'keys', entries: planKeys(app, target.keys) };
}

/** Target values of a planned tween at slider amount `amount`. */
export function evaluateTweenPlan(plan: TweenPlan, mode: TweenMode, amount: number): readonly TweenEdit[] {
  return plan.entries.map((e) => ({
    curve: e.curve,
    control: e.control,
    channel: e.channel,
    t: e.t,
    value: tweenValue(mode, amount, e),
  }));
}

/** M2a §5.13: target values of a tween; pure (reads the committed state of `app.store` and the session overrides). */
export function tweenEdits(
  app: EditorApp,
  mode: TweenMode,
  amount: number,
  target:
    | {
        readonly kind: 'frame';
        readonly controls: readonly ControlId[];
        readonly channels: readonly ChannelRef[] | null;
        readonly frame: Frame;
      }
    | { readonly kind: 'keys'; readonly keys: readonly KeyId[] },
): readonly {
  readonly curve: CurveId | null;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly t: Frame;
  readonly value: number;
}[] {
  if (!TWEEN_MODES.includes(mode)) throw new EkzaError('invalid-record', `tween: unknown mode ${String(mode)}`);
  if (!Number.isFinite(amount)) throw new EkzaError('invalid-record', 'tween: the amount must be finite');
  return evaluateTweenPlan(planTween(app, target), mode, amount);
}

// ---------- writing ----------

function tangentsOf(app: EditorApp, entry: TweenPlanEntry): { readonly in: TangentType; readonly out: TangentType } {
  return entry.stepped ? { in: 'flat', out: 'step' } : app.prefs.getState().defaultTangents;
}

/**
 * Writes a planned tween at `amount` into `tx`: the selected keys' values ('keys'), or a key per channel at the
 * frame ('frame'; a new key is a breakdown unless `breakdown` is false, an existing key keeps its flag). Returns the
 * number of values written.
 */
export function applyTweenPlan(
  app: EditorApp,
  tx: Tx,
  plan: TweenPlan,
  mode: TweenMode,
  amount: number,
  opts?: { readonly breakdown?: boolean },
): number {
  let count = 0;
  for (const entry of plan.entries) {
    const value = tweenValue(mode, amount, entry);
    if (plan.kind === 'keys') {
      const key = entry.key === null ? undefined : tx.get('keys', entry.key);
      if (key === undefined) continue;
      if (key.v !== value) tx.put('keys', { ...key, v: value });
    } else {
      if (tx.get('curves', entry.curve) === undefined) continue;
      writeKeyAt(app, tx, entry.curve, entry.t, value, tangentsOf(app, entry), {
        breakdown: opts?.breakdown !== false,
      });
    }
    count++;
  }
  return count;
}

/** Removes the session overrides of the planned channels (the keys written at the frame take over, §4.11.1 rule 5). */
export function dropPlannedOverrides(app: EditorApp, plan: TweenPlan): boolean {
  if (plan.kind !== 'frame') return false;
  const overrides = app.session.getState().overrides;
  if (overrides.size === 0) return false;
  const next = new Map(overrides);
  let changed = false;
  for (const entry of plan.entries) {
    const values = next.get(entry.control);
    if (values?.[entry.channel] === undefined) continue;
    const { [entry.channel]: _dropped, ...rest } = values;
    if (Object.keys(rest).length === 0) next.delete(entry.control);
    else next.set(entry.control, rest);
    changed = true;
  }
  if (changed) app.session.setState({ overrides: next });
  return changed;
}

// ---------- target resolution (the Tween bar label, `key.tween` without `target`) ----------

export interface ResolvedTweenTarget {
  readonly kind: 'frame' | 'keys';
  /** "Pose @ f21" or "12 keys" (§5.13: the bar always shows the resolved target). */
  readonly label: string;
  readonly target: TweenTarget;
}

/** Selected keys (key part) that still exist, in selection order. */
function selectedKeyParts(app: EditorApp): KeyId[] {
  const out: KeyId[] = [];
  for (const [id, parts] of app.session.getState().selection.keys) {
    if (parts.key && app.store.get('keys', id) !== undefined) out.push(id);
  }
  return out;
}

function frameLabel(frame: Frame | null): string {
  if (frame === null) return 'Pose';
  const shown = Number.isInteger(frame) ? String(frame) : String(Math.round(frame * 100) / 100);
  return `Pose @ f${shown}`;
}

/**
 * The tween target (§5.13): `'keys'` when `session.tools.tweenTarget` is `'auto'` and keys are selected, else the
 * pose at the active character's current clip frame (key-target controls, or the Channel Box's selected channels).
 * `force` overrides the session's choice (the `key.tween` argument).
 */
export function resolveTweenTarget(app: EditorApp, force?: 'frame' | 'keys'): ResolvedTweenTarget {
  const state = app.session.getState();
  const keys = force === 'frame' ? [] : selectedKeyParts(app);
  const useKeys = force === 'keys' || (force === undefined && state.tools.tweenTarget === 'auto' && keys.length > 0);
  if (useKeys) {
    return { kind: 'keys', label: keys.length === 1 ? '1 key' : `${keys.length} keys`, target: { kind: 'keys', keys } };
  }
  const character = state.activeCharacter;
  const frame = character === null ? null : app.evaluation.clipFrame(character);
  const channels = state.selection.channels.length > 0 ? state.selection.channels : null;
  return {
    kind: 'frame',
    label: frameLabel(frame),
    target: { kind: 'frame', controls: keyTargetControls(app, state.tools.keyTarget), channels, frame: frame ?? 0 },
  };
}

// ---------- the slider gesture ----------

export interface TweenGesture {
  readonly active: boolean;
  readonly kind: 'frame' | 'keys';
  /** Channels or keys the gesture tweens (0: the drag changes nothing). */
  readonly count: number;
  /** Previews the tween at `amount` (coalesced to one document update per frame). */
  update(amount: number): void;
  /** Writes the tween at `amount` as ONE history step labelled `Tween`; returns the number of values written. */
  commit(amount: number): number;
  /** Esc: the document and the session overrides return to how they were. */
  cancel(): void;
}

/**
 * One Tween bar drag (§5.13): plans the target when the drag starts, previews each amount through a key-edit gesture
 * and commits one step. For the pose target the overrides of the tweened channels leave the session while the drag
 * runs (the keys take over); a cancel restores them.
 */
export function beginTweenGesture(
  app: EditorApp,
  opts: { readonly mode: TweenMode; readonly target?: 'frame' | 'keys'; readonly breakdown?: boolean },
): TweenGesture {
  const resolved = resolveTweenTarget(app, opts.target);
  const plan = planTween(app, resolved.target);
  const overridesBefore = app.session.getState().overrides;
  const gesture = beginKeyEditGesture(app, 'Tween');
  dropPlannedOverrides(app, plan);
  const write = (amount: number) => (tx: Tx) => {
    applyTweenPlan(app, tx, plan, opts.mode, amount, { breakdown: opts.breakdown !== false });
  };
  let done = false;
  return {
    get active() {
      return !done && gesture.active;
    },
    kind: plan.kind,
    count: plan.entries.length,
    update(amount: number): void {
      if (done) return;
      gesture.update(write(amount));
    },
    commit(amount: number): number {
      if (done) return 0;
      done = true;
      if (plan.entries.length === 0) {
        gesture.cancel();
        return 0;
      }
      gesture.commit(write(amount), { label: 'Tween' });
      return plan.entries.length;
    },
    cancel(): void {
      if (done) return;
      done = true;
      gesture.cancel();
      if (app.session.getState().overrides !== overridesBefore) app.session.setState({ overrides: overridesBefore });
    },
  };
}
