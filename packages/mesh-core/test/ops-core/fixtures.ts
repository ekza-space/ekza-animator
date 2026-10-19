// Mesh fixtures for B3's op tests: primitives as edit meshes, two meshes combined into one stored form (Combine is
// B4's set-op; these tests need its V/E/F result only), and lookups of named components on the low-poly primitives.
import { BUILTIN_LAYERS, type EditMesh, editMeshFrom, EDGE_HARD, type MeshData, primitive } from '../../src';
import { buildMeshData } from '../../src/testing';
import { faceToward, faceVerts, position } from './support';

/** Positions, faces and edge flags of a stored mesh (corner layers dropped). */
function partsOf(data: MeshData): { positions: number[]; faces: number[][]; hard: boolean } {
  const m = editMeshFrom(data);
  const positions = Array.from(data.position);
  const faces: number[][] = [];
  for (let f = 0; f < data.counts.faces; f++) faces.push(faceVerts(m, f));
  let hard = true;
  for (let e = 0; e < data.counts.edges; e++) if ((data.edgeFlags[e] as number & EDGE_HARD) === 0) hard = false;
  return { positions, faces, hard };
}

/** `a` and `b` (b shifted by `offset`, optionally mirrored in X with reversed winding) as one stored mesh. */
export function combined(
  a: MeshData,
  b: MeshData,
  offset: readonly [number, number, number] = [0, 0, 0],
  mirrorX = false,
): MeshData {
  const pa = partsOf(a);
  const pb = partsOf(b);
  const base = pa.positions.length / 3;
  const positions = [...pa.positions];
  for (let i = 0; i < pb.positions.length; i += 3) {
    const x = pb.positions[i] as number;
    positions.push(
      (mirrorX ? -x : x) + offset[0],
      (pb.positions[i + 1] as number) + offset[1],
      (pb.positions[i + 2] as number) + offset[2],
    );
  }
  const faces = [
    ...pa.faces,
    ...pb.faces.map((f) => {
      const shifted = f.map((v) => v + base);
      return mirrorX ? shifted.reverse() : shifted;
    }),
  ];
  return buildMeshData({
    positions,
    faces,
    edgeFlags: pa.hard && pb.hard ? EDGE_HARD : 0,
    layers: [{ def: BUILTIN_LAYERS.paint }],
  });
}

/** A stored mesh from a face list (all edges hard, a paint layer). */
export function fromFaces(positions: readonly number[], faces: readonly (readonly number[])[], hard = true): MeshData {
  return buildMeshData({ positions, faces, edgeFlags: hard ? EDGE_HARD : 0, layers: [{ def: BUILTIN_LAYERS.paint }] });
}

export const cylinderData = (params: Readonly<Record<string, number>> = {}): MeshData => primitive('cylinder', params);
export const planeData = (params: Readonly<Record<string, number>> = {}): MeshData => primitive('plane', params);

/** An open 8-sided cylinder (both n-gon caps removed): 16/24/8. */
export function openCylinderData(): MeshData {
  const m = editMeshFrom(cylinderData());
  const parts = partsOf(m.snapshot());
  const faces = parts.faces.filter((f) => f.length === 4);
  return fromFaces(parts.positions, faces);
}

/** The edge of `m` joining the vertices nearest to `a` and `b`. */
export function edgeNear(
  m: EditMesh,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return m.findEdge(vertexNear(m, a), vertexNear(m, b));
}

export function vertexNear(m: EditMesh, p: readonly [number, number, number]): number {
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < m.counts.points; v++) {
    const q = position(m, v);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/** The top face of the low-poly cube and its four vertices. */
export function topOf(m: EditMesh): number {
  return faceToward(m, [0, 1, 0]);
}

/** Every edge of `m` whose direction is mostly along `axis` (0 x, 1 y, 2 z). */
export function edgesAlong(m: EditMesh, axis: 0 | 1 | 2): number[] {
  const out: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    const a = position(m, m.edgeVert(e, 0));
    const b = position(m, m.edgeVert(e, 1));
    const d = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])];
    if ((d[axis] as number) > 0.5 * Math.hypot(d[0] as number, d[1] as number, d[2] as number)) out.push(e);
  }
  return out;
}
