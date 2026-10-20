// Where component transforms happen (M6A-SPEC §5.15; B12a): the picked vertices of the hilited meshes' visible
// selection of the current kind (the stored picks, never their symmetry partners: the run expands them itself and
// needs the picks for the source side, M6A-B2-12), the pivot (the world bounding-box centre of those vertices, Maya)
// and the Component frame (Z = the area-weighted average of the selected faces' normals, or of the normals of the faces
// around the selected vertices; X/Y by the region-frame rule of §5.8, as B2's `mesh.transformComponents` resolves it).
import { type Mat4, mat4Compose, mat4Decompose, type Quat, type Vec3 } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import { type EditorApp, worldPlacement } from '@ekza-animator/editor-core';
import type { ComponentKind, ComponentSelection, MeshData } from '@ekza-animator/mesh-core';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

/** One hilited mesh's share of a component transform. */
export interface MeshPicks {
  readonly mesh: MeshId;
  readonly data: MeshData;
  /** World-from-local matrix (the placement through the parents, as the kernel's `OpContext.placement`). */
  readonly world: Mat4;
  /** Picked vertices (ascending). */
  readonly verts: readonly number[];
  /** Picked faces (face mode only). */
  readonly faces: readonly number[];
}

/** Calls `fn` with every vertex of face `f` in winding order. */
export function forFaceVerts(data: MeshData, f: number, fn: (v: number) => void): void {
  const first = data.faceCorner[f];
  if (first === undefined) return;
  let c = first;
  let guard = 0;
  do {
    fn(data.cornerVert[c] as number);
    c = data.cornerNext[c] as number;
  } while (c !== first && ++guard <= data.counts.corners);
}

/** The vertices of a selection's components of its own kind. */
export function selectionVerts(data: MeshData, sel: ComponentSelection, kind: ComponentKind): number[] {
  const out = new Set<number>();
  if (kind === 'vertex') {
    sel.verts.forEach((v) => {
      if (v < data.counts.points) out.add(v);
    });
  } else if (kind === 'edge') {
    sel.edges.forEach((e) => {
      if (e >= data.counts.edges) return;
      out.add(data.edgeVerts[2 * e] as number);
      out.add(data.edgeVerts[2 * e + 1] as number);
    });
  } else {
    sel.faces.forEach((f) => {
      if (f < data.counts.faces) forFaceVerts(data, f, (v) => out.add(v));
    });
  }
  return [...out].sort((a, b) => a - b);
}

/** The world matrix of a mesh record (null for a missing record). */
export function meshWorld(app: EditorApp, mesh: MeshId): Mat4 | null {
  const record = app.store.get('meshes', mesh);
  return record === undefined ? null : mat4Compose(worldPlacement(app.store, record));
}

/** The picks of every hilited, ready mesh with a visible selection of `kind` (hilite order). */
export function componentPicks(app: EditorApp, kind: ComponentKind): MeshPicks[] {
  const out: MeshPicks[] = [];
  for (const mesh of app.session.getState().model.hilite) {
    const runtime = app.meshes.get(mesh);
    const data = runtime?.state === 'ready' ? runtime.data() : null;
    const world = meshWorld(app, mesh);
    if (data === null || world === null) continue;
    const sel = app.components.get(mesh, kind);
    const verts = selectionVerts(data, sel, kind);
    if (verts.length === 0) continue;
    const faces: number[] = [];
    if (kind === 'face') sel.faces.forEach((f) => (f < data.counts.faces ? faces.push(f) : undefined));
    out.push({ mesh, data, world, verts, faces });
  }
  return out;
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): Vec3 {
  return [
    (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
    (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
    (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
  ];
}

/** The world position of a vertex. */
export function worldVertex(picks: Pick<MeshPicks, 'data' | 'world'>, v: number): Vec3 {
  const p = picks.data.position;
  return transformPoint(picks.world, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number);
}

/** The world bounding-box centre of every picked vertex (null without picks). */
export function picksCentre(picks: readonly MeshPicks[]): Vec3 | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const mesh of picks) {
    for (const v of mesh.verts) {
      const w = worldVertex(mesh, v);
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k] as number, w[k] as number);
        hi[k] = Math.max(hi[k] as number, w[k] as number);
      }
    }
  }
  if (!(lo[0] <= hi[0])) return null;
  return [0.5 * (lo[0] + hi[0]), 0.5 * (lo[1] + hi[1]), 0.5 * (lo[2] + hi[2])];
}

