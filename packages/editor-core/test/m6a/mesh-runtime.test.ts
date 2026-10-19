// M6A-SPEC §4.6, §5.5, §9 B0a (6): the lazy kernel loader, the stub MeshRuntimeRegistry over the reference kernel
// (runtimes reach 'ready' for revisions it can read, 'error' for missing blobs; writeData writes whole revisions) and
// the meshOperator/meshSetOperator wrappers built from descriptors.
import type { MeshId, MeshRef } from '@ekza-animator/doc';
import { makeTestMesh } from '@ekza-animator/doc/testing';
import { type MeshData, primitive, selectionOf, triangulate, writeRevision } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { describe, expect, it } from 'vitest';
import {
  createMemoryBlobStore,
  type EditorApp,
  type KernelMeshRuntimes,
  loadMeshKernel,
  MESH_EXTRA_ARGS,
  meshKernel,
  meshOperator,
  meshSetOperator,
} from '../../src';
import { createFakeServices } from '../../src/testing';
import { kernelApp } from '../kernel/support';

function appWithBlobs(): EditorApp {
  return kernelApp({ options: { services: { ...createFakeServices(), blobs: createMemoryBlobStore() } } });
}

/** Stores `data` as a revision in the app's blob store and returns its ref. */
function storeRevision(app: EditorApp, data: MeshData): MeshRef {
  const out = writeRevision(data);
  for (const [, chunk] of out.newChunks) app.blobs.put(chunk);
  app.blobs.put(out.manifestBytes);
  return { manifest: out.manifestId, rev: 1, base: null, joints: [] };
}

function createMesh(app: EditorApp, id: string, data: MeshData | null): MeshId {
  const ref = data === null ? null : storeRevision(app, data);
  app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh(id, { name: id, data: ref })));
  return id as MeshId;
}

describe('mesh runtimes before the kernel loads', () => {
  it('poll-fails "Mesh tools are loading", starts the load, and keeps runtimes loading until it resolves', async () => {
    expect(meshKernel()).toBeNull();
    const app = appWithBlobs();
    const id = createMesh(app, 'msh_Cube', primitive('cube', {}));
    expect(app.meshes.get(id)?.state).toBe('loading');
    expect(app.meshes.get(id)?.data()).toBeNull();
    app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.extrude'] as never));
    expect(app.operators.poll('mesh.extrude', undefined, { meshes: [id], kind: 'face' })).toEqual({
      ok: false,
      reason: 'Mesh tools are loading',
    });
    await loadMeshKernel();
    await (app.meshes as unknown as { settled(): Promise<void> }).settled();
    expect(meshKernel()).not.toBeNull();
    expect(app.meshes.get(id)?.state).toBe('ready');
    app.dispose();
  });
});

