// M6A-SPEC §5.20 (B7): the autosave store's mesh blobs against the browser's real IndexedDB (a namespaced database
// per test, deleted afterwards) — the version 1 → 2 upgrade, slot blob sets written once and shared, the idle pass
// that deletes blobs no slot lists, `read(slot).blob`, and multi-tab recovery of a mesh through `file.recover` (two
// pages recovering the same slot see the same revision). Also the browser services' blob store.
import type { MeshId, MeshRecord, MeshRef } from '@ekza-animator/doc';
import {
  type AutosaveSlotInfo,
  createEditorApp,
  type EditorApp,
  type KernelMeshRuntimes,
  loadMeshKernel,
  startAutosave,
} from '@ekza-animator/editor-core';
import { createFakeServices } from '@ekza-animator/editor-core/testing';
import { primitive, writeRevision } from '@ekza-animator/mesh-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autosaveDatabaseName,
  blobsCollected,
  createIndexedDbAutosaveStore,
  newSlotId,
} from '../src/services/autosave';
import { createBrowserBlobStore } from '../src/services/blobs';
import { createShellServices } from '../src/services/browser';

const created: string[] = [];

function namespace(): string {
  const ns = `b7-${newSlotId().slice(3)}`;
  created.push(autosaveDatabaseName(ns));
  return ns;
}

afterEach(async () => {
  for (const name of created.splice(0)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
});

const INFO: Omit<AutosaveSlotInfo, 'id' | 'bytes'> = {
  projectName: 'Model',
  savedAt: 1_700_000_000_000,
  characters: 0,
  clips: 0,
  appVersion: '0.3.0',
  schemaVersion: 3,
};
/** A scene mesh record (doc/testing reads fixtures through node:fs, so browser tests build records here). */
function meshRecord(id: string, data: MeshRef): MeshRecord {
  return {
    id: id as MeshId,
    name: 'Cube',
    owner: { scene: true },
    parent: null,
    order: 'a0',
    placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    pivot: [0, 0, 0],
    source: null,
    data,
    faceted: true,
    generator: null,
    palette: null,
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
  };
}

const noAsset = (): Promise<Uint8Array> => Promise.reject(new Error('no assets'));

/** Blob bytes by id, counting reads. */
function blobSource(entries: ReadonlyMap<string, Uint8Array>) {
  const reads: string[] = [];
  return {
    reads,
    read: (id: string): Promise<Uint8Array> => {
      reads.push(id);
      const bytes = entries.get(id);
      return bytes === undefined ? Promise.reject(new Error(`no blob ${id}`)) : Promise.resolve(bytes);
    },
  };
}

/** Every blob id in the database's `blobs` store. */
async function blobKeys(ns: string): Promise<string[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(autosaveDatabaseName(ns));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = db.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
    return keys.map(String).sort();
  } finally {
    db.close();
  }
}

/** The blob closure of a revision of `data`: manifest + chunks. */
function revisionBlobs(data = primitive('cube', { subdivisionsWidth: 2 })) {
  const out = writeRevision(data);
  const blobs = new Map<string, Uint8Array>([[out.manifestId, out.manifestBytes], ...out.newChunks]);
  return { manifest: out.manifestId, blobs, ids: [...blobs.keys()].sort() };
}

const run = (fn: () => void) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      fn();
      resolve();
    }, 0),
  );

