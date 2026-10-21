// C6 (with the C5 MVP subset; M6B-SPEC §4.2, §5.11): the paint stroke. One function serves the live preview and the
// commit: `beginStroke` keeps private copies of the skin, `addStamp` updates only the points of the stamp (and their
// mirror partners), and `editWeights({kind: 'stroke'})` / `{kind: 'flood'}` run the same session over every stamp, so
// `finish()` is bit-identical to the batch edit by construction (P-S2).
//
// Stroke rule (§5.11): Replace, Add and Scale keep the per-point maximum strength `s_max` over the stroke's stamps and
// apply the op once to the stroke-start weights (overlapping stamps never compound); Smooth applies per stamp, in stamp
// order, on the stroke's current values. Every op then goes through §5.10 (`setActive`, holds, 4 influences).
//
// X-mirror (§5.11): a point `v` with strength `s` also applies the op at its partner `p(v)` on the mirror joint `M(a)`
// (the partner map, else the closest point to the mirrored position within 0.01 H, else none). Per point: first the
// direct op, then the mirrored op, then the symmetrize of seam points (`p(v) = v`: the op once, then
// `w ← ½(w + M(w))`). A centre joint (`M(a) = a`) applies the op once at each point with the larger strength of the
// point and its partner, so a stroke on one side gives the same weights on both.
import { EkzaError } from '@ekza-studio/anim-core';
import { pointGraph } from '../geometry/adjacency';
import {
  cloneRow,
  fitFree,
  MAX_INFLUENCES,
  mirrorKeyOf,
  type Row,
  readRow,
  remainderTarget,
  setActive,
  strokePartners,
  sumDesc,
  WeightBuffer,
  weightOf,
  writeRow,
} from '../normalize';
import type { PaintOp, SkinGeometry, SkinWeights, StrokeSession, StrokeStamp, WeightContext } from '../types';

/** The op's target value of the active joint for its current weight `w`, value `value`, strength `s` (§5.11 table). */
export function paintTarget(op: PaintOp, w: number, value: number, s: number): number {
  switch (op) {
    case 'replace':
      return w + (value - w) * s;
    case 'add':
      return w + value * s;
    case 'scale':
      return w * (1 - (1 - value) * s);
    case 'smooth':
      return w;
  }
}

/** The point graph per geometry (smooth reads 1-rings). */
const graphs = new WeakMap<SkinGeometry, { readonly start: Int32Array; readonly next: Int32Array }>();
export function graphOf(geometry: SkinGeometry): { readonly start: Int32Array; readonly next: Int32Array } {
  let graph = graphs.get(geometry);
  if (graph === undefined) {
    graph = pointGraph(geometry);
    graphs.set(geometry, graph);
  }
  return graph;
}

/** Shared machinery of the weight edits over a `WeightBuffer`: §5.10 ops on rows, smooth, symmetrize, writes. */
export class RowOps {
  readonly held: (i: number) => boolean;

  constructor(
    readonly buf: WeightBuffer,
    readonly ctx: WeightContext,
  ) {
    this.held = (i) => {
      const entry = this.buf.palette[i];
      return entry !== undefined && ctx.holds.has(entry.key);
    };
  }

  /** Sets joint `key` of a row to `t` under §5.10 (null: no change). Appends the joint only when it gains weight. */
  set(row: Row, key: string, t: number): Row | null {
    if (this.ctx.holds.has(key)) return null;
    const at = this.buf.find(key);
    const w = at < 0 ? 0 : weightOf(row, at);
    if (t === w || (at < 0 && !(t > 0))) return null;
    const i = at < 0 ? this.buf.entry(key) : at;
    return setActive(row, i, t, this.held, () => {
      const target = remainderTarget(this.ctx.skeleton, key, this.ctx.holds);
      return target === null ? null : this.buf.entry(target);
    });
  }

  /** A paint op of joint `key` at strength `s` on a row (the row itself when nothing changes). */
  op(row: Row, key: string, op: PaintOp, value: number, s: number): Row {
    if (!(s > 0)) return row;
    const at = this.buf.find(key);
    const w = at < 0 ? 0 : weightOf(row, at);
    return this.set(row, key, paintTarget(op, w, value, s)) ?? row;
  }

  /** The mirror image of a row: every entry on its mirror joint (appended when missing and weighted). */
  mirrored(row: Row): Row {
    const out: Row = { idx: [], w: [] };
    for (let k = 0; k < row.idx.length; k++) {
      const entry = this.buf.palette[row.idx[k] as number];
      if (entry === undefined) continue;
      const i = this.buf.entry(mirrorKeyOf(this.ctx.skeleton, entry.key, entry));
      const at = out.idx.indexOf(i);
      if (at >= 0) out.w[at] = (out.w[at] as number) + (row.w[k] as number);
      else {
        out.idx.push(i);
        out.w.push(row.w[k] as number);
      }
    }
    return out;
  }

