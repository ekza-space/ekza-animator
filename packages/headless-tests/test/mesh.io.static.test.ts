// mesh.io (M6A-SPEC §5.19, §5.22, §6.2 `file.exportModel`; B8): static-model exports through the production kernel —
// authored GLBs with 0 validator errors, deterministic bytes (twice; after reopening the `.ekzanim` once B7 stores
// mesh blobs in it), the palette and vertex-colour outputs, the handheld profile on a grip root, budget lints, and
// poll refusals for character meshes and empty scenes.
import { derivedId, type GroupId, type MeshId, seededIdSource } from '@ekza-studio/doc';
import { makeTestGroup, makeTestMesh, makeTestPalette, makeTestSwatch } from '@ekza-studio/doc/testing';
import {
  createEditorApp,
  type DisplayModel,
  type EditorApp,
  loadMeshKernel,
  type ModelLoader,
} from '@ekza-studio/editor-core';
import { createFakeServices } from '@ekza-studio/editor-core/testing';
import { type ExportArtifact, parseGlb } from '@ekza-studio/io';
import { loadGltfInNode } from '@ekza-studio/io/testing';
import { BUILTIN_LAYERS, type MeshData, primitive } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import { AccessorReader } from './mesh.io.support';
import { importFixture, realApp, runOk, validate } from './ops.support';

type Json = Record<string, unknown>;

const DEFAULT_16 = ['#f4f4f4', '#c2c3c7', '#6e7179', '#2b2d33', '#e04646', '#f08a3c', '#f2c84b', '#8bc34a'].map(
  (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number],
);

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
async function sceneApp(
  opts: { readonly handheld?: boolean; readonly budget?: number; readonly models?: ModelLoader } = {},
) {
  const { app, services } =
    opts.models === undefined
      ? realApp()
      : (() => {
          // The production kernel with a display loader (the browser's three.js read-back, run in Node).
          const fake = createFakeServices();
          const withLoader = { ...fake, validate, models: opts.models };
          const app = createEditorApp({ services: withLoader, idSource: seededIdSource(7) });
          app.services.models?.setRenderer({}); // the host's renderer is up (display loads wait for it)
          return { app, services: fake };
        })();
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

  it('two meshes painting with one palette share one material and one image (§5.19; AS-LP-A "1 material")', async () => {
    const { app, cube } = await sceneApp();
    const record = app.store.get('meshes', cube);
    const second = 'msh_Cube000000000002' as MeshId;
    app.store.transact({ label: 'Second' }, (tx) => {
      tx.put('meshes', makeTestMesh(second, { name: 'Cube 2', palette: record?.palette ?? null }));
      app.meshes.writeData(tx, second, paintedCube());
    });
    const artifact = await exportModel(app, { objects: [], fileName: 'two', profile: 'local/generic' });
    expect(artifact.validation?.errors).toBe(0);
    const json = (await parseGlb(artifact.bytes)).json as Json;
    expect(json['meshes']).toHaveLength(2);
    expect(json['materials']).toEqual([expect.objectContaining({ name: 'Ekza Default 16' })]);
    expect(json['images']).toHaveLength(1);
    const perColour = await exportModel(app, {
      objects: [],
      fileName: 'two-colours',
      profile: 'local/generic',
      colourOutput: 'material-per-colour',
    });
    const names = ((await parseGlb(perColour.bytes)).json['materials'] as { name: string }[]).map((m) => m.name);
    expect(names).toEqual(['Ekza Default 16 swatch 0', 'Ekza Default 16 swatch 4']);
    app.dispose();
  });

  it('reads the export back through three.js GLTFLoader when the host has a display loader (the browser path)', async () => {
    let loads = 0;
    let disposed = 0;
    const models: ModelLoader = {
      setRenderer: () => {},
      load: async (container): Promise<DisplayModel> => {
        loads++;
        const loaded = await loadGltfInNode(container.bytes);
        return { kind: 'three', handle: { root: loaded.scene }, dispose: () => disposed++ };
      },
    };
    const { app } = await sceneApp({ models });
    const artifact = await exportModel(app, { objects: [], fileName: 'cube', profile: 'local/generic' });
    expect(artifact.readBack).toMatchObject({
      ok: true,
      kind: 'static',
      meshes: 1,
      primitives: 1,
      triangles: 12,
      three: { ok: true, primitives: 1, triangles: 12 },
    });
    expect(artifact.lints.filter((lint) => lint.code === 'export.read-back')).toEqual([]);
    expect(artifact.validation?.errors).toBe(0);
    expect([loads, disposed]).toEqual([1, 1]);
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

  it('exports the same bytes after the project is saved and reopened (READY.b7)', async () => {
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
