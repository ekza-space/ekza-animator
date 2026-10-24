// The Curves layer as data (STUDIO-TOUCH-SPEC §10.5; T10): which controls and curves it shows — the controls
// selected in the canvas or the Keys layer (several at once), else every animated control of the character — the
// channel chips over them (*Move Y*, *Bend* … with Pro's numbers, §10.1), the curves drawn (the chosen channels, else
// all; *Only animated* leaves out curves without keys; the filter matches control and channel names), the numbers of
// the selected keys (⟨Time⟩ ⟨Value⟩ ⟨In⟩ ⟨Out⟩ and the weights of weighted curves, Pro's Graph Editor fields) and the
// curve noun's targets. Read from the document and the session; Studio Pro's Graph panel model is not imported (it is
// not in `@ekza-studio/editor/models`, ST-T5C-2), so the few rules it shares are restated here. Pure.
import { type Fps, tangentFields } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId, ControlRecord, CurveId, CurveRecord, KeyId, KeyRecord } from '@ekza-studio/doc';
import {
  type ChannelRef,
  channelDisplayLabel,
  channelUnit,
  type EditorApp,
  type KeyPartSelection,
} from '@ekza-studio/editor-core';
import { CHANNEL_LABELS, type TrsChannel } from '../../i18n/channels';
import type { ThreadContext } from '../strip/model';

/** The order chips read in: moves, turns, scales, then the control's own attributes. */
const ORDER: readonly ChannelId[] = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'];

/** A curve of a listed control in the active animation's base layer. */
export interface CurveRow {
  readonly id: CurveId;
  readonly control: ControlId;
  readonly channel: ChannelId;
  readonly keys: number;
}

/** A channel chip: one channel across the listed controls (several controls: their curves of that channel). */
export interface ChannelChip {
  readonly channel: ChannelId;
  /** The plain label (§10.1: Move Y, Bend …). */
  readonly label: string;
  /** Pro's Channels name ("Translate Y"), shown one layer down. */
  readonly pro: string;
  readonly refs: readonly ChannelRef[];
  /** In the channel selection (the curves shown are the chosen channels'; none chosen: all). */
  readonly chosen: boolean;
}

function controlsOfCharacter(app: EditorApp, thread: ThreadContext): readonly ControlRecord[] {
  const rig = app.store.query.rigOfCharacter(thread.character);
  return rig === undefined ? [] : app.store.query.controlsOfRig(rig.id);
}

/**
 * The controls the layer lists (Pro's "auto load selected"): the selected controls of the animated character, else
 * every control of it with keys in the active animation.
 */
export function listedControls(app: EditorApp, thread: ThreadContext): readonly ControlId[] {
  const own = controlsOfCharacter(app, thread);
  const ids = new Set(own.map((control) => control.id));
  const selected = app.session.getState().selection.controls.filter((control) => ids.has(control));
  if (selected.length > 0) return selected;
  const base = app.store.query.baseLayer(thread.clip.id);
  const animated = new Set<ControlId>();
  for (const curve of app.store.query.curvesOfClip(thread.clip.id)) {
    if (curve.layer === base?.id && app.store.query.keysOfCurve(curve.id).length > 0) animated.add(curve.control);
  }
  return own.filter((control) => animated.has(control.id)).map((control) => control.id);
}

/** The curves of the listed controls in the active animation's base layer, in chip order per control. */
export function curveRows(app: EditorApp, thread: ThreadContext, controls: readonly ControlId[]): readonly CurveRow[] {
  const base = app.store.query.baseLayer(thread.clip.id);
  const listed = new Set(controls);
  const rows: CurveRow[] = [];
  for (const curve of app.store.query.curvesOfClip(thread.clip.id)) {
    if (curve.layer !== base?.id || !listed.has(curve.control)) continue;
    rows.push({
      id: curve.id,
      control: curve.control,
      channel: curve.channel,
      keys: app.store.query.keysOfCurve(curve.id).length,
    });
  }
  const rank = (channel: ChannelId): number => {
    const index = ORDER.indexOf(channel);
    return index === -1 ? ORDER.length : index;
  };
  const position = new Map(controls.map((control, index) => [control, index]));
  return rows.sort(
    (a, b) =>
      (position.get(a.control) ?? 0) - (position.get(b.control) ?? 0) ||
      rank(a.channel) - rank(b.channel) ||
      a.channel.localeCompare(b.channel),
  );
}

const isTrs = (channel: ChannelId): channel is TrsChannel => (ORDER as readonly string[]).includes(channel);

