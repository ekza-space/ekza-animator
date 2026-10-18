// Graph Editor hit-testing (MVP-SPEC §4.11.18, ADR 0007 §5): selected handle > key > handle > curve segment > empty,
// with tolerances of 5 / 6 / 5 / 4 CSS px. Locked curves are drawn but never hit. Where keys or curves overlap (e.g.
// several flat channels through one point), the one drawn on top wins: what is hit is what is seen. Marquee queries
// return the keys (or, when no key is inside, the shown handles) inside a rectangle.
import { Segment } from '@ekza-animator/anim-core';
import type { KeyId } from '@ekza-animator/doc';
import { type CurveEntry, drawnOf } from '../graph/curveSet';
import { lowerBound, segmentBezier, segmentKind, segmentValueAt, visibleRange } from '../graph/geometry';
import { type GraphScene, handlePosition, handlesShown, keyX, keyY, type Point } from '../graph/scene';
import { GRAPH_METRICS } from '../painters/theme';
import type { GraphHit } from '../types';
import { frameToX, valueToY, xToFrame, yToValue } from '../view/transform';

/**
 * Candidates whose distances differ by at most this many CSS px are a tie, won by the one drawn on top. It absorbs
 * the curve flattening error, so a curve crossing others at the probed point is found whichever is evaluated first.
 */
export const HIT_TIE_PX = 0.5;

export class HitScratch {
  readonly bezier = new Float64Array(8);
  readonly point: Point = { x: 0, y: 0 };
  /** Per-curve nearest distance and the index (key or segment) it was found at, in `scene.curves.entries` order. */
  distance = new Float64Array(16);
  index = new Int32Array(16);

  reserve(n: number): void {
    if (this.distance.length >= n) return;
    const size = Math.max(n, this.distance.length * 2);
    this.distance = new Float64Array(size);
    this.index = new Int32Array(size);
  }
}

/**
 * The candidate drawn on top among the nearest ones: entries whose `distance` is within HIT_TIE_PX of the smallest,
 * ranked by `rank` (higher draws later), later entries winning equal ranks. -1 when no entry is within `tolerance`.
 */
function topmostNearest(
  scratch: HitScratch,
  count: number,
  tolerance: number,
  rank: (entry: number) => number,
): number {
  let min = Number.POSITIVE_INFINITY;
  for (let e = 0; e < count; e++) min = Math.min(min, scratch.distance[e] as number);
  if (!(min <= tolerance)) return -1;
  let best = -1;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (let e = 0; e < count; e++) {
    const d = scratch.distance[e] as number;
    if (d > min + HIT_TIE_PX || d > tolerance) continue;
    const r = rank(e);
    if (r >= bestRank) {
      best = e;
      bestRank = r;
    }
  }
  return best;
}

/** Focused curves are drawn after (on top of) the others (painters/curves.ts). */
const curveRank = (scene: GraphScene, entry: CurveEntry): number =>
  scene.focus === null || scene.focus.has(entry.id) ? 1 : 0;

/**
 * Calls `visit(entry, index)`, in drawing order, for every key whose handles are shown (and hittable) and can reach
 * the screen interval [x0, x1] (CSS px): the keys `paintHandles` draws (the canvas widened by one handle length,
 * plus the neighbours a weighted handle can reach, see `visibleRange`) within one handle length of the interval.
 * The cost follows the keys near the interval, not the size of the selection or of the curves.
 */
function forEachShownHandleKey(
  scene: GraphScene,
  x0: number,
  x1: number,
  visit: (entry: CurveEntry, index: number) => void,
): void {
  const reach = GRAPH_METRICS.handleLength;
  const f0 = xToFrame(scene.view, Math.max(x0, 0) - reach);
  const f1 = xToFrame(scene.view, Math.min(x1, scene.width) + reach);
  if (!(f0 <= f1)) return;
  for (const entry of scene.curves.entries) {
    if (entry.locked) continue;
    const [lo, hi] = visibleRange(entry.compiled, f0, f1);
    for (let i = lo; i <= hi; i++) if (handlesShown(scene, entry, i)) visit(entry, i);
  }
}

interface Best {
  distance: number;
  entry: CurveEntry | null;
  index: number;
  side: 'in' | 'out';
}

function nearestHandle(scene: GraphScene, x: number, y: number, selectedOnly: boolean, scratch: HitScratch): Best {
  const best: Best = { distance: GRAPH_METRICS.hitHandle, entry: null, index: -1, side: 'in' };
  forEachShownHandleKey(scene, x - best.distance, x + best.distance, (entry, i) => {
    const key = entry.keys[i];
    if (key === undefined) return;
    const parts = scene.selection.get(key.id);
    for (const side of ['in', 'out'] as const) {
      if (selectedOnly && parts?.[side] !== true) continue;
      const p = handlePosition(scene, entry, i, side, scratch.point);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= best.distance) {
        best.distance = d;
        best.entry = entry;
        best.index = i;
        best.side = side;
      }
    }
  });
  return best;
}

