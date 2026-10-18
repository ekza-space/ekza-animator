// Curve painter (ADR 0007 §3–4): exact cubic Béziers via bezierCurveTo from the compiled handles, lineTo for linear
// and stepped spans, a per-pixel sampled polyline for curves with more than one key per pixel, and dotted infinity
// regions drawn by repeating (cycle, cycle-offset, oscillate) or extending (constant, linear) the key range.
import { Segment, type SegmentKind } from '@ekza-animator/anim-core';
import { type CurveEntry, drawnOf } from '../graph/curveSet';
import {
  drawnValueAt,
  type InfinityMapping,
  newInfinityMapping,
  segmentBezier,
  segmentKind,
  visibleRange,
} from '../graph/geometry';
import type { GraphScene } from '../graph/scene';
import { frameToX, valueToY, xToFrame } from '../view/transform';
import { GRAPH_METRICS } from './theme';

/** Affine (frame, value) → screen map of one drawn copy of the key range. */
interface CopyMap {
  /** F = flip ? (mirrorSum − t) + shift : t + shift */
  shift: number;
  flip: boolean;
  mirrorSum: number;
  offset: number;
}

/** Reusable buffers of the painter (convention 5: no allocation in inner loops). */
export class CurvePainterScratch {
  readonly bezier = new Float64Array(8);
  readonly mapping: InfinityMapping = newInfinityMapping();
  readonly copy: CopyMap = { shift: 0, flip: false, mirrorSum: 0, offset: 0 };
}

const IDENTITY: CopyMap = { shift: 0, flip: false, mirrorSum: 0, offset: 0 };

const mapFrame = (copy: CopyMap, t: number): number => (copy.flip ? copy.mirrorSum - t + copy.shift : t + copy.shift);

/**
 * Appends segments [lo, hi) of the key range, mapped by `copy`, to `path` (which must already be at key lo). The view
 * transform is written out inline, with the operations of `frameToX` and `valueToY` in their order (same numbers):
 * these loops run for every dragged curve on every frame of a drag (M-1), where calls are what costs.
 */
function traceSegments(
  path: Path2D,
  scene: GraphScene,
  entry: CurveEntry,
  lo: number,
  hi: number,
  copy: CopyMap,
  b: Float64Array,
): void {
  const c = entry.compiled;
  const { f0, v0: view0, sx, sy } = scene.view;
  const height = scene.height;
  const k = entry.scale;
  const o = entry.offset;
  const flip = copy.flip;
  const shift = copy.shift;
  const mirrorSum = copy.mirrorSum;
  const offset = copy.offset;
  const ct = c.t;
  const cv = c.v;
  const segment = c.segment;
  for (let i = lo; i < hi; i++) {
    const t0 = ct[i] as number;
    const v0 = cv[i] as number;
    const t1 = ct[i + 1] as number;
    const v1 = cv[i + 1] as number;
    switch (segment[i] as SegmentKind) {
      case Segment.Step: {
        const x1 = ((flip ? mirrorSum - t1 + shift : t1 + shift) - f0) * sx;
        path.lineTo(x1, height - ((v0 + offset) * k + o - view0) * sy);
        path.lineTo(x1, height - ((v1 + offset) * k + o - view0) * sy);
        break;
      }
      case Segment.StepNext: {
        const y1 = height - ((v1 + offset) * k + o - view0) * sy;
        path.lineTo(((flip ? mirrorSum - t0 + shift : t0 + shift) - f0) * sx, y1);
        path.lineTo(((flip ? mirrorSum - t1 + shift : t1 + shift) - f0) * sx, y1);
        break;
      }
      case Segment.Linear:
        path.lineTo(
          ((flip ? mirrorSum - t1 + shift : t1 + shift) - f0) * sx,
          height - ((v1 + offset) * k + o - view0) * sy,
        );
        break;
      case Segment.Hermite:
      case Segment.Bezier: {
        segmentBezier(c, i, b);
        const bx1 = b[2] as number;
        const bx2 = b[4] as number;
        const bx3 = b[6] as number;
        path.bezierCurveTo(
          ((flip ? mirrorSum - bx1 + shift : bx1 + shift) - f0) * sx,
          height - (((b[3] as number) + offset) * k + o - view0) * sy,
          ((flip ? mirrorSum - bx2 + shift : bx2 + shift) - f0) * sx,
          height - (((b[5] as number) + offset) * k + o - view0) * sy,
          ((flip ? mirrorSum - bx3 + shift : bx3 + shift) - f0) * sx,
          height - (((b[7] as number) + offset) * k + o - view0) * sy,
        );
        break;
      }
    }
  }
}