/** A channel's plain label and Pro's name (§10.1): Move Y · Translate Y; an attribute by its own name. */
export function channelText(
  channel: ChannelId,
  control: ControlRecord | null,
): { readonly plain: string; readonly pro: string } {
  if (isTrs(channel)) return { plain: CHANNEL_LABELS[channel].plain, pro: CHANNEL_LABELS[channel].pro };
  const pro = channelDisplayLabel(control, channel);
  // an attribute's own name, without the jargon of Pro's switch (§1.3: no IK/FK at L0 or L1)
  return { plain: channel === '@ikFk' ? 'Leads' : pro, pro };
}

const sameRef = (a: ChannelRef, b: ChannelRef): boolean => a.control === b.control && a.channel === b.channel;

/** The rows a filter keeps: `onlyAnimated` drops curves without keys; `filter` matches control or channel names. */
export function filteredRows(
  app: EditorApp,
  rows: readonly CurveRow[],
  opts: { readonly onlyAnimated: boolean; readonly filter: string },
): readonly CurveRow[] {
  const query = opts.filter.trim().toLowerCase();
  return rows.filter((row) => {
    if (opts.onlyAnimated && row.keys === 0) return false;
    if (query === '') return true;
    const control = app.store.get('controls', row.control) ?? null;
    const text = channelText(row.channel, control);
    return [control?.name ?? '', text.plain, text.pro].some((name) => name.toLowerCase().includes(query));
  });
}

/** The channel chips over the rows, in chip order. */
export function channelChips(
  app: EditorApp,
  rows: readonly CurveRow[],
  chosen: readonly ChannelRef[],
): readonly ChannelChip[] {
  const byChannel = new Map<ChannelId, ChannelRef[]>();
  for (const row of rows) {
    const refs = byChannel.get(row.channel) ?? [];
    refs.push({ control: row.control, channel: row.channel });
    byChannel.set(row.channel, refs);
  }
  return [...byChannel.entries()].map(([channel, refs]) => {
    const control = app.store.get('controls', refs[0]?.control as ControlId) ?? null;
    const text = channelText(channel, control);
    return {
      channel,
      label: text.plain,
      pro: text.pro,
      refs,
      chosen: refs.some((ref) => chosen.some((other) => sameRef(ref, other))),
    };
  });
}

/** The curves drawn: the chosen channels' when any of them is listed, else every listed curve (Pro's rule). */
export function shownCurves(rows: readonly CurveRow[], chosen: readonly ChannelRef[]): readonly CurveId[] {
  const picked = rows.filter((row) => chosen.some((ref) => ref.control === row.control && ref.channel === row.channel));
  return (picked.length > 0 ? picked : rows).map((row) => row.id);
}

/** The channel selection after a chip's tap: only that channel; again on the only one: all; `more`: add or remove. */
export function chipSelection(
  current: readonly ChannelRef[],
  chip: ChannelChip,
  all: readonly ChannelChip[],
  more: boolean,
): { readonly refs: readonly ChannelRef[]; readonly mode: 'replace' | 'add' | 'remove' } {
  if (more) return { refs: chip.refs, mode: chip.chosen ? 'remove' : 'add' };
  const onlyThis = chip.chosen && all.every((other) => other === chip || !other.chosen);
  return onlyThis ? { refs: [], mode: 'replace' } : { refs: chip.refs, mode: 'replace' };
}

// ---------- the selected keys' numbers (§10.5 Fields) ----------

/** A selected key with what its numbers need. */
interface Picked {
  readonly key: KeyRecord;
  readonly curve: CurveRecord;
  readonly parts: KeyPartSelection;
  /** Display units per stored unit (degrees for turns). */
  readonly scale: number;
  readonly fps: Fps;
}

/** The numbers of the selected keys: null where they differ (or nothing is selected). */
export interface KeyNumbers {
  readonly count: number;
  /** In the key's own frames. */
  readonly frame: number | null;
  /** Pro's number: degrees for turns, metres for moves. */
  readonly value: number | null;
  /** The unit the value reads in. */
  readonly unit: '°' | 'm' | '';
  readonly inAngle: number | null;
  readonly outAngle: number | null;
  /** Weights apply only when every selected key's curve is weighted. */
  readonly weighted: boolean;
  readonly inWeight: number | null;
  readonly outWeight: number | null;
  readonly fps: Fps | null;
}

const NONE: KeyNumbers = {
  count: 0,
  frame: null,
  value: null,
  unit: '',
  inAngle: null,
  outAngle: null,
  weighted: false,
  inWeight: null,
  outWeight: null,
  fps: null,
};

/** The common value within 1e-9 (relative to the first), null when they differ or there are none. */
export function common(values: readonly number[]): number | null {
  const first = values[0];
  if (first === undefined || !Number.isFinite(first)) return null;
  for (const value of values) {
    if (!(Math.abs(value - first) <= 1e-9 * Math.max(1, Math.abs(first)))) return null;
  }
  return first;
}

