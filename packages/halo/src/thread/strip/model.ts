// The Thread's layer 0, as data (STUDIO-TOUCH-SPEC §10.3; T7): what the strip shows — the active animation's range in
// its own frames, the playhead, the key dots of the selection (a faint summary row when nothing is selected; hollow
// dots are in-betweens), the band, beat ticks every 0.25 s on whole frames — and how a point on it maps to a frame.
// Read straight from editor-core's queries and the document (Pro's `timeline/state.ts` and `placement.ts` are React
// hooks; the curve editor is a lazy chunk on `/app`, so its tick code is not used here). Pure.
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { CharacterId, ClipRecord, ControlId, KeyId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { animateCharacter } from '../../stages/animate/model';
import type { TimeUnit } from '../units';

/** Key times closer than this share one dot. */
export const SAME_TIME = 1e-6;

export interface ThreadContext {
  readonly character: CharacterId;
  readonly clip: ClipRecord;
  readonly fps: Fps;
  /** The clip's range in its frames. */
  readonly range: { readonly start: Frame; readonly end: Frame };
}

/** The animation the Thread shows: the Animate character's active clip, or null. */
export function threadContext(app: EditorApp): ThreadContext | null {
  const character = animateCharacter(app);
  if (character === null) return null;
  const id = app.session.getState().activeClip[character];
  const clip = id === undefined ? undefined : app.store.get('clips', id);
  if (clip === undefined || clip.deleted !== null) return null;
  return { character, clip, fps: clip.fps, range: clip.range };
}

/** The playhead in the active clip's frames (the scene frame when no clip is active). */
export function currentFrame(app: EditorApp, ctx: ThreadContext | null): Frame {
  if (ctx !== null) {
    const frame = app.evaluation.clipFrame(ctx.character);
    if (frame !== null) return frame;
  }
  return app.session.getState().time.sceneFrame;
}

/** The controls whose keys show: the selected ones of the character, else all of them (faint). */
export function keyTargets(
  app: EditorApp,
  ctx: ThreadContext,
): { readonly controls: ReadonlySet<ControlId>; readonly faint: boolean } {
  const rig = app.store.get('characters', ctx.character)?.rig;
  const all = rig === undefined ? [] : app.store.query.controlsOfRig(rig).map((control) => control.id);
  const own = new Set<ControlId>(all);
  const selected = app.session.getState().selection.controls.filter((control) => own.has(control));
  return selected.length > 0 ? { controls: new Set(selected), faint: false } : { controls: own, faint: true };
}

export interface KeyDot {
  readonly frame: Frame;
  /** Every key at this time is an in-between (drawn hollow). */
  readonly inBetween: boolean;
  /** A key at this time is selected. */
  readonly selected: boolean;
  /** The keys at this time (of the shown controls' base-layer curves). */
  readonly keys: readonly KeyId[];
}

/** The dots of the shown controls' keys, in time order. */
export function keyDots(
  app: EditorApp,
  ctx: ThreadContext,
): { readonly dots: readonly KeyDot[]; readonly faint: boolean } {
  const { controls, faint } = keyTargets(app, ctx);
  const base = app.store.query.baseLayer(ctx.clip.id);
  if (base === undefined) return { dots: [], faint };
  const selection = app.session.getState().selection.keys;
  const byTime = new Map<number, { inBetween: boolean; selected: boolean; keys: KeyId[] }>();
  for (const curve of app.store.query.curvesOfClip(ctx.clip.id)) {
    if (curve.layer !== base.id || !controls.has(curve.control)) continue;
    for (const key of app.store.query.keysOfCurve(curve.id)) {
      const t = Math.round(key.t * 1e6) / 1e6;
      let dot = byTime.get(t);
      if (dot === undefined) {
        dot = { inBetween: true, selected: false, keys: [] };
        byTime.set(t, dot);
      }
      if (key.breakdown !== true) dot.inBetween = false;
      if (selection.get(key.id)?.key === true) dot.selected = true;
      dot.keys.push(key.id);
    }
  }
  const dots = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frame, dot]): KeyDot => ({ frame, inBetween: dot.inBetween, selected: dot.selected, keys: dot.keys }));
  return { dots, faint };
}

/** The strip's horizontal mapping: frames of the visible span onto [x0, x1] (CSS px). */
export interface StripLayout {
  readonly x0: number;
  readonly x1: number;
  readonly start: Frame;
  readonly end: Frame;
}

/** The strip's gutter on each side (CSS px): a dot at either end stays a full target. */
export const STRIP_GUTTER = 14;

export function stripLayout(width: number, span: { readonly start: Frame; readonly end: Frame }): StripLayout {
  const end = span.end - span.start < 1 ? span.start + 1 : span.end;
  return { x0: STRIP_GUTTER, x1: Math.max(STRIP_GUTTER + 1, width - STRIP_GUTTER), start: span.start, end };
}