/** Mirrored copies are traced backwards so the path stays continuous: segments (hi−1 … lo) reversed. */
function traceSegmentsReversed(
  path: Path2D,
  scene: GraphScene,
  entry: CurveEntry,
  lo: number,
  hi: number,
  copy: CopyMap,
  b: Float64Array,
): void {
  const c = entry.compiled;
  const { view, height } = scene;
  const k = entry.scale;
  const o = entry.offset;
  const x = (t: number) => frameToX(view, mapFrame(copy, t));
  const y = (v: number) => valueToY(view, height, (v + copy.offset) * k + o);
  for (let i = hi - 1; i >= lo; i--) {
    const t0 = c.t[i] as number;
    const v0 = c.v[i] as number;
    const t1 = c.t[i + 1] as number;
    const v1 = c.v[i + 1] as number;
    switch (segmentKind(c, i)) {
      case Segment.Step:
        path.lineTo(x(t1), y(v0));
        path.lineTo(x(t0), y(v0));
        break;
      case Segment.StepNext:
        path.lineTo(x(t0), y(v1));
        path.lineTo(x(t0), y(v0));
        break;
      case Segment.Linear:
        path.lineTo(x(t0), y(v0));
        break;
      case Segment.Hermite:
      case Segment.Bezier:
        segmentBezier(c, i, b);
        path.bezierCurveTo(
          x(b[4] as number),
          y(b[5] as number),
          x(b[2] as number),
          y(b[3] as number),
          x(b[0] as number),
          y(b[1] as number),
        );
        break;
    }
  }
}

/** True when the curve has more than one visible key per pixel of its visible key range. */
export function isDense(scene: GraphScene, entry: CurveEntry): boolean {
  const c = entry.compiled;
  if (c.keyCount < 3) return false;
  const f0 = xToFrame(scene.view, 0);
  const f1 = xToFrame(scene.view, scene.width);
  const [lo, hi] = visibleRange(c, f0, f1);
  const x0 = Math.max(0, frameToX(scene.view, c.t[lo] as number));
  const x1 = Math.min(scene.width, frameToX(scene.view, c.t[hi] as number));
  return hi - lo + 1 > Math.max(1, x1 - x0);
}

/** Path of the curve inside its key range (exact or sampled). */
export function keyRangePath(scene: GraphScene, entry: CurveEntry, scratch: CurvePainterScratch): Path2D {
  const path = new Path2D();
  const c = entry.compiled;
  if (c.keyCount === 0) return path;
  const f0 = xToFrame(scene.view, 0);
  const f1 = xToFrame(scene.view, scene.width);
  if (c.keyCount === 1) {
    const x = frameToX(scene.view, c.t[0] as number);
    const y = valueToY(scene.view, scene.height, drawnOf(entry, c.v[0] as number));
    path.moveTo(x, y);
    path.lineTo(x, y);
    return path;
  }
  if (isDense(scene, entry)) {
    traceSampled(
      path,
      scene,
      entry,
      scratch,
      Math.max(f0, c.t[0] as number),
      Math.min(f1, c.t[c.keyCount - 1] as number),
    );
    return path;
  }
  const [lo, hi] = visibleRange(c, f0, f1);
  path.moveTo(
    frameToX(scene.view, c.t[lo] as number),
    valueToY(scene.view, scene.height, drawnOf(entry, c.v[lo] as number)),
  );
  traceSegments(path, scene, entry, lo, hi, IDENTITY, scratch.bezier);
  return path;
}

/**
 * Per-pixel polyline through the drawn curve between frames fa and fb, with each column's key extremes added so
 * spikes narrower than a pixel survive.
 */