function nearestKey(scene: GraphScene, x: number, y: number, scratch: HitScratch): Best {
  const best: Best = { distance: Number.POSITIVE_INFINITY, entry: null, index: -1, side: 'in' };
  const tolerance = GRAPH_METRICS.hitKey;
  const f0 = xToFrame(scene.view, x - tolerance);
  const f1 = xToFrame(scene.view, x + tolerance);
  const entries = scene.curves.entries;
  scratch.reserve(entries.length);
  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e] as CurveEntry;
    scratch.distance[e] = Number.POSITIVE_INFINITY;
    scratch.index[e] = -1;
    if (entry.locked) continue;
    const c = entry.compiled;
    for (let i = lowerBound(c, f0); i < c.keyCount && (c.t[i] as number) <= f1; i++) {
      const d = Math.hypot(keyX(scene, entry, i) - x, keyY(scene, entry, i) - y);
      if (d < (scratch.distance[e] as number)) {
        scratch.distance[e] = d;
        scratch.index[e] = i;
      }
    }
  }
  // Selected keys are drawn on top of the others (painters/keys.ts).
  const winner = topmostNearest(scratch, entries.length, tolerance, (e) => {
    const entry = entries[e] as CurveEntry;
    const key = entry.keys[scratch.index[e] as number];
    return key !== undefined && scene.selection.get(key.id)?.key === true ? 1 : 0;
  });
  if (winner === -1) return best;
  best.distance = scratch.distance[winner] as number;
  best.entry = entries[winner] as CurveEntry;
  best.index = scratch.index[winner] as number;
  return best;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / length2, 0), 1) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/** Screen distance from (x, y) to segment i of the drawn curve, flattened into a polyline. */
function segmentDistance(
  scene: GraphScene,
  entry: CurveEntry,
  i: number,
  x: number,
  y: number,
  b: Float64Array,
): number {
  const c = entry.compiled;
  const { view, height } = scene;
  const k = entry.scale;
  const o = entry.offset;
  const sx = (t: number) => frameToX(view, t);
  const sy = (v: number) => valueToY(view, height, v * k + o);
  const t0 = c.t[i] as number;
  const v0 = c.v[i] as number;
  const t1 = c.t[i + 1] as number;
  const v1 = c.v[i + 1] as number;
  switch (segmentKind(c, i)) {
    case Segment.Step:
      return Math.min(
        distanceToSegment(x, y, sx(t0), sy(v0), sx(t1), sy(v0)),
        distanceToSegment(x, y, sx(t1), sy(v0), sx(t1), sy(v1)),
      );
    case Segment.StepNext:
      return Math.min(
        distanceToSegment(x, y, sx(t0), sy(v0), sx(t0), sy(v1)),
        distanceToSegment(x, y, sx(t0), sy(v1), sx(t1), sy(v1)),
      );
    case Segment.Linear:
      return distanceToSegment(x, y, sx(t0), sy(v0), sx(t1), sy(v1));
    case Segment.Hermite:
    case Segment.Bezier: {
      segmentBezier(c, i, b);
      const x0 = sx(b[0] as number);
      const y0 = sy(b[1] as number);
      const x1 = sx(b[2] as number);
      const y1 = sy(b[3] as number);
      const x2 = sx(b[4] as number);
      const y2 = sy(b[5] as number);
      const x3 = sx(b[6] as number);
      const y3 = sy(b[7] as number);
      const polygon = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const steps = Math.min(Math.max(Math.ceil(polygon / 3), 4), 256);
      let best = Number.POSITIVE_INFINITY;
      let ax = x0;
      let ay = y0;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const w = 1 - u;
        const bx = w * w * w * x0 + 3 * w * w * u * x1 + 3 * w * u * u * x2 + u * u * u * x3;
        const by = w * w * w * y0 + 3 * w * w * u * y1 + 3 * w * u * u * y2 + u * u * u * y3;
        const d = distanceToSegment(x, y, ax, ay, bx, by);
        if (d < best) best = d;
        ax = bx;
        ay = by;
      }
      return best;
    }
  }
}

