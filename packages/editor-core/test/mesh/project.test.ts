// M6A-SPEC §5.20 (B7): mesh blobs in `.ekzanim` saves and opens (byte-identical saves, a fresh app opens the same
// revision, the JSON variant warns and its meshes go 'error' where the chunks are not resident), in autosave writes
// (the blob closure per slot, in-flight and slot pins as GC roots) and in recovery (the slot as a lazy blob source).
import type { AssetId, AssetRecord, MeshId, MeshRef } from '@ekza-animator/doc';
import { primitive } from '@ekza-animator/mesh-core';
import { describe, expect, it } from 'vitest';
import {
  type AutosaveSlotInfo,
  type AutosaveStore,
  type BlobId,
  createMemoryBlobStore,
  startAutosave,
} from '../../src';
import {
  JSON_VARIANT_WARNING,
  loadProject,
  prepareProjectArchive,
  prepareProjectJson,
  prepareProjectOpen,
} from '../../src/workflows/project';
import {
  createMesh,
  flushMicrotasks,
  meshTestApp,
  offsetOp,
  paintOp,
  positionsOf,
  resident,
  testOperator,
} from './support';

async function editedApp() {
  const t = await meshTestApp();
  const created = await t.app.run('mesh.create.cube', { subdivisionsWidth: 2 });
  const cube = (created as { value: { mesh: MeshId } }).value.mesh;
  t.app.operators.register(testOperator(offsetOp()));
  await t.app.runUntyped('mesh.test.offset', { meshes: [cube], dy: 0.25 });
  return { ...t, cube };
}

describe('.ekzanim with meshes (§5.20)', () => {
  it('saves byte-identically twice; a fresh app opens the same revision, ready at once; re-saving gives the same bytes', async () => {
    const a = await editedApp();
    const first = await prepareProjectArchive(a.app, 'model');
    const second = await prepareProjectArchive(a.app, 'model');
    expect(second.bytes).toEqual(first.bytes);
    expect(first.warnings).toEqual([]);
    const b = await meshTestApp();
    const opened = await prepareProjectOpen(b.app, first.bytes);
    expect(opened.warnings).toEqual([]);
    loadProject(b.app, opened);
    const ref = a.app.store.get('meshes', a.cube)?.data as MeshRef;
    expect(b.app.store.get('meshes', a.cube)?.data).toEqual(ref);
    expect(b.app.meshes.get(a.cube)?.state).toBe('ready');
    expect(positionsOf(b, a.cube)).toEqual(positionsOf(a, a.cube));
    const again = await prepareProjectArchive(b.app, 'model');
    expect(again.bytes).toEqual(first.bytes);
  });

  it('saves what it can when blobs are gone (warning) and the opened project shows that mesh as error', async () => {
    const a = await editedApp();
    // Lose every blob of the store (two sweeps with no roots: the first clears `fresh`).
    a.blobs.sweep(new Set());
    a.blobs.sweep(new Set());
    const saved = await prepareProjectArchive(a.app, 'model');
    expect(saved.warnings).toEqual([
      expect.stringMatching(/^Mesh data is missing \(\d+ blobs?\) and was not included$/),
    ]);
    const b = await meshTestApp();
    const opened = await prepareProjectOpen(b.app, saved.bytes);
    expect(opened.warnings).toEqual(['Some mesh data is missing from this file; those meshes cannot be shown']);
    loadProject(b.app, opened);
    await b.meshes.settled();
    expect(b.app.meshes.get(a.cube)?.state).toBe('error');
    expect(b.app.meshes.get(a.cube)?.error).toMatch(/Mesh data is missing/);
  });

  it('the JSON variant warns that mesh data is not included; opened elsewhere its meshes go error', async () => {
    const a = await editedApp();
    const json = await prepareProjectJson(a.app, 'model');
    expect(json.warnings).toEqual([JSON_VARIANT_WARNING]);
    expect(a.services.toasts).toContainEqual({ kind: 'warning', text: JSON_VARIANT_WARNING });
    const c = await meshTestApp();
    loadProject(c.app, await prepareProjectOpen(c.app, json.bytes));
    await c.meshes.settled();
    expect(c.app.meshes.get(a.cube)?.state).toBe('error');
    // In the same session the chunks are resident: the mesh stays ready.
    loadProject(a.app, await prepareProjectOpen(a.app, json.bytes));
    expect(a.app.meshes.get(a.cube)?.state).toBe('ready');
  });

  it('writes no warning for documents without meshes or images (the M2a JSON variant)', async () => {
    const t = await meshTestApp();
    expect((await prepareProjectJson(t.app, 'empty')).warnings).toEqual([]);
  });
});

