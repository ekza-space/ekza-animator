// mesh.io (M6A-SPEC §5.19, §5.22, §6.2 `file.exportModel`; B8): static-model exports through the production kernel —
// authored GLBs with 0 validator errors, deterministic bytes (twice; after reopening the `.ekzanim` once B7 stores
// mesh blobs in it), the palette and vertex-colour outputs, the handheld profile on a grip root, budget lints, and
// poll refusals for character meshes and empty scenes.
import { derivedId, type GroupId, type MeshId } from '@ekza-animator/doc';
import { makeTestGroup, makeTestMesh, makeTestPalette, makeTestSwatch } from '@ekza-animator/doc/testing';
import { type EditorApp, loadMeshKernel } from '@ekza-animator/editor-core';
import { type ExportArtifact, parseGlb, readProjectArchive, writeProjectArchive } from '@ekza-animator/io';
import { BUILTIN_LAYERS, type MeshData, primitive } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import { AccessorReader } from './mesh.io.support';
import { importFixture, realApp, runOk } from './ops.support';

type Json = Record<string, unknown>;

const DEFAULT_16 = ['#f4f4f4', '#c2c3c7', '#6e7179', '#2b2d33', '#e04646', '#f08a3c', '#f2c84b', '#8bc34a'].map(
  (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number],
);

/** B7: `.ekzanim` archives carry mesh blobs (probe: a blob survives the round trip). */
const B7 = await (async () => {
  const { emptySnapshot } = await import('@ekza-animator/doc');
  const blob = new Uint8Array([1, 2, 3]);
  const { sha256Hex } = await import('@ekza-animator/io');
  const id = await sha256Hex(blob);
  const bytes = writeProjectArchive(emptySnapshot('probe'), new Map(), { version: '0.3.0' }, new Map([[id, blob]]));
  return (await readProjectArchive(bytes)).blobs.size === 1;
})();

/** A cube whose top face (+Y) paints slot 4, the rest slot 0 (the reference primitive carries the paint layer). */
function paintedCube(): MeshData {
  const cube = primitive('cube', {});
  const paint = new Uint16Array(cube.counts.faces);
  // The face whose corners all have y = +0.5.
  for (let f = 0; f < cube.counts.faces; f++) {
    let top = true;
    let c = cube.faceCorner[f] as number;
    do {
      if (cube.position[3 * (cube.cornerVert[c] as number) + 1] !== 0.5) top = false;
      c = cube.cornerNext[c] as number;
    } while (c !== cube.faceCorner[f]);
    if (top) paint[f] = 4;
  }
  return { ...cube, layers: new Map([...cube.layers, ['paint', { def: BUILTIN_LAYERS.paint, data: paint }]]) };
}

/** A scene with the default palette (8 swatches) and a cube, optionally under a handheld group. */
async function sceneApp(opts: { readonly handheld?: boolean; readonly budget?: number } = {}) {
  const { app, services } = realApp();
  await loadMeshKernel();
  const palette = derivedId('palette', 'palette.default', [], '', 0);
  const cube = 'msh_Cube000000000001' as MeshId;
  const group = 'grp_Sword00000000001' as GroupId;
  app.store.transact({ label: 'Scene' }, (tx) => {
    tx.put('palettes', makeTestPalette(palette, { name: 'Ekza Default 16' }));
    DEFAULT_16.forEach((srgb, slot) =>
      tx.put(
        'swatches',
        makeTestSwatch(derivedId('swatch', 'palette.default', [palette], '', slot), palette, slot, { srgb }),
      ),
    );
    if (opts.handheld === true) {
      tx.put(
        'groups',
        makeTestGroup(group, {
          name: 'Sword',
          handheld: { bone: 'rightHand', offset: [0, 0.02, 0], rotationDegrees: [0, 0, 90], scale: 1 },
        }),
      );
    }
    tx.put(
      'meshes',
      makeTestMesh(cube, {
        name: 'Cube',
        palette,
        parent: opts.handheld === true ? group : null,
        ...(opts.budget === undefined ? {} : { budget: { tris: opts.budget } }),
      }),
    );
    app.meshes.writeData(tx, cube, paintedCube());
  });
  return { app, services, cube, group };
}

async function exportModel(app: EditorApp, args: Json): Promise<ExportArtifact> {
  const [artifact] = (await runOk(app, 'file.exportModel', args)) as readonly ExportArtifact[];
  if (artifact === undefined) throw new Error('no artifact');
  return artifact;
}

