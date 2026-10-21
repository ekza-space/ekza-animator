// C6 (with the C5 MVP subset; M6B-SPEC §5.10): the normalization contract every weight tool shares — per point
// `w_k ≥ 0`, at most 4 non-zero, `Σ w_k = 1` (float64 while editing, f32 when written), held (locked) joints never
// change. The working form of one point is a sparse float64 row over palette indices; `WeightBuffer` owns the point
// arrays of an edit (private copies) and the palette (the append rule of §4.2: a joint an edit adds goes to the end).
//
// Determinism and mirror exactness: every sum runs over the values in descending order, so a point and its mirror
// partner — the same values on mirrored joints — get the same doubles (P-S3). Storage order inside a point is by
// descending weight, ties by the smaller palette index (§4.2).
import { EkzaError } from '@ekza-studio/anim-core';
import type { SkinPaletteEntry, SkinSkeleton, SkinWeights } from '../types';

export const MAX_INFLUENCES = 4;
/** |Σ − 1| above this is a `skin.weight-sum` problem (§5.21) and what Normalize repairs. */
export const SUM_TOLERANCE = 1e-6;

/** A sparse float64 row: palette indices and their weights (no zeros, any order). */
export interface Row {
  idx: number[];
  w: number[];
}

/** Σ of the values in descending order (bit-identical for permutations of equal multisets). */
export function sumDesc(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  let sum = 0;
  for (const v of sorted) sum += v;
  return sum;
}

/** The weight of palette index `i` in a row (0 when absent). */
export function weightOf(row: Row, i: number): number {
  const k = row.idx.indexOf(i);
  return k < 0 ? 0 : (row.w[k] as number);
}

/** Sets palette index `i` to `w` in a row (removes it at 0). */
export function setWeight(row: Row, i: number, w: number): void {
  const k = row.idx.indexOf(i);
  if (w > 0) {
    if (k < 0) {
      row.idx.push(i);
      row.w.push(w);
    } else row.w[k] = w;
  } else if (k >= 0) {
    row.idx.splice(k, 1);
    row.w.splice(k, 1);
  }
}

export function cloneRow(row: Row): Row {
  return { idx: [...row.idx], w: [...row.w] };
}

/**
 * The palette and point arrays of one edit: private copies of the input skin; `entry(key)` appends a joint the edit
 * adds (§4.2 palette order), with its parent and mirror keys from the skeleton.
 */
export class WeightBuffer {
  readonly points: number;
  readonly joints: Uint16Array;
  readonly weights: Float32Array;
  palette: SkinPaletteEntry[];
  private readonly index = new Map<string, number>();
  private readonly skeletonIndex: Map<string, number>;

  constructor(
    skin: SkinWeights,
    readonly skeleton: SkinSkeleton,
  ) {
    this.points = skin.points;
    this.joints = skin.joints.slice();
    this.weights = skin.weights.slice();
    this.palette = [...skin.palette];
    this.palette.forEach((entry, i) => {
      if (!this.index.has(entry.key)) this.index.set(entry.key, i);
    });
    this.skeletonIndex = skeletonIndexOf(skeleton);
  }

  /** The palette index of a key, or −1. */
  find(key: string): number {
    return this.index.get(key) ?? -1;
  }

  /** The palette index of a key, appending it at the palette end when missing. */
  entry(key: string): number {
    const at = this.index.get(key);
    if (at !== undefined) return at;
    if (this.palette.length >= 0xffff) throw new EkzaError('invalid-input', 'the skin palette is full');
    const s = this.skeletonIndex.get(key);
    const parent = s === undefined ? null : (this.skeleton.keys[this.skeleton.parent[s] as number] ?? null);
    const m = s === undefined ? -1 : (this.skeleton.mirror[s] as number);
    const mirror = m >= 0 ? (this.skeleton.keys[m] ?? null) : null;
    this.palette = [...this.palette, { key, parent, mirror }];
    this.index.set(key, this.palette.length - 1);
    return this.palette.length - 1;
  }

  row(v: number): Row {
    return readRow(this.joints, this.weights, v);
  }

  /** The value object over the buffer's arrays (shared, read-only for the caller). */
  skin(): SkinWeights {
    return { points: this.points, palette: this.palette, joints: this.joints, weights: this.weights };
  }
}