function nearestCurve(
  scene: GraphScene,
  x: number,
  y: number,
  scratch: HitScratch,
): { distance: number; entry: CurveEntry | null; segment: number } {
  const best: { distance: number; entry: CurveEntry | null; segment: number } = {
    distance: Number.POSITIVE_INFINITY,
    entry: null,
    segment: -1,
  };
  const tolerance = GRAPH_METRICS.hitCurve;
  const f0 = xToFrame(scene.view, x - tolerance);
  const f1 = xToFrame(scene.view, x + tolerance);
  const entries = scene.curves.entries;
  scratch.reserve(entries.length);
  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e] as CurveEntry;
    scratch.distance[e] = Number.POSITIVE_INFINITY;
    scratch.index[e] = -1;
    if (entry.locked) continue;
    const c = entry.compiled;
    if (c.keyCount < 2) continue;
    const [lo, hi] = visibleRange(c, f0, f1);
    for (let i = lo; i < hi; i++) {
      if ((c.t[i + 1] as number) < f0 || (c.t[i] as number) > f1) continue;
      const d = segmentDistance(scene, entry, i, x, y, scratch.bezier);
      if (d < (scratch.distance[e] as number)) {
        scratch.distance[e] = d;
        scratch.index[e] = i;
      }
    }
  }
  const winner = topmostNearest(scratch, entries.length, tolerance, (e) => curveRank(scene, entries[e] as CurveEntry));
  if (winner === -1) return best;
  best.distance = scratch.distance[winner] as number;
  best.entry = entries[winner] as CurveEntry;
  best.segment = scratch.index[winner] as number;
  return best;
}

export function hitTestScene(scene: GraphScene, x: number, y: number, scratch: HitScratch): GraphHit {
  const selectedHandle = nearestHandle(scene, x, y, true, scratch);
  if (selectedHandle.entry !== null) {
    const key = selectedHandle.entry.keys[selectedHandle.index] as { id: KeyId };
    return { kind: 'handle', key: key.id, curve: selectedHandle.entry.id, side: selectedHandle.side };
  }
  const key = nearestKey(scene, x, y, scratch);
  if (key.entry !== null) {
    const record = key.entry.keys[key.index] as { id: KeyId };
    return { kind: 'key', key: record.id, curve: key.entry.id };
  }
  const handle = nearestHandle(scene, x, y, false, scratch);
  if (handle.entry !== null) {
    const record = handle.entry.keys[handle.index] as { id: KeyId };
    return { kind: 'handle', key: record.id, curve: handle.entry.id, side: handle.side };
  }
  const frame = xToFrame(scene.view, x);
  const curve = nearestCurve(scene, x, y, scratch);
  if (curve.entry !== null) {
    const c = curve.entry.compiled;
    const clamped = Math.min(Math.max(frame, c.t[curve.segment] as number), c.t[curve.segment + 1] as number);
    const value = drawnOf(curve.entry, segmentValueAt(c, curve.segment, clamped, scratch.bezier));
    return { kind: 'curve', curve: curve.entry.id, frame, value };
  }
  return { kind: 'none', frame, value: yToValue(scene.view, scene.height, y) };
}

export interface ScreenRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const normalized = (r: ScreenRect): ScreenRect => ({
  x0: Math.min(r.x0, r.x1),
  y0: Math.min(r.y0, r.y1),
  x1: Math.max(r.x0, r.x1),
  y1: Math.max(r.y0, r.y1),
});

/** Keys of hittable curves whose centre lies inside the rectangle (CSS px), in curve then time order. */
export function keysInRect(scene: GraphScene, rect: ScreenRect): KeyId[] {
  const r = normalized(rect);
  const f0 = xToFrame(scene.view, r.x0);
  const f1 = xToFrame(scene.view, r.x1);
  const keys: KeyId[] = [];
  for (const entry of scene.curves.entries) {
    if (entry.locked) continue;
    const c = entry.compiled;
    for (let i = lowerBound(c, f0); i < c.keyCount && (c.t[i] as number) <= f1; i++) {
      const y = keyY(scene, entry, i);
      const key = entry.keys[i];
      if (key !== undefined && y >= r.y0 && y <= r.y1) keys.push(key.id);
    }
  }
  return keys;
}

/** Shown handles whose end lies inside the rectangle. */
export function handlesInRect(
  scene: GraphScene,
  rect: ScreenRect,
  scratch: HitScratch,
): { readonly key: KeyId; readonly side: 'in' | 'out' }[] {
  const r = normalized(rect);
  const handles: { key: KeyId; side: 'in' | 'out' }[] = [];
  forEachShownHandleKey(scene, r.x0, r.x1, (entry, i) => {
    const key = entry.keys[i];
    if (key === undefined) return;
    for (const side of ['in', 'out'] as const) {
      const p = handlePosition(scene, entry, i, side, scratch.point);
      if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) handles.push({ key: key.id, side });
    }
  });
  return handles;
}
