// M6A-SPEC §2 (eager/lazy split) and §5.5 rule 8 (B7): before the kernel chunk loads, `app.meshes` is a facade with one
// 'loading' handle per live record with data (edits refuse "Mesh tools are loading"); `open` intents, autosave pins
// and the attached app carry over when the implementation loads with the kernel, and the handles stay the same
// objects, their subscribers seeing 'loading' → 'ready'. This file runs first in its own module graph: the kernel
// is not loaded when it starts.
import type { MeshId, MeshRef } from '@ekza-studio/doc';
import { makeTestMesh } from '@ekza-studio/doc/testing';
import { primitive } from '@ekza-studio/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  createEditorApp,
  createMemoryBlobStore,
  type KernelMeshRuntimes,
  meshKernel,
  type MeshRuntimeEvent,
} from '../../src';
import { createFakeServices } from '../../src/testing';
import { storeRevision } from './support';

describe('the registry facade before and after the kernel loads', () => {
  it("keeps 'loading' handles, open intents and pins, then hands them to the implementation", async () => {
    expect(meshKernel()).toBeNull();
    const blobs = createMemoryBlobStore();
    const app = createEditorApp({ services: { ...createFakeServices(), blobs }, builtins: false });
    const meshes = app.meshes as KernelMeshRuntimes;
    meshes.attach(app);
    const data = primitive('cube', {});
    const ref: MeshRef = storeRevision(blobs, data);
    app.store.transact({ label: 'Create' }, (tx) => tx.put('meshes', makeTestMesh('msh_Cube', { data: ref })));
    const id = 'msh_Cube' as MeshId;
    const handle = app.meshes.get(id);
    expect(handle).toMatchObject({ id, state: 'loading', error: null, mesh: null, version: 0, ref });
    expect(handle?.data()).toBeNull();
    expect(() => handle?.triangulation()).toThrow(expect.objectContaining({ code: 'mesh-not-ready' }));
    expect(handle?.symmetry()).toBeNull();
    expect(app.meshes.list()).toEqual([handle]);
    // Edits wait for the kernel.
    expect(() => meshes.storeRevision(data)).toThrow(expect.objectContaining({ code: 'mesh-loading' }));
    expect(() => app.store.transact({ label: 'x' }, (tx) => app.meshes.writeData(tx, id, data))).toThrow(
      expect.objectContaining({ code: 'mesh-loading' }),
    );
    expect(meshes.collect()).toEqual({ freed: 0, bytes: 0, dropped: 0 });
    // An open intent and a pin taken before the load.
    expect(app.meshes.open(id).isOpen).toBe(true);
    const release = meshes.pinBlobs(blobs.closure([ref.manifest]));
    const seen: string[] = [];
    handle?.subscribe((e: MeshRuntimeEvent) => seen.push(e.type === 'state' ? `state:${e.state}` : e.type));
    await meshes.settled();
    // The same handle, ready and open.
    expect(app.meshes.get(id)).toBe(handle);
    expect(handle?.state).toBe('ready');
    expect(handle?.isOpen).toBe(true);
    expect(handle?.mesh?.counts).toEqual(data.counts);
    expect(handle?.data()?.counts).toEqual(data.counts);
    expect(seen).toContain('state:ready');
    // The early pin is a root: the revision survives its record and history.
    app.store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', id));
    expect(app.meshes.get(id)).toBeUndefined();
    app.history.clear();
    app.store.undo.clear();
    meshes.collect();
    expect(blobs.has(ref.manifest)).toBe(true);
    release();
    meshes.collect();
    expect(blobs.has(ref.manifest)).toBe(false);
    app.dispose();
  });
});