/** Skeleton key → index. */
const skeletonIndexCache = new WeakMap<SkinSkeleton, Map<string, number>>();
export function skeletonIndexOf(skeleton: SkinSkeleton): Map<string, number> {
  let map = skeletonIndexCache.get(skeleton);
  if (map === undefined) {
    map = new Map();
    skeleton.keys.forEach((key, i) => {
      if (!map?.has(key)) map?.set(key, i);
    });
    skeletonIndexCache.set(skeleton, map);
  }
  return map;
}

/** The non-zero entries of a stored point as float64. Duplicate indices are summed (imports). */
export function readRow(joints: ArrayLike<number>, weights: ArrayLike<number>, v: number): Row {
  const row: Row = { idx: [], w: [] };
  for (let k = 0; k < MAX_INFLUENCES; k++) {
    const w = weights[4 * v + k] as number;
    if (!(w > 0)) continue;
    const i = joints[4 * v + k] as number;
    const at = row.idx.indexOf(i);
    if (at >= 0) row.w[at] = (row.w[at] as number) + w;
    else {
      row.idx.push(i);
      row.w.push(w);
    }
  }
  return row;
}

/** Held flags per palette index for a set of held keys. */
export function heldFlags(palette: readonly SkinPaletteEntry[], holds: ReadonlySet<string>): (i: number) => boolean {
  if (holds.size === 0) return () => false;
  return (i) => {
    const entry = palette[i];
    return entry !== undefined && holds.has(entry.key);
  };
}

/** Σ of the held entries of a row. */
export function heldSum(row: Row, held: (i: number) => boolean): number {
  return sumDesc(row.w.filter((_, k) => held(row.idx[k] as number)));
}

/**
 * Keeps at most 4 entries: drops the smallest not-held entry other than `keep` (ties: the larger palette index) and
 * rescales the not-held entries other than `keep` to `target` (their sum before the drop). False when it cannot fit.
 */
export function pruneToFour(row: Row, held: (i: number) => boolean, keep: number, target: number): boolean {
  if (row.idx.length <= MAX_INFLUENCES) return true;
  while (row.idx.length > MAX_INFLUENCES) {
    let drop = -1;
    for (let k = 0; k < row.idx.length; k++) {
      const i = row.idx[k] as number;
      if (held(i) || i === keep) continue;
      if (drop < 0) {
        drop = k;
        continue;
      }
      const w = row.w[k] as number;
      const d = row.w[drop] as number;
      if (w < d || (w === d && i > (row.idx[drop] as number))) drop = k;
    }
    if (drop < 0) return false;
    row.idx.splice(drop, 1);
    row.w.splice(drop, 1);
  }
  const free: number[] = [];
  for (let k = 0; k < row.idx.length; k++) {
    const i = row.idx[k] as number;
    if (!held(i) && i !== keep) free.push(k);
  }
  const rest = sumDesc(free.map((k) => row.w[k] as number));
  if (rest > 0 && target > 0) for (const k of free) row.w[k] = ((row.w[k] as number) * target) / rest;
  return true;
}

/** Removes zero and negative entries. */
export function dropZeros(row: Row): void {
  for (let k = row.idx.length - 1; k >= 0; k--) {
    if (!((row.w[k] as number) > 0)) {
      row.idx.splice(k, 1);
      row.w.splice(k, 1);
    }
  }
}

/** The nearest not-held deforming ancestor of a key in the skeleton, or null (§5.10 remainder rule). */
export function remainderTarget(skeleton: SkinSkeleton, key: string, holds: ReadonlySet<string>): string | null {
  const s = skeletonIndexOf(skeleton).get(key);
  if (s === undefined) return null;
  let p = skeleton.parent[s] as number;
  for (let guard = 0; p >= 0 && guard < skeleton.keys.length; guard++) {
    const k = skeleton.keys[p] as string;
    if (skeleton.deform[p] === 1 && !holds.has(k)) return k;
    p = skeleton.parent[p] as number;
  }
  return null;
}

/**
 * §5.10: sets the active joint `a` (palette index) of a row to `t`. Returns the new row, or null when nothing can
 * change (the held weights fill the point, an unweighted point asked for 0, the row does not fit 4 influences).
 * `ancestor()` resolves (and appends) the remainder target when the other joints hold nothing.
 */
