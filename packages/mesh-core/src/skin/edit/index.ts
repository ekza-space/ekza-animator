// C6 (skin-ui with the C5 MVP subset; M6B-SPEC §4.2, §5.10–§5.13): weight edits under the normalization contract.
// MVP kinds: `set` (table cells and Assign), `stroke` and `flood` (one stroke session, ../stroke), `smooth`, `prune`,
// `normalize`, `compact`. `hammer`, `paste`, `move` and `rigidIslands` arrive after the MVP (§0.3).
//
// Every edit returns a new value object (the input is never written) and the points it changed (ascending). Joints an
// edit adds are appended at the palette end (§4.2); `compact` rewrites the palette in skeleton order.
import { EkzaError } from '@ekza-studio/anim-core';
import { BUILTIN_LAYERS } from '../../layers/builtin';
import type { DirtySet } from '../../types';
import {
  MAX_INFLUENCES,
  normalizeRow,
  pruneToFour,
  type Row,
  readRow,
  skeletonIndexOf,
  sumDesc,
  WeightBuffer,
  weightOf,
} from '../normalize';
import { beginStroke, changedPoints, graphOf, RowOps } from '../stroke';
import type { SkinPaletteEntry, SkinWeights, WeightContext, WeightEdit } from '../types';

const SKIN_LAYERS: readonly string[] = [BUILTIN_LAYERS.skinJoints.name, BUILTIN_LAYERS.skinWeights.name];

/** Unique valid point indices of a selection, ascending (null = every point). */
function pointsOf(points: ArrayLike<number> | null, count: number): number[] {
  if (points === null) return Array.from({ length: count }, (_, i) => i);
  const seen = new Uint8Array(count);
  const out: number[] = [];
  for (let k = 0; k < points.length; k++) {
    const v = points[k] as number;
    if (!Number.isInteger(v) || v < 0 || v >= count || seen[v] === 1) continue;
    seen[v] = 1;
    out.push(v);
  }
  return out.sort((a, b) => a - b);
}

function finish(skin: SkinWeights, buf: WeightBuffer): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const out = buf.skin();
  return {
    skin: { points: out.points, palette: out.palette, joints: out.joints, weights: out.weights },
    changed: changedPoints(skin.points, skin.joints, skin.weights, buf),
  };
}

/** Applies one edit under the §5.10 contract; returns a new value object (inputs untouched) and the changed points. */
export function editWeights(
  skin: SkinWeights,
  edit: WeightEdit,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  switch (edit.kind) {
    case 'stroke': {
      const session = beginStroke(skin, ctx, {
        joint: edit.joint,
        op: edit.op,
        value: edit.value,
        mirror: edit.mirror,
      });
      for (const stamp of edit.stamps) session.addStamp(stamp);
      return session.finish();
    }
    case 'flood': {
      const points = Uint32Array.from(pointsOf(edit.points, skin.points));
      const session = beginStroke(skin, ctx, {
        joint: edit.joint,
        op: edit.op,
        value: edit.value,
        mirror: edit.mirror,
      });
      session.addStamp({ points, strength: new Float32Array(points.length).fill(edit.opacity) });
      return session.finish();
    }
    case 'set':
      return setWeights(skin, edit, ctx);
    case 'smooth':
      return smoothWeights(skin, edit, ctx);
    case 'prune':
      return pruneWeights(skin, edit.points, edit.below, ctx);
    case 'normalize':
      return normalizeWeights(skin, edit.points, edit.lockActive, ctx);
    case 'compact':
      return compactWeights(skin, ctx);
    case 'hammer':
    case 'paste':
    case 'move':
    case 'rigidIslands':
      throw new EkzaError('not-implemented', `editWeights '${edit.kind}' arrives after the MVP`);
  }
}

function setWeights(
  skin: SkinWeights,
  edit: Extract<WeightEdit, { kind: 'set' }>,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  if (ctx.holds.has(edit.joint)) throw new EkzaError('op-refused', `${edit.joint} is held`);
  const buf = new WeightBuffer(skin, ctx.skeleton);
  const ops = new RowOps(buf, ctx);
  for (const v of pointsOf(edit.points, skin.points)) {
    const row = buf.row(v);
    const at = buf.find(edit.joint);
    const w = at < 0 ? 0 : weightOf(row, at);
    const t = edit.mode === 'add' ? w + edit.value : edit.mode === 'mul' ? w * edit.value : edit.value;
    const next = ops.set(row, edit.joint, t);
    if (next !== null) ops.write(v, next);
  }
  return finish(skin, buf);
}

