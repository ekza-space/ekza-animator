// M6A-SPEC §5.21, §5.23, §6.2 (B8): `mesh.makeEditable` (poll, apply, undo/redo exactness, the licence refusal, the
// derived id and the virtual asset rows), the character edits the bake exports, the display hook of the character
// registry (rebuilt containers, latest load wins), the debounced display controller, and the three.js read-back of
// static exports.
import { readFileSync } from 'node:fs';
import { type CharacterId, derivedId, type MeshId, newId, seededIdSource } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import { detectModelFormat, type GlbContainer, parseGlb, skeletonFromGltf } from '@ekza-studio/io';
import type { MeshData } from '@ekza-studio/mesh-core';
import { autoRig, writeRigDefinition } from '@ekza-studio/rig';
import { createStore } from 'zustand/vanilla';
import { describe, expect, it, vi } from 'vitest';
import {
  assetMeshId,
  assetMeshRows,
  characterEdits,
  createEditorApp,
  createMemoryAssetStore,
  createMemoryBlobStore,
  createMeshDisplay,
  type DisplayModel,
  type DisplayTimers,
  displayContainer,
  type EditorApp,
  historyLabels,
  lastMakeEditableReport,
  type ModelLoader,
  type SessionState,
} from '../../src';
import { gateModelLoader } from '../../src/characters/models';
import { createFakeServices } from '../../src/testing';
import { threeReadBack } from '../../src/workflows/exportModel';

const PROHIBITED = new URL('../../../../fixtures/synthetic/prohibited-modification.vrm', import.meta.url);

/** A fake display loader: records which container each load got; loads resolve when `release` says so. */
function fakeModels() {
  const loads: { container: GlbContainer; resolve: () => void }[] = [];
  let autoResolve = true;
  const models: ModelLoader = {
    setRenderer: () => {},
    load: (container) =>
      new Promise<DisplayModel>((resolve) => {
        const model: DisplayModel = { kind: 'three', handle: container, dispose: () => {} };
        const entry = { container, resolve: () => resolve(model) };
        loads.push(entry);
        if (autoResolve) entry.resolve();
      }),
  };
  return {
    models,
    loads,
    hold: () => {
      autoResolve = false;
    },
  };
}

/** The production kernel with a model put in as a character (no import pipeline), its runtime built. */
async function characterApp(
  bytes: Uint8Array,
  name: string,
  opts: { readonly models?: ModelLoader } = {},
): Promise<{ app: EditorApp; character: CharacterId; container: GlbContainer }> {
  const assets = createMemoryAssetStore();
  const services = {
    ...createFakeServices(),
    assets,
    blobs: createMemoryBlobStore(),
    ...(opts.models === undefined ? {} : { models: opts.models }),
  };
  const app = createEditorApp({ services, idSource: seededIdSource(11) });
  app.services.models?.setRenderer({}); // display loads wait for the host's renderer
  const asset = await assets.put(bytes, { name, ext: name.endsWith('.glb') ? 'glb' : 'vrm', role: 'model' });
  const container = await parseGlb(bytes);
  const skeleton = skeletonFromGltf(container);
  const character = newId('character');
  const rig = newId('rig');
  app.store.transact({ label: 'Import' }, (tx) => {
    tx.put('assets', asset);
    tx.put('characters', {
      id: character,
      name,
      asset: asset.id,
      source: { kind: 'asset', asset: asset.id },
      format: detectModelFormat(container.json),
      rig,
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
      order: 'a0',
      deleted: null,
      vrm: null, // M6B-SPEC §3 rule 9: schema 4 characters carry vrm
    });
    writeRigDefinition(tx, autoRig(skeleton, { character, rig }));
  });
  await (app.characters as unknown as { settled(): Promise<void> }).settled();
  return { app, character, container };
}

/** Writes a new revision (rev + 1) of a mesh: its points moved by `dx` (a value edit the reference kernel has). */
function editMesh(app: EditorApp, id: MeshId, dx = 0.01): MeshData {
  const data = app.meshes.get(id)?.data();
  if (data === null || data === undefined) throw new Error('no data');
  const position = data.position.slice();
  for (let i = 0; i < position.length; i += 3) position[i] = Math.fround((position[i] as number) + dx);
  const edited: MeshData = { ...data, position };
  app.store.transact({ label: 'Edit' }, (tx) => app.meshes.writeData(tx, id, edited));
  return edited;
}