  /** `½(w + M(w))` over the not-held joints (held ones keep their weights), then §5.10 (seam points, §5.11). */
  symmetrize(row: Row): Row {
    const image = this.mirrored(row);
    const out: Row = { idx: [], w: [] };
    const keys = [...new Set([...row.idx, ...image.idx])].sort((a, b) => a - b);
    for (const i of keys) {
      const own = weightOf(row, i);
      const value = this.held(i) ? own : 0.5 * (own + weightOf(image, i));
      if (value > 0) {
        out.idx.push(i);
        out.w.push(value);
      }
    }
    if (sameRow(out, row)) return row;
    return fitFree(out, this.held) ?? row;
  }

  /** Smooth (§5.11, §5.13): the point's not-held vector `lerp`s toward the average of its 1-ring, then §5.10. */
  smooth(v: number, s: number, rows: (u: number) => Row): Row | null {
    if (!(s > 0)) return null;
    const graph = graphOf(this.ctx.geometry);
    const from = graph.start[v] as number;
    const to = graph.start[v + 1] as number;
    if (to <= from) return null;
    const count = to - from;
    const sums = new Map<number, number[]>();
    for (let n = from; n < to; n++) {
      const neighbour = rows(graph.next[n] as number);
      for (let k = 0; k < neighbour.idx.length; k++) {
        const i = neighbour.idx[k] as number;
        if (this.held(i)) continue;
        const list = sums.get(i);
        if (list === undefined) sums.set(i, [neighbour.w[k] as number]);
        else list.push(neighbour.w[k] as number);
      }
    }
    const row = rows(v);
    const out: Row = { idx: [], w: [] };
    const keys = [...new Set([...row.idx, ...sums.keys()])].sort((a, b) => a - b);
    for (const i of keys) {
      const own = weightOf(row, i);
      let value = own;
      if (!this.held(i)) {
        const avg = sumDesc(sums.get(i) ?? []) / count;
        value = own + (avg - own) * s;
      }
      if (value > 0) {
        out.idx.push(i);
        out.w.push(value);
      }
    }
    if (sameRow(out, row)) return null;
    return fitFree(out, this.held);
  }

  /** Writes a row to point `v`; true when the stored point changed. */
  write(v: number, row: Row): boolean {
    return writeRow(this.buf.joints, this.buf.weights, v, row, this.held);
  }

  /** Copies point `v` of `source` into the buffer (restores an untouched point bit-equal). */
  restore(v: number, joints: Uint16Array, weights: Float32Array): void {
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      this.buf.joints[4 * v + k] = joints[4 * v + k] as number;
      this.buf.weights[4 * v + k] = weights[4 * v + k] as number;
    }
  }
}

function sameRow(a: Row, b: Row): boolean {
  if (a.idx.length !== b.idx.length) return false;
  for (let k = 0; k < a.idx.length; k++) if (weightOf(b, a.idx[k] as number) !== a.w[k]) return false;
  return true;
}

/** The points of `buf` that differ from `joints`/`weights`, ascending. */
export function changedPoints(
  points: number,
  joints: Uint16Array,
  weights: Float32Array,
  buf: WeightBuffer,
): Uint32Array {
  const out: number[] = [];
  for (let v = 0; v < points; v++) {
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      if (buf.joints[4 * v + k] !== joints[4 * v + k] || buf.weights[4 * v + k] !== weights[4 * v + k]) {
        out.push(v);
        break;
      }
    }
  }
  return Uint32Array.from(out);
}

class Stroke implements StrokeSession {
  private readonly buf: WeightBuffer;
  private readonly ops: RowOps;
  private readonly startJoints: Uint16Array;
  private readonly startWeights: Float32Array;
  /** s_max of the direct op per point (Replace, Add, Scale). */
  private readonly strength: Float64Array;
  private readonly partners: Int32Array | null;
  private readonly mirrorKey: string;
  private readonly centre: boolean;
  private finished = false;

  constructor(
    skin: SkinWeights,
    private readonly ctx: WeightContext,
    private readonly opts: {
      readonly joint: string;
      readonly op: PaintOp;
      readonly value: number;
      readonly mirror: boolean;
    },
  ) {
    if (ctx.holds.has(opts.joint)) throw new EkzaError('op-refused', `${opts.joint} is held`);
    if (!['replace', 'add', 'scale', 'smooth'].includes(opts.op)) {
      throw new EkzaError('invalid-input', `unknown paint op ${String(opts.op)}`);
    }
    this.buf = new WeightBuffer(skin, ctx.skeleton);
    this.ops = new RowOps(this.buf, ctx);
    this.startJoints = skin.joints.slice();
    this.startWeights = skin.weights.slice();
    this.strength = new Float64Array(skin.points);
    this.partners = opts.mirror ? strokePartners(ctx.geometry, ctx.skeleton.height) : null;
    const at = this.buf.find(opts.joint);
    this.mirrorKey = mirrorKeyOf(ctx.skeleton, opts.joint, at < 0 ? undefined : this.buf.palette[at]);
    this.centre = this.mirrorKey === opts.joint;
  }

