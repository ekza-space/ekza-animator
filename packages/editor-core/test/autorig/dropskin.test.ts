// AUTORIG-SPEC §9 CR-AR-6 (D3: the missing test of the landed, now typed, `mesh.importStatic {dropSkin}`): a skinned
// GLB is refused without it ("Open skinned models as characters (File › Open)", `import.skinned`); with it the meshes
// import as plain scene meshes at their bind pose — the skin layers dropped, the skinned node's transform ignored —
// in one undo step, and they make a character like any static mesh.
import { readFileSync } from 'node:fs';
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { describe, expect, it } from 'vitest';
import { kernelMeshes, type OperatorResult } from '../../src';
import { meshTestApp } from '../mesh/support';
import { skinnedCopy } from './glb';

/** The value of a finished run (fails the test otherwise). */
function valueOf<T>(result: OperatorResult<unknown>): T {
  if (result.status !== 'finished') throw new Error(JSON.stringify(result));
  return result.value as T;
}

const cubeLad = (): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../../../fixtures/models/cube-lad.glb', import.meta.url)));

describe('mesh.importStatic {dropSkin} (CR-AR-6)', () => {
  it('refuses a skinned GLB without dropSkin', async () => {
    const { app } = await meshTestApp();
    expect(await app.runUntyped('mesh.importStatic', { bytes: skinnedCopy(cubeLad()), name: 'lad.glb' })).toMatchObject(
      {
        status: 'failed',
        error: { code: 'import.skinned', message: 'Open skinned models as characters (File › Open)' },
      },
    );
    expect(app.store.list('meshes')).toHaveLength(0);
    expect(app.history.canUndo()).toBe(false);
  });

  it('imports the meshes at the bind pose without their skin, in one step', async () => {
    const { app } = await meshTestApp();
    const plain = await app.runUntyped('mesh.importStatic', { bytes: cubeLad(), name: 'lad.glb' });
    const plainMesh = valueOf<{ meshes: MeshId[] }>(plain).meshes[0] as MeshId;

    const result = await app.runUntyped('mesh.importStatic', {
      bytes: skinnedCopy(cubeLad()),
      name: 'lad-rigged.glb',
      dropSkin: true,
    });
    const meshes = valueOf<{ meshes: MeshId[] }>(result).meshes;
    expect(meshes).toHaveLength(1);
    const record = app.store.get('meshes', meshes[0] as MeshId);
    expect(record).toMatchObject({ owner: { scene: true }, skin: null, parent: null });
    // the bind pose: the skinned node's +5 m translation is ignored
    expect(record?.placement.t).toEqual([0, 0, 0]);
    expect(app.history.peekUndo()?.label).toBe('Import Static Model');

    // the data equals the unskinned import's, without the skin layers
    const runtimes = kernelMeshes(app);
    for (let i = 0; i < 200 && (runtimes?.get(meshes[0] as MeshId)?.data() ?? null) === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const data = runtimes?.get(meshes[0] as MeshId)?.data();
    const reference = runtimes?.get(plainMesh)?.data();
    expect(data).toBeDefined();
    expect(data?.layers.has('skin.joints')).toBe(false);
    expect(data?.layers.has('skin.weights')).toBe(false);
    expect(Array.from(data?.position ?? [])).toEqual(Array.from(reference?.position ?? []));

    // a re-rigged mesh makes a character like any static mesh
    const made = await app.runUntyped('char.fromModel', { objects: meshes });
    expect(app.store.query.meshesOfOwner(valueOf<{ character: CharacterId }>(made).character)).toHaveLength(1);
  });
});