export function frameToX(layout: StripLayout, frame: Frame): number {
  return layout.x0 + ((frame - layout.start) / (layout.end - layout.start)) * (layout.x1 - layout.x0);
}

export function xToFrame(layout: StripLayout, x: number): Frame {
  return layout.start + ((x - layout.x0) / (layout.x1 - layout.x0)) * (layout.end - layout.start);
}

/** A frame clamped into the clip and onto whole frames (§10.3: keys always land on whole frames). */
export function snapFrame(frame: Frame, range: { readonly start: Frame; readonly end: Frame }): Frame {
  return Math.min(range.end, Math.max(range.start, Math.round(frame)));
}

/** The dot under x (within `radius` CSS px), the nearest one; -1 when none. */
export function dotAt(layout: StripLayout, dots: readonly KeyDot[], x: number, radius: number): number {
  let best = -1;
  let distance = radius;
  for (let i = 0; i < dots.length; i++) {
    const d = Math.abs(frameToX(layout, (dots[i] as KeyDot).frame) - x);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  }
  return best;
}

/** Beat ticks (§10.3): every 0.25 s, each on the whole frame nearest the beat; `major` every 0.5 s. */
export function beatTicks(
  range: { readonly start: Frame; readonly end: Frame },
  fps: Fps,
): readonly { readonly frame: Frame; readonly seconds: number; readonly major: boolean }[] {
  const perSecond = fps.num / fps.den;
  const out: { frame: Frame; seconds: number; major: boolean }[] = [];
  const first = Math.ceil((range.start / perSecond) * 4 - 1e-9);
  const last = Math.floor((range.end / perSecond) * 4 + 1e-9);
  for (let beat = first; beat <= last; beat++) {
    // `+ 0` turns a −0 (the first beat from a ceiling of −ε) into 0
    const seconds = beat / 4 + 0;
    out.push({ frame: Math.round(seconds * perSecond) + 0, seconds, major: beat % 2 === 0 });
  }
  return out;
}

/** "15 f" or "0.50 s" (§10.3 Settings › Time: frames by default, ST-T7-UNIT). */
export function timeText(frame: Frame, fps: Fps, units: TimeUnit): string {
  if (units === 'frames') return `${Math.round(frame)} f`;
  const seconds = (frame * fps.den) / fps.num;
  return `${seconds.toFixed(2)} s`;
}

/** A compact label for a ruler tick in seconds ("0", "0.5", "1 s"). */
export function tickLabel(seconds: number, last: boolean): string {
  const text = Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)));
  return last ? `${text} s` : text;
}

/**
 * The ruler's frame-label step (§10.3, ST-T7-UNIT): whole frames, the smallest step that leaves `minPx` between
 * labels at this zoom — 0 · 12 · 24 … for a rate twelve divides (24, 48 fps), 0 · 10 · 20 … otherwise (25, 30, 60 fps).
 */
export function frameStep(fps: Fps, pxPerFrame: number, minPx = 56): number {
  const rate = fps.num / fps.den;
  const dozens = Number.isInteger(rate) && rate % 12 === 0 && rate % 5 !== 0;
  // 1 2 3 6 12 24 48 … or 1 2 5 10 20 50 100 …
  const steps = dozens ? [1, 2, 3, 6] : [];
  for (let step = dozens ? 12 : 1; steps.length < 40; ) {
    steps.push(step);
    if (dozens) step *= 2;
    else step = String(step).startsWith('2') ? (step * 5) / 2 : step * 2;
  }
  return steps.find((step) => step * pxPerFrame >= minPx) ?? (steps.at(-1) as number);
}

/** The labelled frames of the ruler: the multiples of `step` inside the span. */
export function frameLabels(span: { readonly start: Frame; readonly end: Frame }, step: number): readonly number[] {
  const out: number[] = [];
  const first = Math.ceil(span.start / step - 1e-9) * step;
  for (let frame = first; frame <= span.end + 1e-9; frame += step) out.push(Math.round(frame) + 0);
  return out;
}

/** A ruler label in frames ("0", "12", "48 f" for the last one). */
export function frameLabel(frame: number, last: boolean): string {
  return last ? `${frame} f` : String(frame);
}

/**
 * The two keys the playhead sits between (§10.3 Blend chip): the nearest dots before and after it, when no dot is
 * on it; null otherwise.
 */
export function between(
  dots: readonly KeyDot[],
  frame: Frame,
): { readonly before: Frame; readonly after: Frame } | null {
  let before: number | null = null;
  let after: number | null = null;
  for (const dot of dots) {
    if (Math.abs(dot.frame - frame) < 0.5) return null;
    if (dot.frame < frame) before = dot.frame;
    else if (after === null) after = dot.frame;
  }
  return before === null || after === null ? null : { before, after };
}