/** Grows (`expand > 0`) or shrinks (`expand < 0`) a point set by rings of the point graph. */
function expandPoints(points: number[], expand: number, ctx: WeightContext, count: number): number[] {
  if (expand === 0) return points;
  const graph = graphOf(ctx.geometry);
  const inSet = new Uint8Array(count);
  for (const v of points) inSet[v] = 1;
  for (let ring = 0; ring < Math.abs(expand); ring++) {
    const next = inSet.slice();
    for (let v = 0; v < count; v++) {
      const from = graph.start[v] as number;
      const to = graph.start[v + 1] as number;
      if (expand > 0 && inSet[v] === 1) {
        for (let n = from; n < to; n++) next[graph.next[n] as number] = 1;
      } else if (expand < 0 && inSet[v] === 1) {
        for (let n = from; n < to; n++) {
          if (inSet[graph.next[n] as number] === 0) {
            next[v] = 0;
            break;
          }
        }
      }
    }
    inSet.set(next);
  }
  const out: number[] = [];
  for (let v = 0; v < count; v++) if (inSet[v] === 1) out.push(v);
  return out;
}

function smoothWeights(
  skin: SkinWeights,
  edit: Extract<WeightEdit, { kind: 'smooth' }>,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const buf = new WeightBuffer(skin, ctx.skeleton);
  const ops = new RowOps(buf, ctx);
  const factor = Math.min(Math.max(Number.isFinite(edit.factor) ? edit.factor : 0, 0), 1);
  const iterations = Math.min(Math.max(Math.round(edit.iterations), 1), 20);
  const expand = Math.min(Math.max(Math.round(edit.expand), -3), 3);
  const points = expandPoints(pointsOf(edit.points, skin.points), expand, ctx, skin.points);
  for (let it = 0; it < iterations; it++) {
    const snapshot = new Map<number, Row>();
    const rows = (u: number): Row => {
      let row = snapshot.get(u);
      if (row === undefined) {
        row = buf.row(u);
        snapshot.set(u, row);
      }
      return row;
    };
    const results: [number, Row][] = [];
    for (const v of points) {
      const next = ops.smooth(v, factor, rows);
      if (next !== null) results.push([v, next]);
    }
    if (results.length === 0) break;
    for (const [v, row] of results) ops.write(v, row);
  }
  return finish(skin, buf);
}

function pruneWeights(
  skin: SkinWeights,
  points: ArrayLike<number> | null,
  below: number,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const threshold = Math.min(Math.max(Number.isFinite(below) ? below : 0, 0), 0.2);
  const buf = new WeightBuffer(skin, ctx.skeleton);
  const ops = new RowOps(buf, ctx);
  for (const v of pointsOf(points, skin.points)) {
    const row = buf.row(v);
    if (row.idx.length === 0) continue;
    const free: number[] = [];
    for (let k = 0; k < row.idx.length; k++) if (!ops.held(row.idx[k] as number)) free.push(k);
    if (free.length === 0) continue;
    // The largest free entry always stays (a point never loses its last free weight).
    let largest = free[0] as number;
    for (const k of free) {
      const w = row.w[k] as number;
      const l = row.w[largest] as number;
      if (w > l || (w === l && (row.idx[k] as number) < (row.idx[largest] as number))) largest = k;
    }
    const drop = free.filter((k) => k !== largest && (row.w[k] as number) < threshold);
    if (drop.length === 0 && row.idx.length <= MAX_INFLUENCES) continue;
    const out: Row = { idx: [], w: [] };
    for (let k = 0; k < row.idx.length; k++) {
      if (drop.includes(k)) continue;
      out.idx.push(row.idx[k] as number);
      out.w.push(row.w[k] as number);
    }
    const heldSum = sumDesc(out.w.filter((_, k) => ops.held(out.idx[k] as number)));
    const avail = 1 - heldSum;
    const freeOut: number[] = [];
    for (let k = 0; k < out.idx.length; k++) if (!ops.held(out.idx[k] as number)) freeOut.push(k);
    const rest = sumDesc(freeOut.map((k) => out.w[k] as number));
    if (rest > 0 && avail > 0) for (const k of freeOut) out.w[k] = ((out.w[k] as number) * avail) / rest;
    if (!pruneToFour(out, ops.held, -1, avail)) continue;
    ops.write(v, out);
  }
  return finish(skin, buf);
}

function normalizeWeights(
  skin: SkinWeights,
  points: ArrayLike<number> | null,
  lockActive: string | null,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const buf = new WeightBuffer(skin, ctx.skeleton);
  const ops = new RowOps(buf, ctx);
  const locked = lockActive === null ? -1 : buf.find(lockActive);
  for (const v of pointsOf(points, skin.points)) {
    const next = normalizeRow(buf.row(v), ops.held, locked);
    if (next !== null) ops.write(v, next);
  }
  return finish(skin, buf);
}

