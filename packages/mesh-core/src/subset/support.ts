// Shared plumbing of the B4 ops (M6A-SPEC §9 B4: shape ops, Multi-Cut, Slide, Average, MeshSetOps): argument
// resolution, the component sets an op acts on, small traversal helpers, the temporary flag mark that lets an op find
// its elements again after removals moved them, orphan cleanup and the Euler-refusal guard. Kernel-internal (not in the
// barrel).
import { coerceArgs, EkzaError, type ParamDef, type ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../refusal';
import { selectionOf } from '../selection';
import type { ComponentKind, ComponentSelection, EditMesh, HiddenSet, Refusal } from '../types';

/**
 * A flag bit no stored mesh uses (edge bits 1/2/4 and face bit 1 are the stored flags, §4.3). Ops set it on the edges
 * or faces they must find again after removals moved indices (the mark travels with the element: moves copy the
 * stored arrays, splits copy flags, H4) and clear it before they return, so it never reaches a stored revision.
 */
export const TEMP_MARK = 0x80;

/** The op's args after defaults and coercion (§4.1 `coerceArgs`; invalid values fall back to the default). */
export function argsOf(params: readonly ParamDef[], args: ParamValues): ParamValues {
  return coerceArgs(params, args).args;
}

export function num(args: ParamValues, name: string, fallback: number): number {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function bool(args: ParamValues, name: string, fallback: boolean): boolean {
  const value = args[name];
  return typeof value === 'boolean' ? value : fallback;
}

export function str<T extends string>(args: ParamValues, name: string, fallback: T): T {
  const value = args[name];
  return typeof value === 'string' ? (value as T) : fallback;
}

// ---------- traversal ----------

/** The corners of face `f` in cycle order (from `faceCorner`). */
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

/** The vertices of face `f` in cycle order. */
export function faceVerts(m: EditMesh, f: number, out: number[] = []): number[] {
  out.length = 0;
  const start = m.faceCorner(f);
  if (start === -1) return out;
  let c = start;
  const max = m.counts.corners;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start && out.length <= max);
  return out;
}

/** The corners of edge `e`'s radial cycle (ascending, the canonical order). */
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

/** The edges of vertex `v`'s disk cycle (ascending, the canonical order). */
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

/** The distinct faces around vertex `v` (ascending). */
export function vertFaces(m: EditMesh, v: number): number[] {
  const faces = new Set<number>();
  const corners: number[] = [];
  for (const e of vertEdges(m, v)) {
    for (const c of edgeCorners(m, e, corners)) faces.add(m.cornerFace(c));
  }
  return [...faces].sort((a, b) => a - b);
}

/** The corner of face `f` at vertex `v` (the first in cycle order), or −1. */
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

/** True when face `f` visits a vertex more than once (ops that work on vertex pairs skip such faces). */
export function hasRepeatedVertex(m: EditMesh, f: number): boolean {
  const verts = faceVerts(m, f);
  const seen = new Set<number>();
  for (const v of verts) {
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
}

export function pos(m: EditMesh, v: number, out: Float64Array | number[], offset = 0): void {
  const p = m.position;
  out[offset] = p[3 * v] as number;
  out[offset + 1] = p[3 * v + 1] as number;
  out[offset + 2] = p[3 * v + 2] as number;
}

/** Area-weighted (Newell) normal of face `f`, not normalized, in float64. */
export function newellNormal(m: EditMesh, f: number, out: Float64Array): Float64Array {
  const p = m.position;
  let x = 0;
  let y = 0;
  let z = 0;
  const start = m.faceCorner(f);
  let c = start;
  let guard = 0;
  do {
    const next = m.cornerNext(c);
    const a = 3 * m.cornerVert(c);
    const b = 3 * m.cornerVert(next);
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    x += (ay - by) * (az + bz);
    y += (az - bz) * (ax + bx);
    z += (ax - bx) * (ay + by);
    c = next;
  } while (c !== start && ++guard <= m.counts.corners);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/** Vertex centroid of face `f` (float64). */
export function faceCentroid(m: EditMesh, f: number, out: Float64Array): Float64Array {
  const p = m.position;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  const verts = faceVerts(m, f);
  for (const v of verts) {
    out[0] = out[0] + (p[3 * v] as number);
    out[1] = out[1] + (p[3 * v + 1] as number);
    out[2] = out[2] + (p[3 * v + 2] as number);
  }
  const n = Math.max(1, verts.length);
  out[0] = out[0] / n;
  out[1] = out[1] / n;
  out[2] = out[2] / n;
  return out;
}

// ---------- component sets ----------

const isHidden = (set: { has(i: number): boolean } | undefined, i: number): boolean => set?.has(i) === true;

/**
 * The faces an op acts on, ascending: object mode (`sel` null) — every visible face; face mode — the selected visible
 * faces; edge and vertex modes — the visible faces whose every edge (vertex) is selected (Maya converts a selection to
 * the op's component kind; "contained" keeps the op on what the user can see selected).
 */
export function scopeFaces(m: EditMesh, sel: ComponentSelection | null, hidden: HiddenSet | null): number[] {
  const F = m.counts.faces;
  const out: number[] = [];
  const hiddenFaces = hidden?.faces;
  if (sel === null) {
    for (let f = 0; f < F; f++) if (!isHidden(hiddenFaces, f)) out.push(f);
    return out;
  }
  if (sel.kind === 'face') {
    sel.faces.forEach((f) => {
      if (f < F && !isHidden(hiddenFaces, f)) out.push(f);
    });
    return out;
  }
  const corners: number[] = [];
  for (let f = 0; f < F; f++) {
    if (isHidden(hiddenFaces, f)) continue;
    let all = true;
    for (const c of faceCorners(m, f, corners)) {
      const ok = sel.kind === 'edge' ? sel.edges.has(m.cornerEdge(c)) : sel.verts.has(m.cornerVert(c));
      if (!ok) {
        all = false;
        break;
      }
    }
    if (all) out.push(f);
  }
  return out;
}

/**
 * The edges an op acts on, ascending: object mode — every visible edge; edge mode — the selected visible edges; face
 * mode — the edges of the selected faces; vertex mode — the edges with both endpoints selected.
 */
export function scopeEdges(m: EditMesh, sel: ComponentSelection | null, hidden: HiddenSet | null): number[] {
  const E = m.counts.edges;
  const out: number[] = [];
  const hiddenEdges = hidden?.edges;
  if (sel === null) {
    for (let e = 0; e < E; e++) if (!isHidden(hiddenEdges, e)) out.push(e);
    return out;
  }
  if (sel.kind === 'edge') {
    sel.edges.forEach((e) => {
      if (e < E && !isHidden(hiddenEdges, e)) out.push(e);
    });
    return out;
  }
  if (sel.kind === 'vertex') {
    for (let e = 0; e < E; e++) {
      if (isHidden(hiddenEdges, e)) continue;
      if (sel.verts.has(m.edgeVert(e, 0)) && sel.verts.has(m.edgeVert(e, 1))) out.push(e);
    }
    return out;
  }
  const set = new Set<number>();
  const corners: number[] = [];
  for (const f of scopeFaces(m, sel, hidden)) {
    for (const c of faceCorners(m, f, corners)) {
      const e = m.cornerEdge(c);
      if (!isHidden(hiddenEdges, e)) set.add(e);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * The vertices an op acts on, ascending: object mode — every visible vertex; vertex mode — the selected visible
 * vertices; edge and face modes — the visible vertices the selected components touch.
 */
export function scopeVerts(m: EditMesh, sel: ComponentSelection | null, hidden: HiddenSet | null): number[] {
  const P = m.counts.points;
  const out: number[] = [];
  const hiddenVerts = hidden?.verts;
  if (sel === null) {
    for (let v = 0; v < P; v++) if (!isHidden(hiddenVerts, v)) out.push(v);
    return out;
  }
  if (sel.kind === 'vertex') {
    sel.verts.forEach((v) => {
      if (v < P && !isHidden(hiddenVerts, v)) out.push(v);
    });
    return out;
  }
  const set = new Set<number>();
  if (sel.kind === 'edge') {
    for (const e of scopeEdges(m, sel, hidden)) {
      set.add(m.edgeVert(e, 0));
      set.add(m.edgeVert(e, 1));
    }
  } else {
    const verts: number[] = [];
    for (const f of scopeFaces(m, sel, hidden)) for (const v of faceVerts(m, f, verts)) set.add(v);
  }
  return [...set].filter((v) => !isHidden(hiddenVerts, v)).sort((a, b) => a - b);
}

/** A selection of `kind` over `indices` for the mesh's current counts (`OpResult.selection`). */
export function resultSelection(m: EditMesh, kind: ComponentKind, indices: ArrayLike<number>): ComponentSelection {
  const sorted = Array.from(indices).sort((a, b) => a - b);
  return selectionOf(kind, sorted, m.counts);
}

/** The selection an op that keeps it returns: the input re-sized to the current counts, or an empty one. */
export function keptSelection(m: EditMesh, sel: ComponentSelection | null, kind: ComponentKind): ComponentSelection {
  if (sel === null) return selectionOf(kind, [], m.counts);
  const verts = sel.verts.clone();
  const edges = sel.edges.clone();
  const faces = sel.faces.clone();
  verts.resize(m.counts.points);
  edges.resize(m.counts.edges);
  faces.resize(m.counts.faces);
  return { kind: sel.kind, verts, edges, faces, order: sel.order, active: sel.active };
}

/**
 * Rewrites −0 as +0 in every float layer of `domain` at `index`. The §5.2 mirror helpers negate an axis component, which
 * turns a zero into −0; stored values stay canonical (a mirrored-twice mesh hashes like the original).
 */
export function positiveZeros(m: EditMesh, domain: 'point' | 'corner', index: number): void {
  for (const layer of m.layers()) {
    if (layer.def.domain !== domain || layer.def.type !== 'f32') continue;
    for (let k = 0; k < layer.def.comps; k++) if (Object.is(layer.get(index, k), -0)) layer.set(index, k, 0);
  }
}

// ---------- marks ----------

/** Sets `TEMP_MARK` on edge `e` (logged; cleared by `collectMarkedEdges`). */
export function markEdge(m: EditMesh, e: number): void {
  const flags = m.edgeFlags(e);
  if ((flags & TEMP_MARK) === 0) m.setEdgeFlags(e, flags | TEMP_MARK);
}

export function markFace(m: EditMesh, f: number): void {
  const flags = m.faceFlags(f);
  if ((flags & TEMP_MARK) === 0) m.setFaceFlags(f, flags | TEMP_MARK);
}

/** The edges carrying `TEMP_MARK` (ascending); the mark is cleared on every one. */
export function collectMarkedEdges(m: EditMesh): number[] {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    const flags = m.edgeFlags(e);
    if ((flags & TEMP_MARK) !== 0) {
      out.push(e);
      m.setEdgeFlags(e, flags & ~TEMP_MARK);
    }
  }
  return out;
}

/** The faces carrying `TEMP_MARK` (ascending); the mark is cleared on every one. */
export function collectMarkedFaces(m: EditMesh): number[] {
  const out: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const flags = m.faceFlags(f);
    if ((flags & TEMP_MARK) !== 0) {
      out.push(f);
      m.setFaceFlags(f, flags & ~TEMP_MARK);
    }
  }
  return out;
}

// ---------- cleanup ----------

/**
 * Orphan cleanup (§5.1, research 10 §4.0): kills the candidate edges no face uses, then the candidate vertices no edge
 * uses. Removals go in descending index order, so the candidates still to check keep their indices.
 */
export function killUnused(m: EditMesh, edges: Iterable<number>, verts: Iterable<number>): void {
  const edgeList = [...new Set(edges)].sort((a, b) => b - a);
  for (const e of edgeList) if (e < m.counts.edges && m.edgeFaceCount(e) === 0) m.killEdge(e);
  const vertList = [...new Set(verts)].sort((a, b) => b - a);
  for (const v of vertList) if (v < m.counts.points && m.vertEdge(v) === -1) m.killVert(v);
}

// ---------- refusals ----------

/**
 * Runs `body`; an Euler operator's refusal (`EkzaError('mesh-euler')`, a precondition the op could not see coming on
 * unusual input) becomes the op's refusal, so the op never throws on valid input (§5.1). The runtime aborts the log.
 */
export function guarded<T>(code: string, reason: string, body: () => T | Refusal): T | Refusal {
  try {
    return body();
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'mesh-euler') return refuse(code, `${reason} (${error.message})`);
    throw error;
  }
}
