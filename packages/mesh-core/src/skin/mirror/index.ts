// C6 (with the C5 MVP subset; M6B-SPEC §4.2, §5.13): Mirror Skin Weights. The YZ plane is fixed; the default
// direction `positive-to-negative` copies +X (VRM left) onto −X. Per target point the source is its partner (the fixed
// partner map, `surface: 'partners'`), else the source point within 1e-4 H of the mirrored position (spatial hash),
// else the closest point on the source half's triangles with barycentric interpolation (`surface: 'closest-point'`
// always takes this path). The source vector moves to the mirror joints (`mirror` link → mirrored human bone → name
// swap, as `SkinSkeleton.mirror` resolves them; a joint without one maps to itself); held joints at the target keep
// their weights; seam points (|x| ≤ 1e-4 H or their own partner) symmetrize. An exact copy (≤ 4 entries, normalized,
// the held joints already equal to the image) is written bit for bit, and a target that already holds the result keeps its slots, so mirroring twice
// on a symmetric mesh is an involution (P-S3).
import {
  fitFree,
  MAX_INFLUENCES,
  PointHash,
  type Row,
  readRow,
  SUM_TOLERANCE,
  sumDesc,
  WeightBuffer,
  weightOf,
} from '../normalize';
import { changedPoints, RowOps } from '../stroke';
import type { SkinWeights, WeightContext } from '../types';

type V3 = readonly [number, number, number];

/** The closest point of triangle abc to p: barycentric weights (u, v, w) and the squared distance (Ericson 5.1.5). */
export function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): { readonly bary: V3; readonly d2: number } {
  const sub = (x: V3, y: V3): V3 => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x: V3, y: V3): number => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  let bary: V3;
  if (d1 <= 0 && d2 <= 0) bary = [1, 0, 0];
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) bary = [0, 1, 0];
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        bary = [1 - v, v, 0];
      } else {
        const cp = sub(p, c);
        const d5 = dot(ab, cp);
        const d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) bary = [0, 0, 1];
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) {
            const w = d2 / (d2 - d6);
            bary = [1 - w, 0, w];
          } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
              bary = [0, 1 - w, w];
            } else {
              const denom = 1 / (va + vb + vc);
              const v = vb * denom;
              const w = vc * denom;
              bary = [1 - v - w, v, w];
            }
          }
        }
      }
    }
  }
  const q: V3 = [
    bary[0] * a[0] + bary[1] * b[0] + bary[2] * c[0],
    bary[0] * a[1] + bary[1] * b[1] + bary[2] * c[1],
    bary[0] * a[2] + bary[1] * b[2] + bary[2] * c[2],
  ];
  const d = sub(p, q);
  return { bary, d2: dot(d, d) };
}

