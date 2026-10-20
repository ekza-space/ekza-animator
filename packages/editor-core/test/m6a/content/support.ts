// Shared helpers of B13's editor-core tests (M6A-SPEC §9 B13): an app over the real doc store and kernel (B7's
// `meshTestApp`), paint strokes committed through the runtime (B11 registers `mesh.paint`; until then the tests commit
// the kernel op directly, as its operator would), counts, world bounds and READY probes.
import type { MeshId } from '@ekza-animator/doc';
import { MESH_OPS } from '@ekza-animator/mesh-core';
import { type MeshTestApp, meshTestApp } from '../../mesh/support';

export { meshTestApp, type MeshTestApp };

/** `V/E/F` of a mesh's current revision, or null. */
export function counts(t: MeshTestApp, id: string): string | null {
  const c = t.app.meshes.get(id as MeshId)?.data()?.counts;
  return c === undefined ? null : `${c.points}/${c.edges}/${c.faces}`;
}

/** Paints faces of meshes through the runtime's commit (one doc step), like `mesh.paint` with explicit faces. */
export function paintFaces(t: MeshTestApp, id: string, faces: readonly number[], slot: number): void {
  const op = MESH_OPS['mesh.paint'];
  if (op === undefined) throw new Error('no mesh.paint');
  t.app.store.transact({ label: 'Assign Colour' }, (tx) =>
    t.meshes.commitOp(
      tx,
      op,
      [id as MeshId],
      { slot, faces: [...faces] },
      {
        seed: 'paint',
        kind: null,
      },
    ),
  );
}

/** The paint slot of every face of a mesh. */
export function faceSlots(t: MeshTestApp, id: string): number[] {
  const data = t.app.meshes.get(id as MeshId)?.data();
  if (data === null || data === undefined) return [];
  const layer = data.layers.get('paint');
  return Array.from({ length: data.counts.faces }, (_, f) => (layer === undefined ? 0 : (layer.data[f] as number)));
}

/** Runs an operator and returns its value (fails the test on any other status). */
export async function runValue<T>(t: MeshTestApp, id: string, args?: unknown, ctx?: object): Promise<T> {
  const result = await t.app.runUntyped(id, args, ctx);
  if (result.status !== 'finished') throw new Error(`${id}: ${JSON.stringify(result)}`);
  return result.value as T;
}

/** The poll reason of an operator for args (null when it passes). */
export function pollReason(t: MeshTestApp, id: string, args?: unknown): string | null {
  const verdict = t.app.operators.poll(id, {}, args);
  return verdict === true ? null : verdict.reason;
}

export function selectObjects(t: MeshTestApp, ids: readonly string[]): void {
  const state = t.app.session.getState();
  t.app.session.setState({ selection: { ...state.selection, objects: ids as never } });
}

export const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

export const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