export function setActive(
  row: Row,
  a: number,
  t: number,
  held: (i: number) => boolean,
  ancestor: () => number | null,
): Row | null {
  const total = sumDesc(row.w);
  const hs = heldSum(row, held);
  const avail = 1 - hs;
  if (!(avail > 0)) return null;
  const wa = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), avail);
  if (!(total > 0) && !(wa > 0)) return null;
  const out: Row = { idx: [], w: [] };
  const others: number[] = [];
  for (let k = 0; k < row.idx.length; k++) {
    const i = row.idx[k] as number;
    if (i === a) continue;
    out.idx.push(i);
    out.w.push(row.w[k] as number);
    if (!held(i)) others.push(out.idx.length - 1);
  }
  const rest = sumDesc(others.map((k) => out.w[k] as number));
  const remainder = avail - wa;
  let finalA = wa;
  if (rest > 0) {
    for (const k of others) out.w[k] = ((out.w[k] as number) * remainder) / rest;
  } else if (remainder > 0) {
    const target = ancestor();
    if (target !== null && target !== a && !held(target)) {
      setWeight(out, target, weightOf(out, target) + remainder);
    } else finalA = avail;
  }
  if (finalA > 0) {
    out.idx.push(a);
    out.w.push(finalA);
  }
  dropZeros(out);
  if (!pruneToFour(out, held, a, avail - finalA)) return null;
  return out;
}

/**
 * Rescales the not-held entries (other than `locked`) so the row sums to 1, keeping at most 4. Null when the row is
 * unweighted, already normalized (|Σ − 1| ≤ 1e-6 with ≤ 4 entries: idempotence), or has nothing free to scale.
 */
export function normalizeRow(row: Row, held: (i: number) => boolean, locked: number): Row | null {
  const out = cloneRow(row);
  dropZeros(out);
  const total = sumDesc(out.w);
  if (!(total > 0)) return null;
  if (out.idx.length <= MAX_INFLUENCES && Math.abs(total - 1) <= SUM_TOLERANCE && out.idx.length === row.idx.length)
    return null;
  const fixed = (i: number): boolean => held(i) || i === locked;
  const fixedSum = sumDesc(out.w.filter((_, k) => fixed(out.idx[k] as number)));
  const avail = 1 - fixedSum;
  const free: number[] = [];
  for (let k = 0; k < out.idx.length; k++) if (!fixed(out.idx[k] as number)) free.push(k);
  const rest = sumDesc(free.map((k) => out.w[k] as number));
  if (!(rest > 0) || !(avail > 0)) return null;
  for (const k of free) out.w[k] = ((out.w[k] as number) * avail) / rest;
  if (!pruneToFour(out, fixed, -1, avail)) return null;
  return out;
}

/**
 * Fits a row whose not-held entries were recomputed (smooth, symmetrize, mirror): the not-held entries are scaled to
 * `avail = 1 − Σ held` and the row is cut to 4. Null when nothing is free.
 */
export function fitFree(row: Row, held: (i: number) => boolean): Row | null {
  const out = cloneRow(row);
  dropZeros(out);
  const hs = heldSum(out, held);
  const avail = 1 - hs;
  const free: number[] = [];
  for (let k = 0; k < out.idx.length; k++) if (!held(out.idx[k] as number)) free.push(k);
  const rest = sumDesc(free.map((k) => out.w[k] as number));
  if (!(rest > 0) || !(avail > 0)) return null;
  for (const k of free) out.w[k] = ((out.w[k] as number) * avail) / rest;
  if (!pruneToFour(out, held, -1, avail)) return null;
  return out;
}

/**
 * Writes a float64 row into point `v` as f32 (§5.9 step 3e): values rounded, the residual 1 − Σ into the largest
 * not-held entry (held values are copied bit-equal), slots by descending weight (ties: smaller palette index), unused
 * slots 0. Returns true when the stored point changed.
 */
export function writeRow(
  joints: Uint16Array,
  weights: Float32Array,
  v: number,
  row: Row,
  held: (i: number) => boolean,
): boolean {
  const entries = row.idx.map((i, k) => ({ i, w: Math.fround(row.w[k] as number) })).filter((e) => e.w > 0);
  if (entries.length > MAX_INFLUENCES) throw new EkzaError('internal', 'writeRow: more than 4 influences');
  if (entries.length > 0) {
    const sum = sumDesc(entries.map((e) => e.w));
    let top = -1;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k] as { i: number; w: number };
      if (held(e.i)) continue;
      const t = top < 0 ? undefined : entries[top];
      if (t === undefined || e.w > t.w || (e.w === t.w && e.i < t.i)) top = k;
    }
    const residual = 1 - sum;
    const t = entries[top];
    if (t !== undefined && residual !== 0 && Math.abs(residual) < 1e-4) t.w = Math.fround(t.w + residual);
  }
  entries.sort((x, y) => y.w - x.w || x.i - y.i);
  let changed = false;
  for (let k = 0; k < MAX_INFLUENCES; k++) {
    const e = entries[k];
    const j = e === undefined ? 0 : e.i;
    const w = e === undefined ? 0 : e.w;
    if (joints[4 * v + k] !== j || weights[4 * v + k] !== w) changed = true;
    joints[4 * v + k] = j;
    weights[4 * v + k] = w;
  }
  return changed;
}