/** Newell normal of a face (|n| = 2 × area), mesh-local. */
function faceNewell(data: MeshData, f: number): Vec3 {
  const p = data.position;
  const verts: number[] = [];
  forFaceVerts(data, f, (v) => verts.push(v));
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = 3 * (verts[i] as number);
    const b = 3 * (verts[(i + 1) % verts.length] as number);
    x += ((p[a + 1] as number) - (p[b + 1] as number)) * ((p[a + 2] as number) + (p[b + 2] as number));
    y += ((p[a + 2] as number) - (p[b + 2] as number)) * ((p[a] as number) + (p[b] as number));
    z += ((p[a] as number) - (p[b] as number)) * ((p[a + 1] as number) + (p[b + 1] as number));
  }
  return [x, y, z];
}

/** A normal (mesh-local) mapped to world by the inverse transpose of the matrix's linear part (not normalized). */
function normalToWorld(normal: Matrix3, n: Vec3): Vec3 {
  const v = new Vector3(n[0], n[1], n[2]).applyMatrix3(normal);
  return [v.x, v.y, v.z];
}

/** The rotation of a frame with these (orthonormal) world axes. */
export function quatOfAxes(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m = new Matrix4().makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...z));
  const q = new Quaternion().setFromRotationMatrix(m);
  return [q.x, q.y, q.z, q.w];
}

/** The region frame of a normal (§5.8): Z = n, X = the up axis (Y, or Z when n is near ±Y) made orthogonal. */
export function regionFrame(z: Vec3): Quat {
  const len = Math.hypot(z[0], z[1], z[2]);
  if (!(len > 1e-12)) return [0, 0, 0, 1];
  const Z: Vec3 = [z[0] / len, z[1] / len, z[2] / len];
  const U: Vec3 = Math.abs(Z[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  const d = U[0] * Z[0] + U[1] * Z[1] + U[2] * Z[2];
  const x0: Vec3 = [U[0] - d * Z[0], U[1] - d * Z[1], U[2] - d * Z[2]];
  const xl = Math.hypot(x0[0], x0[1], x0[2]);
  const X: Vec3 = [x0[0] / xl, x0[1] / xl, x0[2] / xl];
  const Y: Vec3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return quatOfAxes(X, Y, Z);
}

/**
 * The Component frame of the picks (world rotation): Z = the area-weighted sum of the selected faces' normals (face
 * mode) or of the unit normals of the faces around the picked vertices (vertex and edge modes), in world space.
 */
export function componentFrame(picks: readonly MeshPicks[], kind: ComponentKind): Quat {
  const sum: Vec3 = [0, 0, 0];
  const normals = new Map<MeshPicks, Matrix3>();
  const add = (mesh: MeshPicks, f: number, unit: boolean): void => {
    let normal = normals.get(mesh);
    if (normal === undefined) {
      normal = new Matrix3().getNormalMatrix(new Matrix4().fromArray(Array.from(mesh.world)));
      normals.set(mesh, normal);
    }
    const n = normalToWorld(normal, faceNewell(mesh.data, f));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) return;
    const k = unit ? 1 / len : 1;
    sum[0] += n[0] * k;
    sum[1] += n[1] * k;
    sum[2] += n[2] * k;
  };
  for (const mesh of picks) {
    if (kind === 'face') {
      for (const f of mesh.faces) add(mesh, f, false);
      continue;
    }
    const picked = new Set(mesh.verts);
    for (let f = 0; f < mesh.data.counts.faces; f++) {
      forFaceVerts(mesh.data, f, (v) => {
        if (picked.has(v)) add(mesh, f, true);
      });
    }
  }
  return regionFrame(sum);
}

/** The world rotation of a matrix (scale and shear dropped). */
export function rotationOf(world: Mat4): Quat {
  const q = mat4Decompose(world).q;
  return [q[0], q[1], q[2], q[3]];
}
