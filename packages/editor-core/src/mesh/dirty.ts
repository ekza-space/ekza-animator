// Dirty-set arithmetic for the runtime caches and incremental revision writes (M6A-SPEC §4.3 `DirtySet`, §5.4
// "caches update only dirty faces", §5.20 incremental writes).
import type { DirtySet, EditMesh, MeshCounts, MeshDelta } from '@ekza-studio/mesh-core';

type Indices = Uint32Array | 'all';

export const CLEAN: DirtySet = Object.freeze({
  topology: false,
  points: new Uint32Array(0),
  edges: new Uint32Array(0),
  faces: new Uint32Array(0),
  corners: new Uint32Array(0),
  layers: [],
});

export const ALL_DIRTY: DirtySet = Object.freeze({
  topology: true,
  points: 'all',
  edges: 'all',
  faces: 'all',
  corners: 'all',
  layers: [],
});

function union(a: Indices, b: Indices): Indices {
  if (a === 'all' || b === 'all') return 'all';
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint32Array(a.length + b.length);
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < a.length || j < b.length) {
    const x = i < a.length ? (a[i] as number) : Infinity;
    const y = j < b.length ? (b[j] as number) : Infinity;
    const v = x <= y ? x : y;
    if (x === v) i++;
    if (y === v) j++;
    if (n === 0 || out[n - 1] !== v) out[n++] = v;
  }
  return out.slice(0, n);
}

/** The union of two dirty sets (sorted index arrays stay sorted and unique). */
export function mergeDirty(a: DirtySet, b: DirtySet): DirtySet {
  if (a === CLEAN) return b;
  if (b === CLEAN) return a;
  return {
    topology: a.topology || b.topology,
    points: union(a.points, b.points),
    edges: union(a.edges, b.edges),
    faces: union(a.faces, b.faces),
    corners: union(a.corners, b.corners),
    layers: [...new Set([...a.layers, ...b.layers])],
  };
}

/** The dirty union of several deltas (CLEAN for none). */
export function dirtyOf(deltas: readonly MeshDelta[]): DirtySet {
  let out: DirtySet = CLEAN;
  for (const delta of deltas) out = mergeDirty(out, delta.dirty);
  return out;
}

/** True when a dirty set names nothing. */
export function isClean(d: DirtySet): boolean {
  const none = (x: Indices): boolean => x !== 'all' && x.length === 0;
  return !d.topology && none(d.points) && none(d.edges) && none(d.faces) && none(d.corners) && d.layers.length === 0;
}

/** True when two meshes' counts are equal. */
export function sameCounts(a: MeshCounts, b: MeshCounts): boolean {
  return a.points === b.points && a.edges === b.edges && a.faces === b.faces && a.corners === b.corners;
}

/**
 * Faces whose triangulation may change: the dirty faces and every face around a dirty point (a moved vertex can flip
 * a quad's shorter diagonal). 'all' after a topology change or when the dirty set says so.
 */
export function trianglesDirty(m: EditMesh, d: DirtySet): Indices {
  if (d.topology || d.faces === 'all' || d.points === 'all') return 'all';
  if (d.points.length === 0) return d.faces;
  const faces = new Set<number>(d.faces);
  for (const v of d.points) {
    const first = m.vertEdge(v);
    if (first < 0) continue;
    let e = first;
    for (let guard = 0; guard < 1 << 20; guard++) {
      const c0 = m.edgeCorner(e);
      if (c0 >= 0) {
        let c = c0;
        for (let g2 = 0; g2 < 1 << 20; g2++) {
          faces.add(m.cornerFace(c));
          c = m.cornerRadialNext(c);
          if (c === c0 || c < 0) break;
        }
      }
      e = m.edgeDiskNext(e, v);
      if (e === first || e < 0) break;
    }
  }
  return Uint32Array.from([...faces].sort((a, b) => a - b));
}
