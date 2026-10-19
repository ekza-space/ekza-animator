// Fixtures and checks shared by B2's tests (walkers, soft selection, symmetry, transforms). No Node APIs (the
// Chromium run imports it too).
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import {
  BitSet,
  type ComponentKind,
  type ComponentSelection,
  type EditMesh,
  editMeshFrom,
  type HiddenSet,
  type MeshData,
  primitive,
  selectionOf,
} from '../../src';
import { buildMeshData } from '../../src/testing';

export const IDENTITY: ReadonlyXf = Object.freeze({ t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] });

export function mesh(kind: Parameters<typeof primitive>[0], params: Record<string, number> = {}): EditMesh {
  return editMeshFrom(primitive(kind, params));
}

/** The vertex at a position (within 1e-6), or −1. */
export function vertexAt(m: EditMesh, x: number, y: number, z: number): number {
  const p = m.position;
  for (let v = 0; v < m.counts.points; v++) {
    if (
      Math.abs((p[3 * v] as number) - x) < 1e-6 &&
      Math.abs((p[3 * v + 1] as number) - y) < 1e-6 &&
      Math.abs((p[3 * v + 2] as number) - z) < 1e-6
    ) {
      return v;
    }
  }
  return -1;
}

/** The edge between the vertices at two positions, or −1. */
export function edgeAt(m: EditMesh, a: readonly number[], b: readonly number[]): number {
  return m.findEdge(vertexAt(m, a[0] ?? 0, a[1] ?? 0, a[2] ?? 0), vertexAt(m, b[0] ?? 0, b[1] ?? 0, b[2] ?? 0));
}

export function position(m: EditMesh, v: number): [number, number, number] {
  const p = m.position;
  return [p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number];
}

export function faceVerts(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}

export function faceCentroid(m: EditMesh, f: number): [number, number, number] {
  const vs = faceVerts(m, f);
  const out: [number, number, number] = [0, 0, 0];
  for (const v of vs) {
    const p = position(m, v);
    for (let k = 0; k < 3; k++) out[k] = (out[k] as number) + (p[k] as number) / vs.length;
  }
  return out;
}

export function edgeMid(m: EditMesh, e: number): [number, number, number] {
  const a = position(m, m.edgeVert(e, 0));
  const b = position(m, m.edgeVert(e, 1));
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** The faces of an edge (radial cycle). */
export function edgeFaces(m: EditMesh, e: number): number[] {
  const out: number[] = [];
  const first = m.edgeCorner(e);
  if (first < 0) return out;
  let c = first;
  do {
    out.push(m.cornerFace(c));
    c = m.cornerRadialNext(c);
  } while (c !== first);
  return out;
}

export function hiddenSet(
  m: EditMesh,
  parts: { readonly verts?: readonly number[]; readonly edges?: readonly number[]; readonly faces?: readonly number[] },
): HiddenSet {
  const verts = new BitSet(m.counts.points);
  const edges = new BitSet(m.counts.edges);
  const faces = new BitSet(m.counts.faces);
  for (const v of parts.verts ?? []) verts.add(v);
  for (const e of parts.edges ?? []) edges.add(e);
  for (const f of parts.faces ?? []) faces.add(f);
  return { verts, edges, faces };
}

/** Hides faces the way a face-mode hide does: the faces, and the edges and vertices no visible face uses. */
export function hideFaces(m: EditMesh, faces: readonly number[]): HiddenSet {
  const h = hiddenSet(m, { faces });
  const visibleVert = new Set<number>();
  const visibleEdge = new Set<number>();
  for (let f = 0; f < m.counts.faces; f++) {
    if (h.faces.has(f)) continue;
    const start = m.faceCorner(f);
    let c = start;
    do {
      visibleVert.add(m.cornerVert(c));
      visibleEdge.add(m.cornerEdge(c));
      c = m.cornerNext(c);
    } while (c !== start);
  }
  for (let v = 0; v < m.counts.points; v++) if (!visibleVert.has(v)) h.verts.add(v);
  for (let e = 0; e < m.counts.edges; e++) if (!visibleEdge.has(e)) h.edges.add(e);
  return h;
}

export function sel(m: EditMesh, kind: ComponentKind, indices: readonly number[]): ComponentSelection {
  return selectionOf(kind, indices, m.counts);
}

export function members(set: BitSet): number[] {
  return Array.from(set.toArray());
}

export function membersOf(s: ComponentSelection, kind: ComponentKind = s.kind): number[] {
  return members(kind === 'vertex' ? s.verts : kind === 'edge' ? s.edges : s.faces);
}

export const sorted = (xs: ArrayLike<number>): number[] => Array.from(xs).sort((a, b) => a - b);

/** Consecutive edges of an ordered loop share a vertex (and the last meets the first when closed). */
export function edgesChain(m: EditMesh, loop: ArrayLike<number>, closed: boolean): boolean {
  const n = loop.length;
  const shares = (a: number, b: number): boolean => {
    const av = [m.edgeVert(a, 0), m.edgeVert(a, 1)];
    return av.includes(m.edgeVert(b, 0)) || av.includes(m.edgeVert(b, 1));
  };
  for (let i = 0; i + 1 < n; i++) if (!shares(loop[i] as number, loop[i + 1] as number)) return false;
  return !closed || n < 3 || shares(loop[n - 1] as number, loop[0] as number);
}

/** Consecutive faces of an ordered face loop share an edge. */
export function facesChain(m: EditMesh, loop: ArrayLike<number>): boolean {
  for (let i = 0; i + 1 < loop.length; i++) {
    const a = faceVerts(m, loop[i] as number);
    const b = faceVerts(m, loop[i + 1] as number);
    if (a.filter((v) => b.includes(v)).length < 2) return false;
  }
  return true;
}

/** An open cylinder (no caps): `n` sides, `rings` rings of vertices along +Y. */
export function openCylinder(n: number, rings: number): MeshData {
  const positions: number[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      positions.push(0.5 * Math.sin(a), j / Math.max(1, rings - 1) - 0.5, -0.5 * Math.cos(a));
    }
  }
  const faces: number[][] = [];
  for (let j = 0; j + 1 < rings; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i;
      const b = j * n + ((i + 1) % n);
      faces.push([a, a + n, b + n, b]);
    }
  }
  return buildMeshData({ positions, faces });
}