  addStamp(stamp: StrokeStamp): Uint32Array {
    if (this.finished) throw new EkzaError('invalid-input', 'the stroke has finished');
    return this.opts.op === 'smooth' ? this.smoothStamp(stamp) : this.maxStamp(stamp);
  }

  current(): SkinWeights {
    return this.buf.skin();
  }

  finish(): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
    this.finished = true;
    const skin = this.buf.skin();
    return {
      skin: { points: skin.points, palette: skin.palette, joints: skin.joints, weights: skin.weights },
      changed: changedPoints(this.buf.points, this.startJoints, this.startWeights, this.buf),
    };
  }

  /** Replace, Add, Scale: raise s_max, recompute the touched points (and partners) from the stroke start. */
  private maxStamp(stamp: StrokeStamp): Uint32Array {
    const P = this.buf.points;
    const dirty = new Set<number>();
    const n = Math.min(stamp.points.length, stamp.strength.length);
    for (let k = 0; k < n; k++) {
      const v = stamp.points[k] as number;
      const s = clampStrength(stamp.strength[k] as number);
      if (!(v >= 0 && v < P) || !(s > (this.strength[v] as number))) continue;
      this.strength[v] = s;
      dirty.add(v);
      const q = this.partners === null ? -1 : (this.partners[v] as number);
      if (q >= 0 && q !== v) dirty.add(q);
    }
    const points = [...dirty].sort((a, b) => a - b);
    for (const v of points) this.recompute(v);
    return Uint32Array.from(points);
  }

  private recompute(v: number): void {
    const { op, value, joint } = this.opts;
    const start = readRow(this.startJoints, this.startWeights, v);
    let row = start;
    const sd = this.strength[v] as number;
    const q = this.partners === null ? -1 : (this.partners[v] as number);
    if (this.partners !== null && this.centre && q >= 0 && q !== v) {
      row = this.ops.op(row, joint, op, value, Math.max(sd, this.strength[q] as number));
    } else {
      row = this.ops.op(row, joint, op, value, sd);
      if (this.partners !== null && q >= 0 && q !== v) {
        row = this.ops.op(row, this.mirrorKey, op, value, this.strength[q] as number);
      }
      if (this.partners !== null && q === v && sd > 0) row = this.ops.symmetrize(row);
    }
    if (row === start) this.ops.restore(v, this.startJoints, this.startWeights);
    else this.ops.write(v, row);
  }

  /** Smooth: per stamp, the direct pass, then the mirrored pass, then the seam symmetrize (each from the values the
   *  previous pass left; within a pass every point reads the values before the pass). */
  private smoothStamp(stamp: StrokeStamp): Uint32Array {
    const P = this.buf.points;
    const strengths = new Map<number, number>();
    const n = Math.min(stamp.points.length, stamp.strength.length);
    for (let k = 0; k < n; k++) {
      const v = stamp.points[k] as number;
      const s = clampStrength(stamp.strength[k] as number);
      if (!(v >= 0 && v < P) || !(s > 0)) continue;
      strengths.set(v, Math.max(strengths.get(v) ?? 0, s));
    }
    const order = [...strengths.keys()].sort((a, b) => a - b);
    const changed = new Set<number>();
    const pass = (targets: readonly (readonly [number, number])[]): void => {
      const snapshot = new Map<number, Row>();
      const rows = (u: number): Row => {
        let row = snapshot.get(u);
        if (row === undefined) {
          row = this.buf.row(u);
          snapshot.set(u, row);
        }
        return row;
      };
      const results: [number, Row][] = [];
      for (const [v, s] of targets) {
        const next = this.ops.smooth(v, s, rows);
        if (next !== null) results.push([v, next]);
      }
      for (const [v, row] of results) if (this.ops.write(v, row)) changed.add(v);
    };
    pass(order.map((v) => [v, strengths.get(v) as number]));
    if (this.partners !== null) {
      const mirrored: [number, number][] = [];
      for (const v of order) {
        const q = this.partners[v] as number;
        if (q >= 0 && q !== v) mirrored.push([q, strengths.get(v) as number]);
      }
      pass(mirrored);
      for (const v of order) {
        if (this.partners[v] !== v) continue;
        const row = this.buf.row(v);
        const next = this.ops.symmetrize(row);
        if (next !== row && this.ops.write(v, cloneRow(next))) changed.add(v);
      }
    }
    return Uint32Array.from([...changed].sort((a, b) => a - b));
  }
}

function clampStrength(s: number): number {
  return Number.isFinite(s) ? Math.min(Math.max(s, 0), 1) : 0;
}

/** Incremental stroke for the live preview (§5.11): private copies, O(stamp) per `addStamp`. */
export function beginStroke(
  skin: SkinWeights,
  ctx: WeightContext,
  opts: { readonly joint: string; readonly op: PaintOp; readonly value: number; readonly mirror: boolean },
): StrokeSession {
  return new Stroke(skin, ctx, opts);
}