function pickedKeys(app: EditorApp, selection: ReadonlyMap<KeyId, KeyPartSelection>): readonly Picked[] {
  const out: Picked[] = [];
  const scales = new Map<CurveId, number>();
  for (const [id, parts] of selection) {
    if (!parts.key && !parts.in && !parts.out) continue;
    const key = app.store.get('keys', id);
    const curve = key === undefined ? undefined : app.store.get('curves', key.curve);
    const clip = key === undefined ? undefined : app.store.get('clips', key.clip);
    if (key === undefined || curve === undefined || clip === undefined) continue;
    let scale = scales.get(curve.id);
    if (scale === undefined) {
      scale =
        channelUnit(app.store.get('controls', curve.control) ?? null, curve.channel) === 'angle' ? 180 / Math.PI : 1;
      scales.set(curve.id, scale);
    }
    out.push({ key, curve, parts, scale, fps: clip.fps });
  }
  return out;
}

/** The selected keys' numbers (Pro's Graph Editor fields, in Pro's units and signs, §10.1 P14). */
export function keyNumbers(app: EditorApp): KeyNumbers {
  const picked = pickedKeys(app, app.session.getState().selection.keys);
  if (picked.length === 0) return NONE;
  const units = new Set(
    picked.map((p) =>
      channelUnit(app.store.get('controls', p.curve.control) ?? null, p.curve.channel) === 'angle'
        ? '°'
        : p.curve.channel.startsWith('t')
          ? 'm'
          : '',
    ),
  );
  const weighted = picked.every((p) => p.curve.weighted);
  const ins: number[] = [];
  const outs: number[] = [];
  const inWeights: number[] = [];
  const outWeights: number[] = [];
  const byCurve = new Map<CurveId, Picked[]>();
  for (const p of picked) byCurve.set(p.curve.id, [...(byCurve.get(p.curve.id) ?? []), p]);
  try {
    for (const group of byCurve.values()) {
      const { clip, layer, control, channel } = (group[0] as Picked).curve;
      // duplicate curves of a channel read through the canonical one, which unions their keys
      const canonical = app.store.query.curveFor(clip, layer, control, channel)?.id ?? (group[0] as Picked).curve.id;
      const compiled = app.evaluation.compiledCurve(canonical);
      const sorted = app.store.query.keysOfCurve(canonical);
      if (sorted.length !== compiled.keyCount) continue;
      for (const p of group) {
        const index = sorted.findIndex((key) => key.id === p.key.id);
        if (index === -1) continue;
        const i = tangentFields(
          { dt: compiled.inDt[index] as number, dv: compiled.inDv[index] as number },
          'in',
          p.fps,
          p.scale,
        );
        const o = tangentFields(
          { dt: compiled.outDt[index] as number, dv: compiled.outDv[index] as number },
          'out',
          p.fps,
          p.scale,
        );
        ins.push(i.angleDeg);
        outs.push(o.angleDeg);
        inWeights.push(i.weight);
        outWeights.push(o.weight);
      }
    }
  } catch {
    // the curve engine could not resolve the handles: the angle and weight chips stay empty
  }
  const fps = common(picked.map((p) => p.fps.num / p.fps.den)) === null ? null : (picked[0] as Picked).fps;
  return {
    count: picked.length,
    frame: common(picked.map((p) => p.key.t)),
    value: common(picked.map((p) => p.key.v * p.scale)),
    unit: units.size === 1 ? ([...units][0] as '°' | 'm' | '') : '',
    inAngle: common(ins),
    outAngle: common(outs),
    weighted,
    inWeight: weighted ? common(inWeights) : null,
    outWeight: weighted ? common(outWeights) : null,
    fps,
  };
}

/** The first selected key's frame (the docked key Halo's title), or null. */
export function firstKeyFrame(app: EditorApp): number | null {
  const picked = pickedKeys(app, app.session.getState().selection.keys);
  if (picked.length === 0) return null;
  return Math.min(...picked.map((p) => p.key.t));
}

/** How many keys are selected (key or handle parts). */
export function selectedKeyCount(app: EditorApp): number {
  return pickedKeys(app, app.session.getState().selection.keys).length;
}

/** The keys of curves, every one as a key-part selection item (the curve's *Ease all*). */
export function curveKeyItems(
  app: EditorApp,
  curves: readonly CurveId[],
): readonly { readonly key: KeyId; readonly parts: KeyPartSelection }[] {
  return curves.flatMap((curve) =>
    app.store.query.keysOfCurve(curve).map((key) => ({ key: key.id, parts: { key: true, in: false, out: false } })),
  );
}
