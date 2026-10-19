// mesh.io (M6A-SPEC §5.21, §9 B8): Make editable on the imported fixtures through the production kernel — every glTF
// mesh of Polybot, Seed-san and the UAL mannequin becomes a valid record with the derived id, undo and redo are exact,
// importing writes no mesh record, the virtual asset rows, and the licence refusal of the synthetic prohibited VRM.
import { readFileSync } from 'node:fs';
import { derivedId, requiredWriterVersion } from '@ekza-animator/doc';
import { assetMeshRows } from '@ekza-animator/editor-core';
import { topologyStats, validateMesh } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { makeEditable, meshData } from './mesh.io.support';
import { expectUndoRedoExact, importFixture, realApp, runOk } from './ops.support';

const PROHIBITED = new URL('../../../fixtures/synthetic/prohibited-modification.vrm', import.meta.url);

describe('mesh.io: Make editable on the fixtures', () => {
  for (const [fixture, meshes] of [
    ['polybot.vrm', 1],
    ['seed-san.vrm', 5],
    ['quaternius-ual.glb', 1],
  ] as const) {
    it(`${fixture}: every glTF mesh becomes a valid record; import alone writes none`, async () => {
      const { app } = realApp({ validator: false });
      const { character, runtime } = await importFixture(app, fixture);
      expect(app.store.list('meshes')).toEqual([]);
      expect(requiredWriterVersion(app.store.snapshot().tables)).toBeLessThanOrEqual(2);
      expect(assetMeshRows(app).map((row) => row.meshIndex)).toEqual(Array.from({ length: meshes }, (_, i) => i));
      for (let i = 0; i < meshes; i++) {
        const mesh = await makeEditable(app, character, i);
        expect(mesh).toBe(derivedId('mesh', 'asset', [character], '', i));
        const data = meshData(app, mesh);
        expect(validateMesh(data)).toEqual([]);
        expect(topologyStats(data).triangles).toBe(data.counts.faces);
        const record = app.store.get('meshes', mesh);
        expect(record?.source).toEqual({ asset: runtime.asset, mesh: i });
        expect(record?.data?.rev).toBe(1);
        expect(app.meshes.get(mesh)?.state).toBe('ready');
      }
      expect(assetMeshRows(app)).toEqual([]);
      expect(requiredWriterVersion(app.store.snapshot().tables)).toBe(3);
      app.dispose();
    });
  }

  it('Seed-san: Make editable is one exact undo step', async () => {
    const { app } = realApp({ validator: false });
    const { character } = await importFixture(app, 'seed-san.vrm');
    const value = (await expectUndoRedoExact(app, 'mesh.makeEditable', { character, meshIndex: 2 })) as {
      mesh: string;
    };
    expect(value.mesh).toBe(derivedId('mesh', 'asset', [character], '', 2));
    app.dispose();
  });

  it('refuses the prohibited-modification VRM with a reason and creates no record', async () => {
    const { app } = realApp({ validator: false });
    const bytes = new Uint8Array(readFileSync(PROHIBITED));
    const { character } = (await runOk(app, 'file.importModel', { name: 'prohibited-modification.vrm', bytes })) as {
      character: Parameters<typeof makeEditable>[1];
    };
    const result = await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    expect(result.status).toBe('cancelled');
    expect(result.status === 'cancelled' ? result.reason : '').toMatch(/modification/);
    expect(app.store.list('meshes')).toEqual([]);
    app.dispose();
  });
});