describe('mesh.makeEditable', () => {
  it('creates the record lazily with the derived id, source, skin, slots and the first revision; undo and redo are exact', async () => {
    const { app, character, container } = await characterApp(readFixture('polybot.vrm'), 'Polybot');
    const id = assetMeshId(character, 0);
    expect(id).toBe(derivedId('mesh', 'asset', [character], '', 0));
    expect(assetMeshRows(app)).toEqual([{ id, character, meshIndex: 0, name: 'mesh_ava_051.baked' }]);
    expect(app.store.list('meshes')).toEqual([]);
    const before = app.store.snapshot();

    const result = await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    expect(result.status).toBe('finished');
    const record = app.store.get('meshes', id);
    expect(record).toMatchObject({
      id,
      name: 'mesh_ava_051.baked',
      owner: { character },
      parent: null,
      source: { asset: container.sha256, mesh: 0 },
      faceted: false,
      generator: null,
      palette: null,
      skin: { asset: container.sha256, skin: 0 },
      material: { assetSlots: [{ asset: container.sha256, material: 0 }] },
      placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    expect(record?.data).toMatchObject({ rev: 1, base: null, joints: [] });
    expect(app.meshes.get(id)?.state).toBe('ready');
    const report = lastMakeEditableReport(app);
    expect(report?.mesh).toBe(id);
    expect(app.meshes.get(id)?.data()?.counts.faces).toBe(report?.report.triangles);
    expect(report?.report.morphNormals).toHaveLength(16);
    expect(assetMeshRows(app)).toEqual([]);
    expect(app.history.canUndo()).toBe(true);
    const after = app.store.snapshot();

    // A second run is refused: the mesh is already editable.
    expect(await app.run('mesh.makeEditable', { character, meshIndex: 0 })).toEqual({
      status: 'cancelled',
      reason: 'This mesh is already editable',
    });

    await app.run('edit.undo');
    expect(app.store.get('meshes', id)).toBeUndefined();
    expect(app.store.snapshot().tables).toEqual(before.tables);
    await app.run('edit.redo');
    expect(app.store.snapshot().tables).toEqual(after.tables);
    expect(app.meshes.get(id)?.state).toBe('ready');
    app.dispose();
  });

  it('poll-fails cleanly: unknown character, mesh index out of range', async () => {
    const { app, character } = await characterApp(readFixture('polybot.vrm'), 'Polybot');
    expect(app.operators.poll('mesh.makeEditable', undefined, { character: 'chr_missing', meshIndex: 0 })).toEqual({
      ok: false,
      reason: 'The character does not exist',
    });
    expect(app.operators.poll('mesh.makeEditable', undefined, { character, meshIndex: 3 })).toEqual({
      ok: false,
      reason: 'Polybot has no glTF mesh 3',
    });
    expect(app.operators.poll('mesh.makeEditable', undefined, { character, meshIndex: -1 })).toMatchObject({
      ok: false,
    });
    expect(app.operators.poll('mesh.makeEditable', undefined, { character, meshIndex: 0 })).toBe(true);
    app.dispose();
  });

  it('refuses a VRM whose licence forbids modification and writes nothing', async () => {
    const { app, character } = await characterApp(new Uint8Array(readFileSync(PROHIBITED)), 'Prohibited');
    expect(assetMeshRows(app)).toHaveLength(1);
    const steps = historyLabels(app.history);
    const result = await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    expect(result.status).toBe('cancelled');
    expect(result.status === 'cancelled' ? result.reason : '').toMatch(/modification/);
    expect(app.store.list('meshes')).toEqual([]);
    expect(historyLabels(app.history)).toEqual(steps);
    app.dispose();
  });
});

describe('character edits and the display hook', () => {
  it('lists edited meshes only: Make editable alone is not an edit', async () => {
    const { app, character } = await characterApp(readFixture('polybot.vrm'), 'Polybot');
    await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    const id = assetMeshId(character, 0);
    expect(await characterEdits(app, character)).toEqual([]);
    const edited = editMesh(app, id);
    const edits = await characterEdits(app, character);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ meshIndex: 0, hadTangents: false, dropTangents: false });
    expect(edits[0]?.morphNormals.size).toBe(16);
    expect(edits[0]?.data.position).toEqual(edited.position);
    expect((await characterEdits(app, character, { dropTangents: true }))[0]?.dropTangents).toBe(true);
    app.dispose();
  });

  it('displays the rebuilt container once a mesh is edited; the previous display stays until it is ready', async () => {
    const fake = fakeModels();
    const { app, character, container } = await characterApp(readFixture('polybot.vrm'), 'Polybot', {
      models: fake.models,
    });
    expect(fake.loads.map((load) => load.container)).toEqual([container]);
    await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    expect(fake.loads).toHaveLength(1); // Make editable alone changes nothing on screen
    editMesh(app, assetMeshId(character, 0));
    const runtime = app.characters.get(character);
    if (runtime === undefined) throw new Error('no runtime');
    const rebuilt = await displayContainer(app, runtime);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.sha256).not.toBe(container.sha256);
    // The kernel's display controller rebuilds after the commit (500 ms debounce, then idle).
    await vi.waitFor(() => expect(fake.loads).toHaveLength(2), { timeout: 10_000 });
    expect(fake.loads[1]?.container.sha256).toBe(rebuilt?.sha256);
    await vi.waitFor(() => expect(runtime.display?.handle).toBe(fake.loads[1]?.container));

    fake.hold();
    const shown = runtime.display;
    const characters = app.characters as unknown as { redisplay(id: CharacterId): Promise<void> };
    const first = characters.redisplay(character);
    await vi.waitFor(() => expect(fake.loads).toHaveLength(3));
    expect(runtime.display).toBe(shown); // still the previous display
    // A later reload wins over an earlier one that finishes after it.
    const second = characters.redisplay(character);
    await vi.waitFor(() => expect(fake.loads).toHaveLength(4));
    fake.loads[3]?.resolve();
    await second;
    const latest = runtime.display;
    expect(latest).not.toBe(shown);
    fake.loads[2]?.resolve();
    await first;
    expect(runtime.display).toBe(latest);
    app.dispose();
  });
});

