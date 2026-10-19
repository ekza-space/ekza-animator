// Shared helpers of the B12b editor-core tests (M6A-SPEC §5.8, §9 B12b): an editor app in Model with the B11 runtime
// chunk and the extrude engine loaded (as the editor loads both on the first Model entry), meshes in a component mode
// with a selection, counts and world positions.
import type { MeshId } from '@ekza-animator/doc';
import { type ComponentKind, editMeshFrom, type MeshData, primitive, selectionOf } from '@ekza-animator/mesh-core';
import { loadExtrudeEngine, loadOpsRuntime, switchWorkspace } from '../../src';
import { createMesh, type MeshTestApp, meshTestApp } from '../mesh/support';

export interface ModelTest extends MeshTestApp {
  readonly id: MeshId;
}

/** A Model app with one mesh (a 1 m cube unless `data` is given), hilited in `mode` with `pick` selected. */
export async function modelWith(
  mode: ComponentKind,
  pick: (data: MeshData) => readonly number[],
  data: MeshData = primitive('cube', {}),
  fields: Parameters<typeof createMesh>[3] = {},
): Promise<ModelTest> {
  const t = await meshTestApp();
  switchWorkspace(t.app, 'model');
  await loadOpsRuntime();
  await loadExtrudeEngine();
  const id = createMesh(t, 'msh_Cube', data, fields);
  t.app.history.clear();
  t.app.session.setState({ model: { ...t.app.session.getState().model, componentMode: mode, hilite: [id] } });
  t.meshes.select(id, selectionOf(mode, pick(data), data.counts));
  return { ...t, id };
}

export function counts(t: MeshTestApp, id: MeshId): string {
  const c = t.app.meshes.get(id)?.data()?.counts;
  return c === undefined ? 'none' : `${c.points}/${c.edges}/${c.faces}`;
}

export function dataOf(t: MeshTestApp, id: MeshId): MeshData {
  const data = t.app.meshes.get(id)?.data();
  if (data === undefined || data === null) throw new Error(`no data for ${id}`);
  return data;
}

/** Vertex indices of a face, winding order. */
export function faceVerts(data: MeshData, f: number): number[] {
  const m = editMeshFrom(data);
  const out: number[] = [];
  const first = m.faceCorner(f);
  let c = first;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== first);
  return out;
}

export function position(data: MeshData, v: number): [number, number, number] {
  return [data.position[3 * v] as number, data.position[3 * v + 1] as number, data.position[3 * v + 2] as number];
}

/** Centroid of a face's vertices. */
export function faceCentroid(data: MeshData, f: number): [number, number, number] {
  const verts = faceVerts(data, f);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of verts) {
    const p = position(data, v);
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / verts.length, y / verts.length, z / verts.length];
}

/** The face whose centroid is highest along `axis` (the cube's top for Y). */
export function extremeFace(data: MeshData, axis: 0 | 1 | 2 = 1): number {
  let best = -1;
  let bestValue = -Infinity;
  for (let f = 0; f < data.counts.faces; f++) {
    const value = faceCentroid(data, f)[axis];
    if (value > bestValue + 1e-9) {
      bestValue = value;
      best = f;
    }
  }
  return best;
}

export const topFace = (data: MeshData): number[] => [extremeFace(data, 1)];

export function undoLabels(t: MeshTestApp): readonly string[] {
  return (t.app.history as unknown as { labels(): { undo: readonly string[] } }).labels().undo;
}

/** Lets the async parts (adjusts, loads, microtasks) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

/** A cube rotated by `angle` about X in its own data (its top face tilted). */
export function tiltedCube(angle: number): MeshData {
  const m = editMeshFrom(primitive('cube', {}));
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m.begin('tilt');
  for (let v = 0; v < m.counts.points; v++) {
    const x = m.position[3 * v] as number;
    const y = m.position[3 * v + 1] as number;
    const z = m.position[3 * v + 2] as number;
    m.setPosition(v, x, c * y - s * z, s * y + c * z);
  }
  m.end();
  return m.snapshot();
}
