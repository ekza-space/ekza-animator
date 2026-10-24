// The Thread's layer 0, as data (STUDIO-TOUCH-SPEC §10.3; T7): what the strip shows — the active animation's range in
// its own frames, the playhead, the key marks of the selection (a faint summary row when nothing is selected; in-betweens
// apart), the band, the ruler's ticks (one per frame) and numbers — and how a point on it maps to a frame.
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

/** "15 f" or "0.50 s" (§10.3 Settings › Time: frames by default, ST-T7-UNIT). */
export function timeText(frame: Frame, fps: Fps, units: TimeUnit): string {
  if (units === 'frames') return `${Math.round(frame)} f`;
  const seconds = (frame * fps.den) / fps.num;
  return `${seconds.toFixed(2)} s`;
}

/** Ticks closer than this (CSS px) fall back to every 2nd, then every 5th frame (ST-T10-RULER). */
export const MIN_TICK_PX = 3;
/** The gap kept between two ruler labels (CSS px). */
export const LABEL_GAP = 6;
/** The room the number step leaves between labels beyond their width (CSS px): calm, never crowded. */
const STEP_ROOM = 14;
/** A label sits this far right of its tick (Studio Pro's time slider draws it so). */
export const LABEL_OFFSET = 3;

/** Frames between numbered ticks: every frame at a high zoom, then every 5th, 10th, 20th, 50th … */
const FRAME_LABEL_STEPS = [1, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
/** Seconds between numbered ticks under Settings › Time *Seconds* (kept where they fall on whole frames). */
const SECOND_LABEL_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600] as const;
/** Tick steps (frames), each a divisor of the label step it goes with: every frame, then every 2nd, then 5th … */
const TICK_STEPS = [1, 2, 3, 5, 6, 10, 12, 15, 20, 24, 25, 30, 50, 60, 100, 120, 200, 500, 1000] as const;

/** A tick of the ruler: `level` 2 is a numbered (major) tick, 1 a half step between two, 0 a frame. */
export interface RulerTick {
  readonly frame: Frame;
  readonly level: 0 | 1 | 2;
}

/** A ruler label, placed: its left edge and width in CSS px (never overlapping another). */
export interface RulerLabel {
  readonly frame: Frame;
  readonly text: string;
  readonly left: number;
  readonly width: number;
}

export interface RulerMarks {
  /** Frames between ticks: 1 (a tick on every frame), or 2, 5 … when frames are closer than `MIN_TICK_PX`. */
  readonly tickStep: number;
  /** Frames between numbered ticks. */
  readonly labelStep: number;
  readonly ticks: readonly RulerTick[];
  readonly labels: readonly RulerLabel[];
}

/** A ruler number in seconds ("0", "0.5", "1.25"). */
export function secondsLabel(frame: Frame, fps: Fps): string {
  const seconds = (frame * fps.den) / fps.num;
  const text = String(Number(seconds.toFixed(2)));
  return text === '-0' ? '0' : text;
}

/**
 * The ruler (§10.3, ST-T10-RULER — owner 2026-10-24: "a tick on every frame"): a tick on every frame of the visible
 * span, or on every 2nd, then 5th … frame when frames are closer than `MIN_TICK_PX`; numbers on the major ticks —
 * every frame when there is room, else every 5th, 10th, 20th … frame (under *Seconds*: every 0.1, 0.25, 0.5, 1 … s
 * that falls on a whole frame); the first and last frame of `range` always numbered; labels never overlap (a number
 * that would collide with a kept one is left out). Labels sit right of their tick, as on Studio Pro's time slider; a
 * label that would leave the strip sits left of its tick. `measure` gives a label's width in CSS px. Pure.
 */
export function rulerMarks(
  layout: StripLayout,
  width: number,
  range: { readonly start: Frame; readonly end: Frame },
  fps: Fps,
  units: TimeUnit,
  measure: (text: string) => number,
): RulerMarks {
  const perFrame = (layout.x1 - layout.x0) / Math.max(1e-6, layout.end - layout.start);
  const rate = fps.num / fps.den;
  const first = Math.ceil(layout.start - 1e-9);
  const last = Math.floor(layout.end + 1e-9);
  const textOf = (frame: number, isLast: boolean): string => {
    if (units === 'frames') return String(frame);
    const text = secondsLabel(frame, fps);
    return isLast ? `${text} s` : text;
  };
  // the room a number needs: the widest one of the span, and a gap
  const widest = Math.max(measure(textOf(first, false)), measure(textOf(last, true)));
  const room = widest + STEP_ROOM;
  const steps =
    units === 'frames'
      ? [...FRAME_LABEL_STEPS]
      : SECOND_LABEL_STEPS.map((s) => s * rate).filter((f) => Math.abs(f - Math.round(f)) < 1e-9 && f >= 1);
  const labelStep = Math.round(steps.find((step) => step * perFrame >= room) ?? (steps.at(-1) as number));
  const tickStep = TICK_STEPS.find((step) => labelStep % step === 0 && step * perFrame >= MIN_TICK_PX) ?? labelStep;
  const half = labelStep % 2 === 0 && (labelStep / 2) % tickStep === 0 && labelStep >= 10 ? labelStep / 2 : null;
  const ticks: RulerTick[] = [];
  for (let frame = Math.ceil(first / tickStep) * tickStep; frame <= last; frame += tickStep) {
    const level = frame % labelStep === 0 ? 2 : half !== null && frame % half === 0 ? 1 : 0;
    ticks.push({ frame: frame + 0, level });
  }
  // the numbers: the range's first and last frame always, then the majors left to right where they fit
  const place = (frame: number, isLast: boolean): RulerLabel => {
    const text = textOf(frame, isLast);
    const w = measure(text);
    const x = frameToX(layout, frame);
    const left = x + LABEL_OFFSET + w > width - 1 ? x - LABEL_OFFSET - w : x + LABEL_OFFSET;
    return { frame, text, left, width: w };
  };
  const visible = (frame: number): boolean => frame >= first && frame <= last;
  const kept: RulerLabel[] = [];
  const startFrame = Math.round(range.start);
  const endFrame = Math.round(range.end);
  if (visible(startFrame)) kept.push(place(startFrame, endFrame === startFrame));
  if (visible(endFrame) && endFrame !== startFrame) kept.push(place(endFrame, true));
  const clear = (label: RulerLabel): boolean =>
    kept.every(
      (other) =>
        label.left + label.width + LABEL_GAP <= other.left || other.left + other.width + LABEL_GAP <= label.left,
    );
  for (let frame = Math.ceil(first / labelStep) * labelStep; frame <= last; frame += labelStep) {
    if (frame === startFrame || frame === endFrame) continue;
    const label = place(frame + 0, false);
    if (clear(label)) kept.push(label);
  }
  kept.sort((a, b) => a.frame - b.frame);
  return { tickStep, labelStep, ticks, labels: kept };
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
