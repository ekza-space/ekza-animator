// Shared steps of the MeshSetOps (M6A-SPEC §5.13, ADR 0014 D7; owner B4). The runner (B7) opens a kernel transaction on
// every input and aborts it afterwards, so an op may use its inputs' edit meshes as scratch space and returns whole
// outputs (`MeshData`); inputs change only through the outputs.
import { BitSet } from '../bitset';
import { editMeshFrom } from '../core/edit';
import { selectionOf } from '../selection';
import type { ComponentSelection, EditMesh, MeshData, MeshSetInput, OpWarning } from '../types';
import { appendMeshMatrix } from './append';
import { copySubset } from './copy';
import { insetBoundary } from './inset';
import { faceCorners, killUnused, scopeFaces } from './support';

export const IDENTITY_MATRIX: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The faces of an input's selection (face mode; edge/vertex selections by containment), ascending. */
export function selectedFaces(input: MeshSetInput): number[] {
  return input.selection === null ? [] : scopeFaces(input.mesh, input.selection, null);
}

export function bitsOf(size: number, indices: Iterable<number>): BitSet {
  const bits = new BitSet(size);
  for (const i of indices) bits.add(i);
  return bits;
}

/** Shells: faces connected through shared vertices, each ascending, ordered by their lowest face. */
export function shells(m: EditMesh): number[][] {
  const F = m.counts.faces;
  const parent = Int32Array.from({ length: m.counts.points }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[x] !== r) {
      const next = parent[x] as number;
      parent[x] = r;
      x = next;
    }
    return r;
  };
  for (let f = 0; f < F; f++) {
    const corners = faceCorners(m, f);
    const root = find(m.cornerVert(corners[0] as number));
    for (const c of corners) {
      const r = find(m.cornerVert(c));
      if (r !== root) parent[Math.max(r, root)] = Math.min(r, root);
    }
  }
  const byRoot = new Map<number, number[]>();
  const out: number[][] = [];
  for (let f = 0; f < F; f++) {
    const root = find(m.cornerVert(m.faceCorner(f)));
    let list = byRoot.get(root);
    if (list === undefined) {
      list = [];
      byRoot.set(root, list);
      out.push(list);
    }
    list.push(f);
  }
  return out;
}

/** Removes `faces` from `m` with the edges and vertices only they used (descending: indices stay valid). */
export function removeFaces(m: EditMesh, faces: readonly number[]): void {
  const edges = new Set<number>();
  const verts = new Set<number>();
  for (const f of faces) {
    for (const c of faceCorners(m, f)) {
      edges.add(m.cornerEdge(c));
      verts.add(m.cornerVert(c));
    }
  }
  for (const f of [...faces].sort((a, b) => b - a)) m.killFace(f);
  killUnused(m, edges, verts);
}

/** `data` with `offset` applied to its boundary (a fresh edit mesh; the data itself is not changed). */
export function insetData(
  data: MeshData,
  offset: number,
  code: string,
): {
  readonly data: MeshData;
  readonly warnings: OpWarning[];
} {
  if (offset === 0) return { data, warnings: [] };
  const m = editMeshFrom(data);
  m.begin('inset');
  const warnings = insetBoundary(m, [...Array(m.counts.faces).keys()], offset, code);
  m.end();
  return { data: m.snapshot(), warnings };
}

/**
 * Appends a face subset of `m` to `m` itself as its own shell (boundary vertices duplicated), optionally inset, and
 * returns the new faces' selection. With `remove`, the original faces are removed first (Extract in place).
 */
export function detachInPlace(
  m: EditMesh,
  faces: readonly number[],
  materials: readonly string[],
  offset: number,
  code: string,
  remove: boolean,
): { readonly selection: ComponentSelection; readonly warnings: OpWarning[] } {
  const subset = copySubset(m, bitsOf(m.counts.faces, faces)).data;
  if (remove) removeFaces(m, faces);
  const { firstFace } = appendMeshMatrix(m, subset, IDENTITY_MATRIX, [materials, materials]);
  const created = Array.from({ length: subset.counts.faces }, (_, i) => firstFace + i);
  const warnings = insetBoundary(m, created, offset, code);
  return { selection: selectionOf('face', created, m.counts), warnings };
}