describe('mesh runtimes over the reference kernel', () => {
  it('reads revisions from resident blobs: data, triangulation and normals of closed and open runtimes', async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    const cube = primitive('cube', {});
    const id = createMesh(app, 'msh_Cube', cube);
    const runtime = app.meshes.get(id);
    expect(runtime?.state).toBe('ready');
    expect(runtime?.isOpen).toBe(false);
    expect(runtime?.mesh).toBeNull();
    expect(runtime?.data()?.counts).toEqual(cube.counts);
    expect([...(runtime?.data()?.position ?? [])]).toEqual([...cube.position]);
    const tris = triangulate(cube).tris;
    expect(tris.length).toBe(3 * 12);
    expect([...(runtime?.triangulation().tris ?? [])]).toEqual([...tris]);
    expect(runtime?.triangulation()).toBe(runtime?.triangulation()); // cached per version
    expect(runtime?.normals().face.length).toBe(3 * cube.counts.faces);
    expect(runtime?.symmetry()).toBeNull();
    expect(app.meshes.list().map((r) => r.id)).toEqual([id]);

    const open = app.meshes.open(id);
    expect(open.isOpen).toBe(true);
    expect(open.mesh?.counts).toEqual(cube.counts);
    app.meshes.close(id);
    expect(open.mesh).toBeNull();
    expect(open.data()).not.toBeNull();
    app.dispose();
  });

  it('keeps one runtime per live record with data: none for data null, gone after a delete', async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    createMesh(app, 'msh_Empty', null);
    const id = createMesh(app, 'msh_Plane', primitive('plane', {}));
    expect(app.meshes.list().map((r) => r.id)).toEqual([id]);
    app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', id));
    expect(app.meshes.list()).toEqual([]);
    app.store.undo.undo();
    expect(app.meshes.get(id)?.state).toBe('ready');
    app.dispose();
  });

  it("puts a runtime whose blobs are missing in 'error'", async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    const ref: MeshRef = { manifest: 'a'.repeat(64), rev: 1, base: null, joints: [] };
    app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_Lost', { data: ref })));
    const runtime = app.meshes.get('msh_Lost' as MeshId);
    // B7 (§5.5 rule 4): blobs that are not resident are read through BlobStore.get ('loading'), then 'error'.
    await (app.meshes as unknown as { settled(): Promise<void> }).settled();
    expect(runtime?.state).toBe('error');
    expect(runtime?.error).toMatch(/Mesh data is missing/);
    expect(() => runtime?.triangulation()).toThrow(/is error/);
    app.dispose();
  });

  it('writeData writes a whole new revision: blobs, the record ref (rev + 1, base) and a rebuilt runtime', async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    const id = createMesh(app, 'msh_Cube', primitive('cube', {}));
    const before = app.store.get('meshes', id)?.data as MeshRef;
    const events: string[] = [];
    app.meshes.subscribe((mesh, e) => events.push(`${mesh}:${e.type}`));
    const plane = primitive('plane', { subdivisionsWidth: 2 });
    const ref = app.store.transact({ label: 'Regenerate' }, (tx) => app.meshes.writeData(tx, id, plane));
    expect(ref).toMatchObject({ rev: 2, base: before.manifest, joints: [] });
    expect(app.store.get('meshes', id)?.data).toEqual(ref);
    expect(app.blobs.has(ref.manifest)).toBe(true);
    for (const chunk of app.blobs.closure([ref.manifest])) expect(app.blobs.has(chunk)).toBe(true);
    expect(app.meshes.get(id)?.data()?.counts).toEqual(plane.counts);
    expect(events).toContain(`${id}:rebuilt`);
    // Undo restores the previous revision (its blobs are still resident).
    app.store.undo.undo();
    expect(app.meshes.get(id)?.data()?.counts).toEqual(primitive('cube', {}).counts);
    app.dispose();
  });

  it('B7 landed sessions and commits: a stub op previews as its refusal and commits refuse with op-refused', async () => {
    const kernel = await loadMeshKernel();
    const app = appWithBlobs();
    const id = createMesh(app, 'msh_Cube', primitive('cube', {}));
    const op = kernel.MESH_OPS['mesh.extrude'];
    const setOp = kernel.MESH_SET_OPS['mesh.combine'];
    if (op === undefined || setOp === undefined) throw new Error('missing kernel op');
    const session = app.meshes.beginOp(op, [id], {});
    // The stub refused with `not-implemented`; B3's Extrude refuses for its own reason, nothing being selected
    // (literal update at B12b's merge of B3: the refusal path stays under test).
    const refusal = session.results.get(id) as { readonly refused?: boolean; readonly code?: string } | undefined;
    expect(refusal?.refused).toBe(true);
    expect(['not-implemented', 'extrude.no-selection']).toContain(refusal?.code);
    session.cancel();
    app.store.transact({ label: 'x' }, (tx) => {
      expect(() => app.meshes.commitOp(tx, op, [id], {}, { seed: 's' })).toThrow(
        expect.objectContaining({ code: 'op-refused' }),
      );
      expect(() => app.meshes.commitSetOp(tx, setOp, [id], {}, { seed: 's' })).toThrow(
        expect.objectContaining({ code: 'op-refused' }),
      );
    });
    expect(app.meshes.session).toBeNull();
    expect(app.meshes.journalBytes).toBe(0);
    app.dispose();
  });
});

