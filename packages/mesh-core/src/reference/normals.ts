// The one normals function (M6A-SPEC §5.4; reference implementation of B0a, B1 replaces it with the incremental
// one): face normals by Newell's method (a zero normal is [0, 1, 0]); corner normals as the angle-weighted average of
// the face normals of the corner's smooth fan — the run of faces around the vertex bounded by hard edges, border edges
// and non-manifold edges. A corner whose `normal.custom` value is non-zero uses it (normalized). The reference
// recomputes everything (`cache` and `dirty` are accepted and ignored).
import { EDGE_HARD } from '../constants';
import type { DirtySet, EditMesh, MeshData, Normals } from '../types';
import { isEditMesh, newell, topoOf } from './access';
import { editMeshFrom } from './editMesh';

const scratch = new Float64Array(3);

/** Resolves a nullable smoothingAngle arg (§5.3): null → 0 on faceted meshes, 30° (π/6) otherwise. */
export function resolveSmoothingAngle(value: number | null, faceted: boolean): number {
  if (value !== null && Number.isFinite(value)) return value;
  return faceted ? 0 : Math.PI / 6;
}

export function computeNormals(m: MeshData | EditMesh, _cache?: Normals, _dirty?: DirtySet): Normals {
  const mesh = isEditMesh(m) ? m : editMeshFrom(m);
  const t = topoOf(mesh);
  const { faces: F, corners: C } = mesh.counts;
  const p = mesh.position;
  const face = new Float32Array(3 * F);
  for (let f = 0; f < F; f++) {
    newell(t, f, scratch);
    const length = Math.hypot(scratch[0] as number, scratch[1] as number, scratch[2] as number);
    if (length > 0 && Number.isFinite(length)) {
      face[3 * f] = (scratch[0] as number) / length;
      face[3 * f + 1] = (scratch[1] as number) / length;
      face[3 * f + 2] = (scratch[2] as number) / length;
    } else {
      face[3 * f + 1] = 1;
    }
  }

  const corner = new Float32Array(3 * C);
  const done = new Uint8Array(C);
  const fan: number[] = [];
  const smooth = (e: number): boolean => (mesh.edgeFlags(e) & EDGE_HARD) === 0 && mesh.edgeFaceCount(e) === 2;
  /** The corner at `v` across edge `e` from corner `c` (whose face uses `e` at `v`). */
  const across = (c: number, e: number, v: number): number => {
    const owner = mesh.cornerEdge(c) === e ? c : mesh.cornerPrev(c);
    const q = mesh.cornerRadialNext(owner);
    return mesh.cornerVert(q) === v ? q : mesh.cornerNext(q);
  };
  const angleAt = (c: number): number => {
    const v = 3 * mesh.cornerVert(c);
    const a = 3 * mesh.cornerVert(mesh.cornerPrev(c));
    const b = 3 * mesh.cornerVert(mesh.cornerNext(c));
    const ux = (p[a] as number) - (p[v] as number);
    const uy = (p[a + 1] as number) - (p[v + 1] as number);
    const uz = (p[a + 2] as number) - (p[v + 2] as number);
    const wx = (p[b] as number) - (p[v] as number);
    const wy = (p[b + 1] as number) - (p[v + 1] as number);
    const wz = (p[b + 2] as number) - (p[v + 2] as number);
    const cross = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
    return Math.atan2(cross, ux * wx + uy * wy + uz * wz);
  };

  for (let c0 = 0; c0 < C; c0++) {
    if (done[c0] === 1) continue;
    const v = mesh.cornerVert(c0);
    fan.length = 0;
    fan.push(c0);
    done[c0] = 1;
    // Walk both ways around v across smooth edges; a closed fan ends back at c0.
    for (const first of [mesh.cornerEdge(mesh.cornerPrev(c0)), mesh.cornerEdge(c0)]) {
      let c = c0;
      let e = first;
      for (let guard = 0; guard <= C && smooth(e); guard++) {
        const next = across(c, e, v);
        if (next === c0 || done[next] === 1) break;
        fan.push(next);
        done[next] = 1;
        const inEdge = mesh.cornerEdge(mesh.cornerPrev(next));
        e = inEdge === e ? mesh.cornerEdge(next) : inEdge;
        c = next;
      }
    }
    let x = 0;
    let y = 0;
    let z = 0;
    for (const c of fan) {
      const f = mesh.cornerFace(c);
      const w = angleAt(c);
      x += w * (face[3 * f] as number);
      y += w * (face[3 * f + 1] as number);
      z += w * (face[3 * f + 2] as number);
    }
    const length = Math.hypot(x, y, z);
    for (const c of fan) {
      if (length > 1e-12 && Number.isFinite(length)) {
        corner[3 * c] = x / length;
        corner[3 * c + 1] = y / length;
        corner[3 * c + 2] = z / length;
      } else {
        const f = mesh.cornerFace(c);
        corner[3 * c] = face[3 * f] as number;
        corner[3 * c + 1] = face[3 * f + 1] as number;
        corner[3 * c + 2] = face[3 * f + 2] as number;
      }
    }
  }

  const custom = mesh.layer('normal.custom');
  if (custom !== undefined && custom.def.comps === 3) {
    for (let c = 0; c < C; c++) {
      const x = custom.get(c, 0);
      const y = custom.get(c, 1);
      const z = custom.get(c, 2);
      const length = Math.hypot(x, y, z);
      if (length > 0 && Number.isFinite(length)) {
        corner[3 * c] = x / length;
        corner[3 * c + 1] = y / length;
        corner[3 * c + 2] = z / length;
      }
    }
  }
  return { face, corner };
}