function traceSampled(
  path: Path2D,
  scene: GraphScene,
  entry: CurveEntry,
  scratch: CurvePainterScratch,
  fa: number,
  fb: number,
): void {
  const { view, height } = scene;
  const c = entry.compiled;
  const k = entry.scale;
  const o = entry.offset;
  const xa = Math.floor(frameToX(view, fa));
  const xb = Math.ceil(frameToX(view, fb));
  let key = 0;
  while (key < c.keyCount && (c.t[key] as number) < fa) key++;
  let started = false;
  for (let x = xa; x <= xb; x++) {
    const frame = Math.min(Math.max(xToFrame(view, x), fa), fb);
    const y = valueToY(view, height, drawnValueAt(c, frame, scratch.bezier, scratch.mapping) * k + o);
    if (started) path.lineTo(x, y);
    else path.moveTo(x, y);
    started = true;
    const columnEnd = xToFrame(view, x + 1);
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    while (key < c.keyCount && (c.t[key] as number) < columnEnd && (c.t[key] as number) <= fb) {
      const ky = valueToY(view, height, (c.v[key] as number) * k + o);
      if (ky < minY) minY = ky;
      if (ky > maxY) maxY = ky;
      key++;
    }
    if (minY <= maxY) {
      path.lineTo(x, minY);
      path.lineTo(x, maxY);
    }
  }
}

/** Dotted infinity regions before the first and after the last key. */
export function infinityPath(scene: GraphScene, entry: CurveEntry, scratch: CurvePainterScratch): Path2D {
  const path = new Path2D();
  const c = entry.compiled;
  const n = c.keyCount;
  if (n === 0) return path;
  const { view, width, height } = scene;
  const k = entry.scale;
  const o = entry.offset;
  const first = c.t[0] as number;
  const last = c.t[n - 1] as number;
  const fMin = xToFrame(view, 0);
  const fMax = xToFrame(view, width);
  const y = (v: number) => valueToY(view, height, v * k + o);
  const span = last - first;

  if (fMin < first) {
    if (c.pre === 'linear' || c.pre === 'constant' || n === 1 || !(span > 0)) {
      const slope = c.pre === 'linear' ? (c.inSlope[0] as number) : 0;
      path.moveTo(0, y((c.v[0] as number) + (fMin - first) * slope));
      path.lineTo(frameToX(view, first), y(c.v[0] as number));
    } else {
      traceCycles(path, scene, entry, scratch, Math.floor((fMin - first) / span), -1, fMin, Math.min(fMax, first));
    }
  }
  if (fMax > last) {
    if (c.post === 'linear' || c.post === 'constant' || n === 1 || !(span > 0)) {
      const slope = c.post === 'linear' ? (c.outSlope[n - 1] as number) : 0;
      path.moveTo(frameToX(view, last), y(c.v[n - 1] as number));
      path.lineTo(width, y((c.v[n - 1] as number) + (fMax - last) * slope));
    } else {
      traceCycles(path, scene, entry, scratch, 1, Math.floor((fMax - first) / span), Math.max(fMin, last), fMax);
    }
  }
  return path;
}

/** Copies kFrom…kTo of the key range for a cycle mode, clipped to frames [fa, fb]. */
function traceCycles(
  path: Path2D,
  scene: GraphScene,
  entry: CurveEntry,
  scratch: CurvePainterScratch,
  kFrom: number,
  kTo: number,
  fa: number,
  fb: number,
): void {
  const c = entry.compiled;
  const n = c.keyCount;
  const first = c.t[0] as number;
  const last = c.t[n - 1] as number;
  const span = last - first;
  const before = kTo < 0;
  const mode = before ? c.pre : c.post;
  const cycles = kTo - kFrom + 1;
  // Too many repeated segments for the width: sample per pixel instead (same geometry, bounded cost).
  if (cycles <= 0) return;
  if (cycles * (n - 1) > 4 * Math.max(scene.width, 1) || cycles > 512) {
    traceSampled(path, scene, entry, scratch, fa, fb);
    return;
  }
  const copy = scratch.copy;
  const { view, height } = scene;
  const k = entry.scale;
  const o = entry.offset;
  for (let cycle = kFrom; cycle <= kTo; cycle++) {
    copy.flip = mode === 'oscillate' && cycle % 2 !== 0;
    copy.shift = cycle * span;
    copy.mirrorSum = first + last;
    copy.offset = mode === 'cycleOffset' ? cycle * ((c.v[n - 1] as number) - (c.v[0] as number)) : 0;
    // In-range frames whose copy is visible.
    const lo = copy.flip ? first + last - (fb - copy.shift) : fa - copy.shift;
    const hi = copy.flip ? first + last - (fa - copy.shift) : fb - copy.shift;
    const [a, b] = visibleRange(c, lo, hi);
    if (a >= b) continue;
    const startKey = copy.flip ? b : a;
    path.moveTo(
      frameToX(view, mapFrame(copy, c.t[startKey] as number)),
      valueToY(view, height, ((c.v[startKey] as number) + copy.offset) * k + o),
    );
    if (copy.flip) traceSegmentsReversed(path, scene, entry, a, b, copy, scratch.bezier);
    else traceSegments(path, scene, entry, a, b, copy, scratch.bezier);
  }
}