describe('meshOperator / meshSetOperator (descriptor wrappers)', () => {
  it('derive params, flags, pass-through args and the Model workspace from the descriptor', () => {
    const desc = MESH_OP_DESCRIPTORS['mesh.bevel'];
    if (desc === undefined) throw new Error('missing descriptor');
    const def = meshOperator(desc, { tool: 'select', aliases: ['Chamfer'] });
    expect(def).toMatchObject({
      id: 'mesh.bevel',
      label: 'Bevel',
      category: 'mesh',
      scope: 'model',
      params: desc.params,
      extraArgs: MESH_EXTRA_ARGS,
      workspaces: ['model'],
      tool: 'select',
      aliases: ['Chamfer'],
      flags: { undo: true, adjustable: desc.flags.adjustable, repeatable: desc.flags.repeatable },
    });
    expect(MESH_EXTRA_ARGS).toEqual(['meshes', 'kind']);
  });

  it('poll: component mode, kinds, targets, readiness, then the kernel op; apply runs commitOp', async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    const id = createMesh(app, 'msh_Cube', primitive('cube', {}));
    app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.inset'] as never));
    app.operators.register(meshOperator(MESH_OP_DESCRIPTORS['mesh.cleanup'] as never));
    const poll = (op: string, args: unknown) => app.operators.poll(op, undefined, args);
    expect(poll('mesh.inset', {})).toEqual({ ok: false, reason: 'Inset: enter a component mode first' });
    expect(poll('mesh.inset', { kind: 'edge', meshes: [id] })).toEqual({
      ok: false,
      reason: 'Inset works on face components',
    });
    expect(poll('mesh.inset', { kind: 'face' })).toEqual({ ok: false, reason: 'Select components first' });
    expect(poll('mesh.inset', { kind: 'face', meshes: ['msh_Nope'] })).toEqual({
      ok: false,
      reason: 'Unknown mesh msh_Nope',
    });
    expect(poll('mesh.inset', { kind: 'face', meshes: [id] })).toBe(true);
    // Object-level ops target the selected mesh objects.
    expect(poll('mesh.cleanup', {})).toEqual({ ok: false, reason: 'Select a mesh first' });
    app.session.setState({ selection: { ...app.session.getState().selection, objects: [id] } });
    expect(poll('mesh.cleanup', {})).toBe(true);
    // The hilite is the default target of component ops in a component mode.
    const model = app.session.getState().model;
    app.session.setState({ model: { ...model, componentMode: 'face', hilite: [id] } });
    // B7 (§4.6 MeshOpArgs): the default targets are the hilited meshes with a selection of the kind.
    expect(poll('mesh.inset', {})).toEqual({ ok: false, reason: 'Select components first' });
    const meshes = app.meshes as KernelMeshRuntimes;
    // Every face of the cube: a closed shell has no region boundary, so B3's Inset refuses it (`inset.no-boundary`)
    // as the stub refused everything (literal update at B12b's merge of B3: the refusal path stays under test).
    meshes.select(id, selectionOf('face', [0, 1, 2, 3, 4, 5], primitive('cube', {}).counts));
    expect(poll('mesh.inset', {})).toBe(true);
    const result = await app.runUntyped('mesh.inset', {});
    // B7: a refusal of the kernel op fails the run with 'op-refused' (§4.6 commitOp), no step.
    expect(result).toMatchObject({ status: 'failed', error: { code: 'op-refused' } });
    expect(app.history.canUndo()).toBe(true); // only the Create transaction
    expect(app.history.peekUndo()?.label).toBe('Create');
    app.dispose();
  });

  it('meshSetOperator: arity and readiness', async () => {
    await loadMeshKernel();
    const app = appWithBlobs();
    const a = createMesh(app, 'msh_A', primitive('cube', {}));
    const b = createMesh(app, 'msh_B', primitive('plane', {}));
    const combine = MESH_SET_OP_DESCRIPTORS['mesh.combine'];
    if (combine === undefined) throw new Error('missing descriptor');
    const def = meshSetOperator(combine);
    expect(def).toMatchObject({ id: 'mesh.combine', extraArgs: MESH_EXTRA_ARGS, workspaces: ['model'] });
    app.operators.register(def);
    expect(app.operators.poll('mesh.combine', undefined, { meshes: [a] })).toEqual({
      ok: false,
      reason: 'Combine needs at least two meshes',
    });
    expect(app.operators.poll('mesh.combine', undefined, { meshes: [a, b] })).toBe(true);
    app.dispose();
  });
});
