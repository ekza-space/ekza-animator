// B3's op toolkit (M6A-SPEC §9 B3): small traversal, selection, argument and vector helpers shared by the core
// topology ops (extrude, inset, loops, connect, merge family, delete family, fill, bridge). Lives inside B3's
// `ops/extrude/` directory (§9 Dirs); nothing outside B3's op directories imports it. Kernel code (lazy chunk):
// every entry references `KERNEL_MARKER` through `kernelError`.
import { coerceArgs, type ParamValue, type ParamValues } from '@ekza-animator/anim-core';
import { kernelError } from '../../../kernel';
import { selectionOf } from '../../../selection';
import type {
  ComponentKind,
  ComponentSelection,
  EditMesh,
  HiddenSet,
  MeshOpDescriptor,
  OpFrame,
  OpResult,
  OpWarning,
} from '../../../types';

// ---------- arguments ----------

/** The op's args after defaults and coercion (§4.1 `coerceArgs`; problems are the runner's to report). */
export function resolveArgs(desc: MeshOpDescriptor, args: ParamValues | null | undefined): Record<string, ParamValue> {
  return { ...coerceArgs(desc.params, args ?? {}).args };
}

export function num(args: Readonly<Record<string, ParamValue>>, name: string, fallback = 0): number {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function bool(args: Readonly<Record<string, ParamValue>>, name: string, fallback = false): boolean {
  const value = args[name];
  return typeof value === 'boolean' ? value : fallback;
}

export function str(args: Readonly<Record<string, ParamValue>>, name: string, fallback: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : fallback;
}

// ---------- traversal ----------

/** The corners of face `f` in winding order. */
export function faceCorners(m: EditMesh, f: number, out: number[] = []): number[] {
  out.length = 0;
  const start = m.faceCorner(f);
  if (start === -1) return out;
  let c = start;
  const max = m.counts.corners;
  do {
    out.push(c);
    c = m.cornerNext(c);
  } while (c !== start && out.length <= max);
  return out;
}

/** The vertices of face `f` in winding order. */
export function faceVerts(m: EditMesh, f: number): number[] {
  return faceCorners(m, f).map((c) => m.cornerVert(c));
}

/** The corner of face `f` at vertex `v` (the first one in winding order), or −1. */
export function cornerAt(m: EditMesh, f: number, v: number): number {
  const start = m.faceCorner(f);
  if (start === -1) return -1;
  let c = start;
  let guard = 0;
  do {
    if (m.cornerVert(c) === v) return c;
    c = m.cornerNext(c);
  } while (c !== start && ++guard <= m.counts.corners);
  return -1;
}

/** The corners of edge `e`'s radial cycle (ascending, the kernel's canonical order). */
export function edgeCorners(m: EditMesh, e: number, out: number[] = []): number[] {
  out.length = 0;
  const start = m.edgeCorner(e);
  if (start === -1) return out;
  let c = start;
  const max = m.counts.corners;
  do {
    out.push(c);
    c = m.cornerRadialNext(c);
  } while (c !== start && out.length <= max);
  return out;
}

/** The faces using edge `e` (one per corner of its radial cycle). */
export function edgeFaces(m: EditMesh, e: number): number[] {
  return edgeCorners(m, e).map((c) => m.cornerFace(c));
}

/** The edges at vertex `v` (disk order: ascending). */
export function vertEdges(m: EditMesh, v: number, out: number[] = []): number[] {
  out.length = 0;
  const start = m.vertEdge(v);
  if (start === -1) return out;
  let e = start;
  const max = m.counts.edges;
  do {
    out.push(e);
    e = m.edgeDiskNext(e, v);
  } while (e !== start && e !== -1 && out.length <= max);
  return out;
}

/** The corners at vertex `v` (every face side through v), ascending and without repeats. */
export function vertCorners(m: EditMesh, v: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const e of vertEdges(m, v)) {
    for (const c of edgeCorners(m, e)) {
      // A corner at v runs one of v's edges outward; the corner before it runs the other one inward.
      const at = m.cornerVert(c) === v ? c : m.cornerVert(m.cornerNext(c)) === v ? m.cornerNext(c) : -1;
      if (at !== -1 && !seen.has(at)) {
        seen.add(at);
        out.push(at);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** The faces around vertex `v` (ascending, without repeats). */
export function vertFaces(m: EditMesh, v: number): number[] {
  const faces = new Set<number>();
  for (const c of vertCorners(m, v)) faces.add(m.cornerFace(c));
  return [...faces].sort((a, b) => a - b);
}

/** The corner of face `f` that runs edge `e` (from its corner's vertex to the next), or −1. */
export function cornerOnEdge(m: EditMesh, f: number, e: number): number {
  for (const c of edgeCorners(m, e)) if (m.cornerFace(c) === f) return c;
  return -1;
}

// ---------- hidden components and selections ----------

export function isHiddenFace(hidden: HiddenSet | null, f: number): boolean {
  return hidden !== null && hidden.faces.has(f);
}
export function isHiddenEdge(hidden: HiddenSet | null, e: number): boolean {
  return hidden !== null && hidden.edges.has(e);
}
export function isHiddenVert(hidden: HiddenSet | null, v: number): boolean {
  return hidden !== null && hidden.verts.has(v);
}

/** Selected components of `kind` (ascending), without hidden ones and indices past the mesh's counts. */
export function selected(
  m: EditMesh,
  sel: ComponentSelection | null,
  kind: ComponentKind,
  hidden: HiddenSet | null,
): number[] {
  if (sel === null) return [];
  const set = kind === 'vertex' ? sel.verts : kind === 'edge' ? sel.edges : sel.faces;
  const limit = kind === 'vertex' ? m.counts.points : kind === 'edge' ? m.counts.edges : m.counts.faces;
  const out: number[] = [];
  set.forEach((i) => {
    if (i >= limit) return;
    if (
      kind === 'vertex' ? isHiddenVert(hidden, i) : kind === 'edge' ? isHiddenEdge(hidden, i) : isHiddenFace(hidden, i)
    )
      return;
    out.push(i);
  });
  return out;
}

/** The pick order of `sel` restricted to `indices` (then the remaining indices ascending). */
export function pickOrder(sel: ComponentSelection | null, indices: readonly number[]): number[] {
  const wanted = new Set(indices);
  const out: number[] = [];
  const seen = new Set<number>();
  if (sel?.order !== null && sel?.order !== undefined) {
    for (const i of sel.order) {
      if (wanted.has(i) && !seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  for (const i of indices) if (!seen.has(i)) out.push(i);
  return out;
}

/** The vertices the components of `kind` touch (ascending). */
export function touchedVerts(m: EditMesh, kind: ComponentKind, indices: readonly number[]): number[] {
  const out = new Set<number>();
  for (const i of indices) {
    if (kind === 'vertex') out.add(i);
    else if (kind === 'edge') {
      out.add(m.edgeVert(i, 0));
      out.add(m.edgeVert(i, 1));
    } else for (const v of faceVerts(m, i)) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** A result selection of `kind` holding `indices` (pick order as given). */
export function selectionResult(m: EditMesh, kind: ComponentKind, indices: readonly number[]): ComponentSelection {
  return selectionOf(kind, indices, m.counts);
}

/** An `OpResult` (frozen arrays are the caller's). */
export function opResult(
  selection: ComponentSelection,
  warnings: readonly OpWarning[],
  resolvedArgs: ParamValues,
  extra?: { readonly frame?: OpFrame; readonly adjust?: (patch: ParamValues) => boolean },
): OpResult {
  return {
    selection,
    warnings,
    resolvedArgs: Object.freeze({ ...resolvedArgs }),
    ...(extra?.frame === undefined ? {} : { frame: extra.frame }),
    ...(extra?.adjust === undefined ? {} : { adjust: extra.adjust }),
  };
}

// ---------- removal bookkeeping ----------

/**
 * Where the surviving elements of a domain end up when `removed` (pre-op indices) are removed in descending order with
 * the kernel's rule (M6A-B1-2) and no element of the domain was created before them in the transaction: each hole
 * takes the last element. Returns old index → new index (−1 removed). Ops call it only for domains in which they
 * create nothing before removing (the merge family's vertices), and run as the first writer of their transaction
 * (MeshRuntime and MeshOpSession open one transaction per op run).
 */
export function removalMap(count: number, removed: readonly number[]): Int32Array {
  const at = new Int32Array(count);
  for (let i = 0; i < count; i++) at[i] = i;
  const slots = new Int32Array(count); // slot → original index
  for (let i = 0; i < count; i++) slots[i] = i;
  let n = count;
  const order = [...new Set(removed)].sort((a, b) => b - a);
  for (const k of order) {
    if (k < 0 || k >= n) throw kernelError('invalid-argument', `removalMap: index ${k} outside 0…${n - 1}`);
    const gone = slots[k] as number;
    at[gone] = -1;
    const last = n - 1;
    if (k !== last) {
      const moved = slots[last] as number;
      slots[k] = moved;
      at[moved] = k;
    }
    n--;
  }
  return at;
}

// ---------- vectors (float64, length-3 tuples) ----------

export type V3 = [number, number, number];

export function pos(m: EditMesh, v: number): V3 {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}
export const add = (a: Readonly<V3>, b: Readonly<V3>): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Readonly<V3>, b: Readonly<V3>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Readonly<V3>, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Readonly<V3>, b: Readonly<V3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Readonly<V3>, b: Readonly<V3>): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Readonly<V3>): number => Math.sqrt(dot(a, a));
export const lerp3 = (a: Readonly<V3>, b: Readonly<V3>, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** `a` normalized, or `fallback` when its length is zero or not finite. */
export function normalize(a: Readonly<V3>, fallback: Readonly<V3> = [0, 1, 0]): V3 {
  const l = length(a);
  if (!(l > 0) || !Number.isFinite(l)) return [fallback[0], fallback[1], fallback[2]];
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** The unnormalized Newell vector of face `f` (twice the vector area). */
export function newell(m: EditMesh, f: number): V3 {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const corners = faceCorners(m, f);
  for (const c of corners) {
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(m.cornerNext(c));
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
  }
  return [x, y, z];
}

/** The vertex average of face `f`. */
export function faceCentroid(m: EditMesh, f: number): V3 {
  const verts = faceVerts(m, f);
  let c: V3 = [0, 0, 0];
  for (const v of verts) c = add(c, pos(m, v));
  return scale(c, 1 / Math.max(1, verts.length));
}

/** Writes a float64 position (stored through `Math.fround` by the kernel). */
export function setPos(m: EditMesh, v: number, p: Readonly<V3>): void {
  m.setPosition(v, p[0], p[1], p[2]);
}

/** Sorted unique numbers. */
export function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
