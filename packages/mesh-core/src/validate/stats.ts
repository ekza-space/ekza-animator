// `topologyStats` (M6A-SPEC §4.3): shells (faces connected through shared vertices), boundary loops (border edges —
// one face — connected through shared vertices; two loops touching at a vertex count as one), Euler characteristic
// χ = V − E + F, non-manifold edges (> 2 faces) and vertices (fan not one disc), genus of a closed manifold
// ((2·shells − χ) / 2; null otherwise), triangles after triangulation (Σ n − 2) and n-gons (> 4 corners).
import { isEditMesh } from '../core/access';
import { editMeshFrom } from '../core/edit';
import { KERNEL_MARKER } from '../kernel';
import type { EditMesh, MeshData, TopologyStats } from '../types';

class UnionFind {
  private readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(i: number): number {
    let root = i;
    while ((this.parent[root] as number) !== root) root = this.parent[root] as number;
    let node = i;
    while ((this.parent[node] as number) !== root) {
      const next = this.parent[node] as number;
      this.parent[node] = root;
      node = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export function topologyStats(m: MeshData | EditMesh): TopologyStats {
  const mesh = isEditMesh(m) ? m : editMeshFrom(m);
  const { points: P, edges: E, faces: F } = mesh.counts;
  let triangles = 0;
  let ngons = 0;
  const shells = new UnionFind(P);
  const hasFace = new Uint8Array(P);
  for (let f = 0; f < F; f++) {
    const start = mesh.faceCorner(f);
    const first = mesh.cornerVert(start);
    let n = 0;
    let c = start;
    do {
      const v = mesh.cornerVert(c);
      hasFace[v] = 1;
      shells.union(first, v);
      c = mesh.cornerNext(c);
      n++;
    } while (c !== start);
    triangles += n - 2;
    if (n > 4) ngons++;
  }
  const shellRoots = new Set<number>();
  for (let v = 0; v < P; v++) if (hasFace[v] === 1) shellRoots.add(shells.find(v));

  let nonManifoldEdges = 0;
  const border = new UnionFind(P);
  const onBorder = new Uint8Array(P);
  for (let e = 0; e < E; e++) {
    const faces = mesh.edgeFaceCount(e);
    if (faces > 2) nonManifoldEdges++;
    if (faces === 1) {
      const a = mesh.edgeVert(e, 0);
      const b = mesh.edgeVert(e, 1);
      onBorder[a] = 1;
      onBorder[b] = 1;
      border.union(a, b);
    }
  }
  const loopRoots = new Set<number>();
  for (let v = 0; v < P; v++) if (onBorder[v] === 1) loopRoots.add(border.find(v));

  let nonManifoldVerts = 0;
  for (let v = 0; v < P; v++) if (hasFace[v] === 1 && !mesh.isManifoldVert(v)) nonManifoldVerts++;

  const euler = P - E + F;
  const closedManifold =
    F > 0 && loopRoots.size === 0 && nonManifoldEdges === 0 && nonManifoldVerts === 0 && KERNEL_MARKER.length > 0;
  const genus2 = 2 * shellRoots.size - euler;
  const genus = closedManifold && genus2 >= 0 && genus2 % 2 === 0 ? genus2 / 2 : null;
  return {
    shells: shellRoots.size,
    boundaryLoops: loopRoots.size,
    euler,
    nonManifoldEdges,
    nonManifoldVerts,
    genus,
    triangles,
    ngons,
  };
}