describe('mesh.io: file.exportModel', () => {
  it('palette texture: 0 validator errors, one material and image, deterministic bytes, downloaded', async () => {
    const { app, services } = await sceneApp();
    const args = { objects: [], fileName: 'cube', profile: 'local/generic' };
    const artifact = await exportModel(app, args);
    expect(artifact.fileName).toBe('cube.glb');
    expect(artifact.validation?.errors).toBe(0);
    expect(artifact.lints.filter((lint) => lint.severity === 'error')).toEqual([]);
    expect(artifact.readBack?.ok).toBe(true);
    expect(services.downloads.map((d) => d.fileName)).toEqual(['cube.glb']);
    const again = await exportModel(app, args);
    expect(Buffer.compare(Buffer.from(again.bytes), Buffer.from(artifact.bytes))).toBe(0);
    const json = (await parseGlb(artifact.bytes)).json as Json;
    expect(json['materials']).toHaveLength(1);
    expect(json['images']).toHaveLength(1);
    expect((json['asset'] as Json)['extras']).toMatchObject({
      ekza_model_v1: { schema: 1, rig: 'none', provenance: { tool: 'ekza-animator', generator: { kind: 'manual' } } },
    });
    app.dispose();
  });

  it('vertex colour: COLOR_0 linear and no image', async () => {
    const { app } = await sceneApp();
    const artifact = await exportModel(app, {
      objects: [],
      fileName: 'cube.glb',
      profile: null,
      colourOutput: 'vertex-colour',
    });
    expect(artifact.validation?.errors).toBe(0);
    const glb = await parseGlb(artifact.bytes);
    expect(glb.json['images']).toBeUndefined();
    const primitive0 = (glb.json['meshes'] as { primitives: { attributes: Record<string, number> }[] }[])[0]
      ?.primitives[0];
    const colours = new AccessorReader(glb).floats(primitive0?.attributes['COLOR_0'] as number);
    const red = (0xe0 / 255 + 0.055) / 1.055;
    expect(colours.some((c) => Math.abs(c - red ** 2.4) < 1e-6)).toBe(true);
    app.dispose();
  });

  it('handheld profile on a grip root: no lints, static, the grip block; budgets lint above the mesh budget', async () => {
    const { app, group } = await sceneApp({ handheld: true });
    const artifact = await exportModel(app, {
      objects: [group],
      fileName: 'sword.glb',
      profile: 'ekza/omoba-handheld-v1',
    });
    expect(artifact.lints).toEqual([]);
    expect(artifact.validation?.errors).toBe(0);
    const json = (await parseGlb(artifact.bytes)).json as Json;
    expect(json['skins']).toBeUndefined();
    expect(json['animations']).toBeUndefined();
    expect(((json['asset'] as Json)['extras'] as Json)['ekza_handheld_v1']).toEqual({
      bone: 'rightHand',
      offset: [0, 0.02, 0],
      rotation_degrees: [0, 0, 90],
      scale: 1,
    });
    app.dispose();

    const tight = await sceneApp({ budget: 4 });
    const linted = await exportModel(tight.app, { objects: [], fileName: 'cube.glb', profile: 'local/generic' });
    expect(linted.lints.map((lint) => `${lint.code}:${lint.severity}`)).toEqual(['mesh.budget.tris:info']);
    tight.app.dispose();
  });

  it('refuses character meshes, unknown objects, unknown profiles and an empty scene', async () => {
    const { app } = realApp({ validator: false });
    // Before the pipeline has loaded the poll sees the request shape only, so a refusal is either a cancelled poll
    // or a failed run, with the same reason.
    const reasonOf = (result: Awaited<ReturnType<EditorApp['runUntyped']>>): string =>
      result.status === 'cancelled' ? result.reason : result.status === 'failed' ? result.error.message : '';
    const empty = await app.run('file.exportModel', { objects: [], fileName: 'x.glb', profile: null });
    expect(reasonOf(empty)).toBe('Nothing to export: create a mesh first');
    const { character } = await importFixture(app, 'polybot.vrm');
    const { mesh } = (await runOk(app, 'mesh.makeEditable', { character, meshIndex: 0 })) as { mesh: MeshId };
    const own = await app.run('file.exportModel', { objects: [mesh], fileName: 'x.glb', profile: null });
    expect(reasonOf(own)).toMatch(/belongs to a character/);
    const missing = await app.run('file.exportModel', { objects: ['msh_missing'], fileName: 'x.glb', profile: null });
    expect(reasonOf(missing)).toBe('Object msh_missing does not exist');
    const profile = await app.run('file.exportModel', {
      objects: [mesh],
      fileName: 'x.glb',
      profile: 'ekza/space-avatar-v1',
    });
    expect(reasonOf(profile)).toMatch(/is not a static model profile/);
    app.dispose();
  });

  it.skipIf(!B7)('exports the same bytes after the project is saved and reopened (READY.b7)', async () => {
    const { app, services } = await sceneApp();
    const args = { objects: [], fileName: 'cube.glb', profile: 'local/generic' };
    const before = await exportModel(app, args);
    await runOk(app, 'file.save');
    const saved = services.downloads.find((d) => d.fileName.endsWith('.ekzanim'));
    if (saved === undefined) throw new Error('no saved project');
    const reopened = realApp();
    await runOk(reopened.app, 'file.openProject', { name: saved.fileName, bytes: saved.bytes });
    await loadMeshKernel();
    const after = await exportModel(reopened.app, args);
    expect(Buffer.compare(Buffer.from(after.bytes), Buffer.from(before.bytes))).toBe(0);
    app.dispose();
    reopened.app.dispose();
  });
});