/** True when two stored points hold the same (palette index, weight) pairs. */
export function samePoint(
  aj: ArrayLike<number>,
  aw: ArrayLike<number>,
  bj: ArrayLike<number>,
  bw: ArrayLike<number>,
  v: number,
): boolean {
  for (let k = 0; k < MAX_INFLUENCES; k++) {
    if (aj[4 * v + k] !== bj[4 * v + k] || aw[4 * v + k] !== bw[4 * v + k]) return false;
  }
  return true;
}

// ---------- mirror maps (§5.11 mirror strokes, §5.13 Mirror Skin Weights) ----------

/** The mirror key of a joint: the skeleton's mirror (JointRecord.mirror, the human bone, the name swap, §4.2), else
 *  the palette entry's `mirror` (CR-6), else the key itself (a centre joint). */
export function mirrorKeyOf(skeleton: SkinSkeleton, key: string, entry?: SkinPaletteEntry): string {
  const s = skeletonIndexOf(skeleton).get(key);
  if (s !== undefined) {
    const m = skeleton.mirror[s] as number;
    if (m >= 0) return skeleton.keys[m] as string;
  }
  return entry?.mirror ?? key;
}

/** Spatial hash of points (cell = `size`), for the nearest point to a position within a radius. */
export class PointHash {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly positions: Float64Array,
    private readonly size: number,
  ) {
    const P = Math.floor(positions.length / 3);
    for (let v = 0; v < P; v++) {
      const key = this.key(positions[3 * v] as number, positions[3 * v + 1] as number, positions[3 * v + 2] as number);
      const list = this.cells.get(key);
      if (list === undefined) this.cells.set(key, [v]);
      else list.push(v);
    }
  }
  private cell(x: number): number {
    return Math.floor(x / this.size);
  }
  private key(x: number, y: number, z: number): string {
    return `${this.cell(x)},${this.cell(y)},${this.cell(z)}`;
  }
  /** The nearest point within `radius` (≤ the cell size) of (x, y, z); ties by the smaller index; −1 when none. */
  nearest(x: number, y: number, z: number, radius: number, accept?: (v: number) => boolean): number {
    const cx = this.cell(x);
    const cy = this.cell(y);
    const cz = this.cell(z);
    let best = -1;
    let bestD = radius * radius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const v of this.cells.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (accept !== undefined && !accept(v)) continue;
            const ex = (this.positions[3 * v] as number) - x;
            const ey = (this.positions[3 * v + 1] as number) - y;
            const ez = (this.positions[3 * v + 2] as number) - z;
            const d = ex * ex + ey * ey + ez * ez;
            if (d < bestD || (d === bestD && (best < 0 || v < best))) {
              best = v;
              bestD = d;
            }
          }
        }
      }
    }
    return best;
  }
}

/** The partner of every point for mirror strokes (§5.11): the fixed partner map, else the closest point to the
 *  mirrored position within 0.01 H (ties: the smaller index), else −1. Cached per geometry and height. */
const strokePartnerCache = new WeakMap<object, { readonly height: number; readonly map: Int32Array }>();
export function strokePartners(
  geometry: { readonly positions: Float64Array; readonly partner: Int32Array },
  height: number,
): Int32Array {
  const hit = strokePartnerCache.get(geometry);
  if (hit !== undefined && hit.height === height) return hit.map;
  const P = Math.floor(geometry.positions.length / 3);
  const map = new Int32Array(P).fill(-1);
  const radius = 0.01 * (height > 0 && Number.isFinite(height) ? height : 1);
  let hash: PointHash | null = null;
  for (let v = 0; v < P; v++) {
    const p = geometry.partner[v] ?? -1;
    if (p >= 0 && p < P) {
      map[v] = p;
      continue;
    }
    hash ??= new PointHash(geometry.positions, radius);
    map[v] = hash.nearest(
      -(geometry.positions[3 * v] as number),
      geometry.positions[3 * v + 1] as number,
      geometry.positions[3 * v + 2] as number,
      radius,
    );
  }
  strokePartnerCache.set(geometry, { height, map });
  return map;
}
