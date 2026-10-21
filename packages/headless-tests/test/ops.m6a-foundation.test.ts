// M6A-SPEC §9 B0a tests over the real kernel (headless): importing a character writes no `meshes` record and keeps
// the saved project readable by M2a writers (minWriterVersion ≤ 2, characters carry `source`, assets
// `provenance: null`); a mesh revision written through the stub runtime registry makes the project need writer 3,
// and the M6a session/history wiring works on the real app.
import type { MeshId, MeshRecord } from '@ekza-studio/doc';
import { loadMeshKernel } from '@ekza-studio/editor-core';
import { readProjectArchive } from '@ekza-studio/io';
import { describe, expect, it } from 'vitest';
import { importFixture, realApp, runOk } from './ops.support';

const cubeRecord = (id: string): MeshRecord => ({
  id: id as MeshId,
  name: 'Cube',
  owner: { scene: true },
  parent: null,
  order: 'a0',
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  pivot: [0, 0, 0],
  source: null,
  data: null,
  faceted: true,
  generator: { kind: 'cube', params: {}, version: 1 },
  palette: null,
  material: { preset: 'unlit' },
  colourOutput: 'palette-texture',
  skin: null,
  budget: null,
  handheld: null,
  deleted: null,
});

describe('M6a foundation over the real kernel', () => {
  it('importing a character writes no meshes record and saves for M2a writers (minWriterVersion ≤ 2)', async () => {
    const { app, services } = realApp();
    const bot = await importFixture(app, 'polybot.vrm');
    expect(app.store.list('meshes')).toEqual([]);
    const character = app.store.get('characters', bot.character);
    expect(character?.source).toEqual({ kind: 'asset', asset: character?.asset });
    expect(app.store.list('assets').map((asset) => asset.provenance)).toEqual([null]);
    await runOk(app, 'file.save', { fileName: 'bot.ekzanim' });
    const saved = await readProjectArchive(services.downloads.at(-1)?.bytes ?? new Uint8Array(0));
    expect(saved.snapshot.schemaVersion).toBe(4); // M6B-SPEC §3 rule 9 (schema v4)
    expect(saved.snapshot.minWriterVersion).toBeLessThanOrEqual(2);
    expect(Object.keys(saved.snapshot.tables.meshes ?? {})).toEqual([]);
  });

  it('a mesh revision (writeData) makes the saved project need writer 3; its runtime is ready', async () => {
    const kernel = await loadMeshKernel();
    const { app, services } = realApp();
    const id = 'msh_Cube' as MeshId;
    const ref = app.store.transact({ label: 'Create Cube' }, (tx) => {
      tx.put('meshes', cubeRecord(id));
      return app.meshes.writeData(tx, id, kernel.primitive('cube', {}));
    });
    expect(ref.rev).toBe(1);
    expect(app.meshes.get(id)?.state).toBe('ready');
    expect(app.meshes.get(id)?.data()?.counts).toEqual({ points: 8, edges: 12, faces: 6, corners: 24 });
    expect(app.blobs.closure([ref.manifest]).every((blob) => app.blobs.has(blob))).toBe(true);
    await runOk(app, 'file.save', { fileName: 'cube.ekzanim' });
    const saved = await readProjectArchive(services.downloads.at(-1)?.bytes ?? new Uint8Array(0));
    expect(saved.snapshot.minWriterVersion).toBe(3);
    expect(saved.snapshot.tables.meshes?.[id]?.data).toEqual(ref);
    // One undo step for the creation; undo removes the record and its runtime.
    expect(app.history.peekUndo()?.label).toBe('Create Cube');
    app.history.undo();
    expect(app.meshes.get(id)).toBeUndefined();
  });

  // M6A-SPEC §3 rule 9 literal update (§5.17, B9): the built-ins register the four workspace tabs.
  it('starts in Animate with the workspaces registered and every M6a operator poll-failing', async () => {
    const { app } = realApp();
    expect(app.session.getState().workspace).toBe('animate');
    expect(app.workspaces.list().map((w) => w.id)).toEqual(['model', 'rig', 'animate', 'review']);
    // B7 landed `mesh.create.*`, B13 `mesh.create.template` (literal updates): the stretch pick-walk, which stays a
    // poll-failing operator in M6a core, stands in for "every M6a operator".
    const result = await app.runUntyped('select.mesh.pickWalk', { direction: 'up' });
    expect(result).toEqual({ status: 'cancelled', reason: 'Component pick-walk arrives later' });
    expect(await app.runUntyped('model.animateOnly')).toEqual({
      status: 'cancelled',
      reason: 'Keys and poses are set in Animate',
    });
  });
});