/** An in-memory AutosaveStore with blob sets, writes that can be held, and lazy blob reads for recovery. */
function blobAutosave() {
  const slots = new Map<
    string,
    { info: Omit<AutosaveSlotInfo, 'id'> | null; snapshot: string | null; blobs: BlobId[]; live: boolean }
  >();
  const blobs = new Map<BlobId, Uint8Array>();
  let next = 0;
  let hold: Promise<void> | null = null;
  const store: AutosaveStore = {
    open: async () => {
      const id = `as_${String(++next).padStart(16, '0')}`;
      slots.set(id, { info: null, snapshot: null, blobs: [], live: true });
      return id;
    },
    write: async (slot, data, _readAsset, readBlob) => {
      if (hold !== null) await hold;
      for (const id of data.blobs) if (!blobs.has(id)) blobs.set(id, await readBlob(id));
      slots.set(slot, {
        info: { ...data.info, bytes: 1 },
        snapshot: data.snapshotJson,
        blobs: [...data.blobs],
        live: true,
      });
      return { bytes: 1 };
    },
    listOrphans: async () =>
      [...slots.entries()]
        .filter(([, row]) => !row.live && row.snapshot !== null && row.info !== null)
        .map(([id, row]) => ({ ...(row.info as Omit<AutosaveSlotInfo, 'id'>), id })),
    read: async (slot) => {
      const row = slots.get(slot);
      if (row === undefined || row.snapshot === null) return null;
      const listed = new Set(row.blobs);
      return {
        snapshot: JSON.parse(row.snapshot) as unknown,
        assets: new Map<AssetId, { record: AssetRecord; bytes: Uint8Array }>(),
        blob: async (id) => (listed.has(id) ? blobs.get(id) : undefined),
      };
    },
    remove: async (slot) => {
      slots.delete(slot);
    },
  };
  return {
    store,
    slots,
    blobs,
    holdWrites(): () => void {
      let release: () => void = () => {};
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
    /** The page that owned `slot` closed (its slot becomes an orphan). */
    close(slot: string): void {
      const row = slots.get(slot);
      if (row !== undefined) row.live = false;
    },
  };
}

describe('autosave and recovery with meshes (§5.20)', () => {
  it('writes the blob closure of every live revision; the closure is a root while the write is in flight', async () => {
    const memory = blobAutosave();
    const t = await meshTestApp({ autosave: memory.store });
    const controller = startAutosave(t.app);
    await controller.ready;
    const id = createMesh(t, 'msh_Plane', primitive('plane', { subdivisionsWidth: 32, subdivisionsHeight: 32 }));
    const first = t.app.store.get('meshes', id)?.data as MeshRef;
    const release = memory.holdWrites();
    const writing = controller.writeNow();
    await flushMicrotasks();
    // While the write waits: the record moves on, history is dropped, a collection runs — the snapshot's blobs stay.
    t.app.operators.register(testOperator(paintOp()));
    await t.app.runUntyped('mesh.test.paint', { meshes: [id], slot: 3 });
    await t.app.runUntyped('mesh.test.paint', { meshes: [id], slot: 4 });
    t.app.history.clear();
    t.app.store.undo.clear();
    t.meshes.collect();
    expect(resident(t, first)).toBe(true);
    release();
    await writing;
    const slot = t.app.session.getState().autosave.slot as string;
    expect(memory.slots.get(slot)?.blobs.sort()).toEqual([...t.blobs.closure([first.manifest])].sort());
    // The written slot's closure stays pinned until the next write …
    t.meshes.collect();
    expect(resident(t, first)).toBe(true);
    await controller.writeNow();
    const latest = t.app.store.get('meshes', id)?.data as MeshRef;
    expect(memory.slots.get(slot)?.blobs.sort()).toEqual([...t.blobs.closure([latest.manifest])].sort());
    // … which releases it.
    t.meshes.collect();
    expect(t.blobs.has(first.manifest)).toBe(false);
    expect(resident(t, latest)).toBe(true);
    controller.dispose();
  });

  it("recovers a mesh lazily from the slot's blobs (loading, then ready with the same revision)", async () => {
    const memory = blobAutosave();
    const writer = await meshTestApp({ autosave: memory.store });
    const controller = startAutosave(writer.app);
    await controller.ready;
    const id = createMesh(writer, 'msh_Cube', primitive('cube', { subdivisionsWidth: 2 }));
    writer.app.session.setState({ dirty: true });
    await controller.writeNow();
    const slot = writer.app.session.getState().autosave.slot as string;
    const ref = writer.app.store.get('meshes', id)?.data as MeshRef;
    controller.dispose();
    memory.close(slot);
    const reader = await meshTestApp({ autosave: memory.store, blobs: createMemoryBlobStore() });
    const recovering = startAutosave(reader.app);
    await recovering.ready;
    expect(reader.app.session.getState().recovery.map((r) => r.id)).toEqual([slot]);
    const result = await reader.app.run('file.recover', { slot });
    expect(result.status).toBe('finished');
    expect(reader.app.meshes.get(id)?.state).toBe('loading');
    await reader.meshes.settled();
    expect(reader.app.meshes.get(id)?.state).toBe('ready');
    expect(reader.app.store.get('meshes', id)?.data).toEqual(ref);
    expect(positionsOf(reader, id)).toEqual(positionsOf(writer, id));
    recovering.dispose();
  });
});