describe('the display controller', () => {
  function controller() {
    const pending: { fn: () => void; ms: number }[] = [];
    const idle: (() => void)[] = [];
    const timers: DisplayTimers = {
      setTimeout: (fn, ms) => {
        const entry = { fn, ms };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (handle) => {
        const i = pending.indexOf(handle as { fn: () => void; ms: number });
        if (i !== -1) pending.splice(i, 1);
      },
      idle: (fn) => {
        idle.push(fn);
      },
    };
    return { pending, idle, timers };
  }

  it('rebuilds edited characters 500 ms after the last commit, on idle, and at once when Model is left', async () => {
    const { app, character } = await characterApp(readFixture('polybot.vrm'), 'Polybot');
    await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    const { pending, idle, timers } = controller();
    const session = createStore<Pick<SessionState, 'workspace'>>()(() => ({ workspace: 'model' }));
    const redisplay = vi.fn<(character: CharacterId) => Promise<void>>(() => Promise.resolve());
    const display = createMeshDisplay({
      store: app.store,
      session: session as never,
      app: () => app,
      redisplay,
      timers,
    });
    editMesh(app, assetMeshId(character, 0));
    expect(pending.map((p) => p.ms)).toEqual([500]);
    editMesh(app, assetMeshId(character, 0)); // debounced: still one timer
    expect(pending).toHaveLength(1);
    pending.shift()?.fn();
    expect(redisplay).not.toHaveBeenCalled();
    idle.shift()?.();
    await vi.waitFor(() => expect(redisplay).toHaveBeenCalledWith(character));
    expect(display.hasEdits(character)).toBe(true);

    redisplay.mockClear();
    editMesh(app, assetMeshId(character, 0));
    expect(pending).toHaveLength(1);
    session.setState({ workspace: 'animate' });
    await vi.waitFor(() => expect(redisplay).toHaveBeenCalledTimes(1));
    expect(pending).toHaveLength(0);
    display.dispose();
    app.dispose();
  });

  it('ignores scene meshes, and Make editable alone (the model on screen is the same); an undone edit counts', async () => {
    const { app, character } = await characterApp(readFixture('polybot.vrm'), 'Polybot');
    const { pending, timers } = controller();
    const session = createStore<Pick<SessionState, 'workspace'>>()(() => ({ workspace: 'model' }));
    const display = createMeshDisplay({
      store: app.store,
      session: session as never,
      app: () => app,
      redisplay: () => Promise.resolve(),
      timers,
    });
    const { makeTestMesh } = await import('@ekza-studio/doc/testing');
    app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_Scene')));
    expect(pending).toEqual([]);
    await app.run('mesh.makeEditable', { character, meshIndex: 0 });
    expect(pending).toEqual([]);
    editMesh(app, assetMeshId(character, 0));
    expect(pending).toHaveLength(1);
    pending.shift()?.fn(); // the debounce elapses
    await app.run('edit.undo');
    expect(pending).toHaveLength(1); // back to the original geometry: the display changes again
    display.dispose();
    app.dispose();
  });
});

describe('the three.js read-back of a static export (§6.2)', () => {
  const bytes = readFixture('polybot.vrm');
  /** A loader whose handle is io/three's loaded model shape: `root.traverse` over meshes with geometry. */
  function threeLike(meshes: readonly { index: number | null; positions: readonly number[] }[]) {
    const calls = { loads: 0, disposed: 0 };
    const objects = [
      { isMesh: false },
      ...meshes.map((mesh) => ({
        isMesh: true,
        geometry: {
          index: mesh.index === null ? null : { count: mesh.index },
          attributes: { position: { count: mesh.positions.length / 3, array: mesh.positions } },
        },
      })),
    ];
    const loader: ModelLoader = {
      setRenderer: () => {},
      load: () => {
        calls.loads++;
        const root = { traverse: (visit: (object: unknown) => void) => objects.forEach(visit) };
        return Promise.resolve({ kind: 'three', handle: { root }, dispose: () => calls.disposed++ });
      },
    };
    return { loader: gateModelLoader(loader), calls };
  }

  it('counts the meshes and triangles three.js made, and disposes the model', async () => {
    const { loader, calls } = threeLike([
      { index: 36, positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
      { index: null, positions: Array.from({ length: 18 }, (_, i) => i) },
    ]);
    loader.setRenderer({});
    expect(await threeReadBack(loader, bytes)).toEqual({ ok: true, primitives: 2, triangles: 14 });
    expect(calls).toEqual({ loads: 1, disposed: 1 });
  });

  it('fails on non-finite positions and on a load error; skips without a renderer, a loader or a three.js handle', async () => {
    const nan = threeLike([{ index: 3, positions: [0, Number.NaN, 0, 1, 0, 0, 0, 1, 0] }]);
    nan.loader.setRenderer({});
    expect(await threeReadBack(nan.loader, bytes)).toEqual({
      ok: false,
      primitives: 1,
      triangles: 1,
      error: 'non-finite positions',
    });
    // The kernel's loader waits for the host's renderer: without one the read-back does not start a load.
    const waiting = threeLike([]);
    expect(await threeReadBack(waiting.loader, bytes)).toBeNull();
    expect(waiting.calls.loads).toBe(0);
    expect(await threeReadBack(null, bytes)).toBeNull();
    const failing = gateModelLoader({
      setRenderer: () => {},
      load: () => Promise.reject(new Error('bad accessor')),
    });
    failing.setRenderer({});
    expect(await threeReadBack(failing, bytes)).toEqual({
      ok: false,
      primitives: 0,
      triangles: 0,
      error: 'bad accessor',
    });
    const opaque = fakeModels();
    const gated = gateModelLoader(opaque.models);
    gated.setRenderer({});
    expect(await threeReadBack(gated, bytes)).toBeNull(); // its handle is the container, not a three.js scene
  });
});