export function mirrorWeights(
  skin: SkinWeights,
  args: {
    readonly direction: 'positive-to-negative' | 'negative-to-positive';
    readonly surface: 'partners' | 'closest-point';
    readonly points: ArrayLike<number> | null;
  },
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const { geometry, skeleton } = ctx;
  const P = skin.points;
  const H = skeleton.height > 0 && Number.isFinite(skeleton.height) ? skeleton.height : 1;
  const tol = 1e-4 * H;
  const sign = args.direction === 'positive-to-negative' ? 1 : -1;
  const x = (v: number): number => sign * (geometry.positions[3 * v] as number);
  const isSource = (v: number): boolean => x(v) > tol;
  const isSeam = (v: number): boolean => Math.abs(x(v)) <= tol || geometry.partner[v] === v;
  const buf = new WeightBuffer(skin, skeleton);
  const ops = new RowOps(buf, ctx);
  // Source rows come from the input (never from points written by this run).
  const source = (v: number): Row => readRow(skin.joints, skin.weights, v);

  let selected: Uint8Array | null = null;
  if (args.points !== null) {
    selected = new Uint8Array(P);
    for (let k = 0; k < args.points.length; k++) {
      const v = args.points[k] as number;
      if (Number.isInteger(v) && v >= 0 && v < P) selected[v] = 1;
    }
  }
  let hash: PointHash | null = null;
  let sourceTris: number[] | null = null;
  const sourceTriangles = (): number[] => {
    if (sourceTris !== null) return sourceTris;
    const out: number[] = [];
    for (let t = 0; 3 * t + 2 < geometry.tris.length; t++) {
      const a = geometry.tris[3 * t] as number;
      const b = geometry.tris[3 * t + 1] as number;
      const c = geometry.tris[3 * t + 2] as number;
      if (x(a) >= -tol && x(b) >= -tol && x(c) >= -tol) out.push(t);
    }
    sourceTris = out;
    return out;
  };
  const pos = (v: number): V3 => [
    geometry.positions[3 * v] as number,
    geometry.positions[3 * v + 1] as number,
    geometry.positions[3 * v + 2] as number,
  ];

  /** The source row of a target point (palette indices of the input), or null when none is found. */
  const sourceRow = (v: number): Row | null => {
    const [px, py, pz] = pos(v);
    if (args.surface === 'partners') {
      const q = geometry.partner[v] ?? -1;
      if (q >= 0 && q !== v && isSource(q)) return source(q);
      hash ??= new PointHash(geometry.positions, Math.max(tol, 1e-9));
      const exact = hash.nearest(-px, py, pz, tol, isSource);
      if (exact >= 0) return source(exact);
    }
    const target: V3 = [-px, py, pz];
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    let bestBary: V3 = [1, 0, 0];
    for (const t of sourceTriangles()) {
      const a = geometry.tris[3 * t] as number;
      const b = geometry.tris[3 * t + 1] as number;
      const c = geometry.tris[3 * t + 2] as number;
      const hit = closestOnTriangle(target, pos(a), pos(b), pos(c));
      if (hit.d2 < bestD) {
        bestD = hit.d2;
        best = t;
        bestBary = hit.bary;
      }
    }
    if (best < 0) return null;
    const out: Row = { idx: [], w: [] };
    for (let corner = 0; corner < 3; corner++) {
      const f = bestBary[corner] as number;
      if (!(f > 0)) continue;
      const row = source(geometry.tris[3 * best + corner] as number);
      for (let k = 0; k < row.idx.length; k++) {
        const i = row.idx[k] as number;
        const at = out.idx.indexOf(i);
        const w = f * (row.w[k] as number);
        if (at >= 0) out.w[at] = (out.w[at] as number) + w;
        else {
          out.idx.push(i);
          out.w.push(w);
        }
      }
    }
    return out;
  };

  for (let v = 0; v < P; v++) {
    if (selected !== null && selected[v] !== 1) continue;
    if (isSeam(v)) {
      const row = buf.row(v);
      const next = ops.symmetrize(row);
      if (next !== row) ops.write(v, next);
      continue;
    }
    if (isSource(v)) continue;
    const from = sourceRow(v);
    if (from === null) continue;
    const image = ops.mirrored(from);
    const current = buf.row(v);
    if (sameEntries(current, image)) continue;
    // The held joints already match the image (none held, or symmetric holds): the exact copy keeps them bit-equal.
    const heldMatch = [...current.idx, ...image.idx].every(
      (i) => !ops.held(i) || Math.fround(weightOf(current, i)) === Math.fround(weightOf(image, i)),
    );
    if (heldMatch && image.idx.length <= MAX_INFLUENCES && Math.abs(sumDesc(image.w) - 1) <= SUM_TOLERANCE) {
      writeExact(buf, v, image);
      continue;
    }
    // Held joints keep their weights; the mirrored not-held entries share what they leave.
    const out: Row = { idx: [], w: [] };
    for (let k = 0; k < current.idx.length; k++) {
      const i = current.idx[k] as number;
      if (!ops.held(i)) continue;
      out.idx.push(i);
      out.w.push(current.w[k] as number);
    }
    for (let k = 0; k < image.idx.length; k++) {
      const i = image.idx[k] as number;
      if (ops.held(i)) continue;
      out.idx.push(i);
      out.w.push(image.w[k] as number);
    }
    const fitted = fitFree(out, ops.held, ops.canon);
    if (fitted !== null && !sameEntries(current, fitted)) ops.write(v, fitted);
  }
  const out = buf.skin();
  return {
    skin: { points: out.points, palette: out.palette, joints: out.joints, weights: out.weights },
    changed: changedPoints(P, skin.joints, skin.weights, buf),
  };
}

/** Same (palette index, f32 weight) pairs. */
function sameEntries(a: Row, b: Row): boolean {
  if (a.idx.length !== b.idx.length) return false;
  for (let k = 0; k < a.idx.length; k++) {
    if (Math.fround(weightOf(b, a.idx[k] as number)) !== Math.fround(a.w[k] as number)) return false;
  }
  return true;
}

/** Writes the f32 values of a row unchanged (slots by descending weight, ties: smaller palette index). */
function writeExact(buf: WeightBuffer, v: number, row: Row): void {
  const entries = row.idx
    .map((i, k) => ({ i, w: Math.fround(row.w[k] as number) }))
    .filter((e) => e.w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; k < MAX_INFLUENCES; k++) {
    const e = entries[k];
    buf.joints[4 * v + k] = e === undefined ? 0 : e.i;
    buf.weights[4 * v + k] = e === undefined ? 0 : e.w;
  }
}