/**
 * Remove Unused Influences (§5.13): drops palette joints with zero weight on every point and writes the palette in
 * skeleton order (keys the skeleton does not know keep their relative order after it). Every point keeps its (joint
 * key, weight) pairs bit-equal (P-S6); slots are re-sorted by descending weight, ties by the smaller new index.
 */
function compactWeights(
  skin: SkinWeights,
  ctx: WeightContext,
): { readonly skin: SkinWeights; readonly changed: Uint32Array } {
  const used = new Uint8Array(skin.palette.length);
  for (let v = 0; v < skin.points; v++) {
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      if ((skin.weights[4 * v + k] as number) > 0) used[skin.joints[4 * v + k] as number] = 1;
    }
  }
  const order = skeletonIndexOf(ctx.skeleton);
  const kept: { readonly old: number; readonly entry: SkinPaletteEntry }[] = [];
  const seenKey = new Set<string>();
  skin.palette.forEach((entry, old) => {
    if (used[old] !== 1 || seenKey.has(entry.key)) return;
    seenKey.add(entry.key);
    kept.push({ old, entry });
  });
  kept.sort((a, b) => {
    const sa = order.get(a.entry.key);
    const sb = order.get(b.entry.key);
    if (sa !== undefined && sb !== undefined) return sa - sb;
    if (sa !== undefined) return -1;
    if (sb !== undefined) return 1;
    return a.old - b.old;
  });
  const byKey = new Map(kept.map((k, i) => [k.entry.key, i]));
  const remap = skin.palette.map((entry) => byKey.get(entry.key) ?? -1);
  const palette = kept.map((k) => k.entry);
  const joints = new Uint16Array(skin.joints.length);
  const weights = new Float32Array(skin.weights.length);
  for (let v = 0; v < skin.points; v++) {
    const row = readRow(skin.joints, skin.weights, v);
    const entries = row.idx
      .map((i, k) => ({ i: remap[i] as number, w: Math.fround(row.w[k] as number) }))
      .filter((e) => e.i >= 0 && e.w > 0)
      .sort((x, y) => y.w - x.w || x.i - y.i);
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      const e = entries[k];
      joints[4 * v + k] = e === undefined ? 0 : e.i;
      weights[4 * v + k] = e === undefined ? 0 : e.w;
    }
  }
  const out: SkinWeights = { points: skin.points, palette, joints, weights };
  const changed: number[] = [];
  for (let v = 0; v < skin.points; v++) {
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      if (joints[4 * v + k] !== skin.joints[4 * v + k] || weights[4 * v + k] !== skin.weights[4 * v + k]) {
        changed.push(v);
        break;
      }
    }
  }
  return { skin: out, changed: Uint32Array.from(changed) };
}

function samePalette(a: readonly SkinPaletteEntry[], b: readonly SkinPaletteEntry[], length: number): boolean {
  for (let i = 0; i < length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.key !== y.key || x.parent !== y.parent || x.mirror !== y.mirror)
      return false;
  }
  return true;
}

/**
 * Dirty set of a skin change, for `writeData(…, { dirty })` (CR-1): the points whose slots changed when the palette
 * only grew at its end (the append rule), every point when it was rewritten (compact) or the skin appeared or went.
 */
export function skinDirty(before: SkinWeights | null, after: SkinWeights | null): DirtySet {
  const none = new Uint32Array(0);
  const base = { topology: false, edges: none, faces: none, corners: none, layers: SKIN_LAYERS };
  if (before === null && after === null) return { ...base, points: none, layers: [] };
  if (before === null || after === null || before.points !== after.points) return { ...base, points: 'all' };
  const prefix =
    after.palette.length >= before.palette.length && samePalette(before.palette, after.palette, before.palette.length);
  if (!prefix) return { ...base, points: 'all' };
  const points: number[] = [];
  for (let v = 0; v < before.points; v++) {
    for (let k = 0; k < MAX_INFLUENCES; k++) {
      if (
        before.joints[4 * v + k] !== after.joints[4 * v + k] ||
        before.weights[4 * v + k] !== after.weights[4 * v + k]
      ) {
        points.push(v);
        break;
      }
    }
  }
  const paletteGrew = after.palette.length !== before.palette.length;
  if (points.length === 0 && !paletteGrew) return { ...base, points: none, layers: [] };
  return { ...base, points: Uint32Array.from(points) };
}