describe('autosave mesh blobs in IndexedDB (§5.20)', () => {
  it('upgrades a version 1 database: slots and assets kept, a blobs store added', async () => {
    const ns = namespace();
    const name = autosaveDatabaseName(ns);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('slots', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('slots', 'readwrite');
        tx.objectStore('slots').put({
          id: 'as_oldM2aSlot000001',
          info: { ...INFO, bytes: 2 },
          snapshot: '{}',
          assets: [],
          heartbeatAt: 0,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
    const store = createIndexedDbAutosaveStore({ namespace: ns, locks: null, now: () => 1_000_000 });
    const old = await store?.read('as_oldM2aSlot000001');
    expect(old?.snapshot).toEqual({});
    expect(await old?.blob('a'.repeat(64))).toBeUndefined();
    expect(await blobKeys(ns)).toEqual([]);
  });

  it('stores a slot blob set once, shares it between slots and reads it back', async () => {
    const ns = namespace();
    const store = createIndexedDbAutosaveStore({ namespace: ns, locks: null });
    if (store === null) throw new Error('no IndexedDB');
    const rev = revisionBlobs();
    const source = blobSource(rev.blobs);
    const slot = await store.open();
    await store.write(slot, { snapshotJson: '{"a":1}', assets: [], info: INFO, blobs: rev.ids }, noAsset, source.read);
    expect(source.reads.sort()).toEqual(rev.ids);
    expect(await blobKeys(ns)).toEqual(rev.ids);
    // A second write of the same set reads nothing again.
    await store.write(slot, { snapshotJson: '{"a":2}', assets: [], info: INFO, blobs: rev.ids }, noAsset, source.read);
    expect(source.reads).toHaveLength(rev.ids.length);
    const read = await store.read(slot);
    for (const id of rev.ids) expect(await read?.blob(id)).toEqual(rev.blobs.get(id));
    expect(await read?.blob('f'.repeat(64))).toBeUndefined(); // not listed by the slot
  });

  it('deletes the blobs no slot lists in an idle pass after an overwrite or a removal', async () => {
    const ns = namespace();
    let pending: (() => void) | null = null;
    const store = createIndexedDbAutosaveStore({
      namespace: ns,
      locks: null,
      idle: (fn) => {
        pending = fn;
      },
    });
    if (store === null) throw new Error('no IndexedDB');
    const a = revisionBlobs(primitive('cube', { subdivisionsWidth: 2 }));
    const b = revisionBlobs(primitive('cube', { subdivisionsWidth: 3 }));
    const all = new Map([...a.blobs, ...b.blobs]);
    const source = blobSource(all);
    const slot = await store.open();
    await store.write(slot, { snapshotJson: '{}', assets: [], info: INFO, blobs: a.ids }, noAsset, source.read);
    await store.write(slot, { snapshotJson: '{}', assets: [], info: INFO, blobs: b.ids }, noAsset, source.read);
    // Before the idle pass both sets are there; after it only the slot's current one.
    expect(await blobKeys(ns)).toEqual([...new Set([...a.ids, ...b.ids])].sort());
    await run(() => (pending as unknown as () => void)());
    await blobsCollected(store);
    expect(await blobKeys(ns)).toEqual(b.ids);
    await store.remove(slot);
    await run(() => (pending as unknown as () => void)());
    await blobsCollected(store);
    expect(await blobKeys(ns)).toEqual([]);
  });
});

describe('multi-tab recovery of a mesh (§5.20, E2E-MOD-14 at the store level)', () => {
  async function page(ns: string, now: () => number): Promise<EditorApp> {
    await loadMeshKernel();
    const autosave = createIndexedDbAutosaveStore({ namespace: ns, locks: null, now });
    const app = createEditorApp({
      services: { ...createFakeServices(), autosave, blobs: createBrowserBlobStore() },
    });
    app.prefs.setState({ firstRunDone: true });
    await startAutosave(app).ready;
    return app;
  }

  it('two pages recover the same slot and see the same mesh revision', async () => {
    const ns = namespace();
    let clock = 1_000_000;
    const now = () => clock;
    const first = await page(ns, now);
    const data = primitive('cube', { subdivisionsWidth: 2 });
    const ref = (first.meshes as KernelMeshRuntimes).storeRevision(data);
    first.store.transact({ label: 'Cube' }, (tx) => tx.put('meshes', meshRecord('msh_Cube', ref)));
    first.session.setState({ dirty: true });
    const written = await first.run('file.autosaveNow');
    expect(written.status).toBe('finished');
    const slot = first.session.getState().autosave.slot as string;
    // The first page goes away (no heartbeat any more); later pages find its slot.
    first.dispose();
    clock += 60_000;
    const second = await page(ns, now);
    const third = await page(ns, now);
    for (const app of [second, third]) {
      expect(app.session.getState().recovery.map((r) => r.id)).toContain(slot);
      const result = await app.run('file.recover', { slot });
      expect(result.status).toBe('finished');
      await (app.meshes as KernelMeshRuntimes).settled();
      const runtime = app.meshes.get('msh_Cube' as MeshId);
      expect(runtime?.state).toBe('ready');
      expect(app.store.get('meshes', 'msh_Cube' as MeshId)?.data?.manifest).toBe(ref.manifest);
      expect(runtime?.data()?.counts).toEqual(data.counts);
    }
    second.dispose();
    third.dispose();
  });
});

describe('browser services', () => {
  it('give the editor a blob store of its own (no persistence: the autosave store owns IndexedDB)', () => {
    const { services } = createShellServices({ decoderPath: '/decoders/', storage: 'memory' });
    expect(services.blobs).toBeDefined();
    const id = services.blobs?.put(new Uint8Array([1, 2, 3])) as string;
    expect(services.blobs?.has(id)).toBe(true);
    const other = createShellServices({ decoderPath: '/decoders/', storage: 'memory' }).services.blobs;
    expect(other?.has(id)).toBe(false);
  });
});