/** Path of the segments whose both keys are selected (drawn wider on top of the curve). */
export function selectedSegmentsPath(
  scene: GraphScene,
  entry: CurveEntry,
  scratch: CurvePainterScratch,
): Path2D | null {
  const c = entry.compiled;
  if (c.keyCount < 2 || scene.selection.size === 0) return null;
  const f0 = xToFrame(scene.view, 0);
  const f1 = xToFrame(scene.view, scene.width);
  const [lo, hi] = visibleRange(c, f0, f1);
  const selection = scene.selection;
  const isSelected = (i: number): boolean => {
    const key = entry.keys[i];
    return key !== undefined && selection.get(key.id)?.key === true;
  };
  let path: Path2D | null = null;
  // Runs of segments whose keys are all selected, each traced in one go (one key lookup per key).
  let i = lo;
  let previous = i < hi && isSelected(i);
  while (i < hi) {
    if (!previous) {
      i++;
      previous = isSelected(i);
      continue;
    }
    let j = i;
    let next = isSelected(j + 1);
    while (next && j < hi) {
      j++;
      next = j < hi && isSelected(j + 1);
    }
    if (j > i) {
      path ??= new Path2D();
      path.moveTo(
        frameToX(scene.view, c.t[i] as number),
        valueToY(scene.view, scene.height, drawnOf(entry, c.v[i] as number)),
      );
      traceSegments(path, scene, entry, i, j, IDENTITY, scratch.bezier);
    }
    // key j is the last selected key of the run; key j + 1 (if any) is not selected
    i = j + 1;
    previous = false;
  }
  return path;
}

/** Which entries a painter draws (M-1 mechanism 5: the static layer and the dragged curves are painted apart). */
export type EntryFilter = ((entry: CurveEntry) => boolean) | null;

export function paintCurves(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  scratch: CurvePainterScratch,
  include: EntryFilter = null,
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // Inactive curves first, so the focused ones draw on top.
  for (const pass of [false, true]) {
    for (const entry of scene.curves.entries) {
      if (include !== null && !include(entry)) continue;
      const active = scene.focus === null || scene.focus.has(entry.id);
      if (active !== pass) continue;
      ctx.strokeStyle = entry.color;
      ctx.globalAlpha = active ? 1 : GRAPH_METRICS.inactiveAlpha;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.stroke(infinityPath(scene, entry, scratch));
      ctx.setLineDash(entry.locked ? [6, 3] : []);
      ctx.lineWidth = GRAPH_METRICS.curveWidth;
      ctx.stroke(keyRangePath(scene, entry, scratch));
      const selected = selectedSegmentsPath(scene, entry, scratch);
      if (selected !== null) {
        ctx.setLineDash([]);
        ctx.lineWidth = GRAPH_METRICS.selectedSegmentWidth;
        ctx.stroke(selected);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/**
 * Buffer curves (M2A-SPEC §5.15.1): the buffer of each shown curve as a dashed line in `--curve-buffer`, exact Bézier
 * through the same view mapping as its curve, drawn behind the curves.
 */
export function paintBuffers(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  scratch: CurvePainterScratch,
  color: string,
): void {
  if (scene.buffers.size === 0) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 1;
  for (const entry of scene.curves.entries) {
    const compiled = scene.buffers.get(entry.id);
    if (compiled === undefined || compiled.keyCount === 0) continue;
    const buffer: CurveEntry = { ...entry, compiled, keys: [], index: new Map() };
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.stroke(infinityPath(scene, buffer, scratch));
    ctx.lineWidth = GRAPH_METRICS.curveWidth;
    ctx.setLineDash([6, 4]);
    ctx.stroke(keyRangePath(scene, buffer, scratch));
  }
  ctx.setLineDash([]);
}
