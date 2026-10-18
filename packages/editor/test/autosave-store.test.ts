// M2A-SPEC §5.20: the IndexedDB AutosaveStore against the browser's real IndexedDB (a namespaced database per test,
// deleted afterwards) — slot round trips, assets written once and collected when unreferenced, orphans with Web Locks
// (the real lock manager, and a fake one to close a page) and with the heartbeat fallback, namespaces, and the
// browser services' storage switches.
import type { AssetId, AssetRecord } from '@ekza-animator/doc';
import type { AutosaveSlotInfo } from '@ekza-animator/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTOSAVE_DB,
  autosaveDatabaseName,
  createIndexedDbAutosaveStore,
  HEARTBEAT_STALE_MS,
  LOCK_PREFIX,
  type LockApi,
  newSlotId,
} from '../src/services/autosave';
import { createShellServices } from '../src/services/browser';

const created: string[] = [];

/** A fresh namespace per test; its database is deleted after the test. */
function namespace(): string {
  const ns = `test-${newSlotId().slice(3)}`;
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
  projectName: 'Wave',
  savedAt: 1_700_000_000_000,
  characters: 1,
  clips: 2,
  appVersion: '0.2.0',
  schemaVersion: 2,
};

function asset(id: string, size: number): AssetRecord {
  return { id: id as AssetId, name: `${id}.vrm`, ext: 'vrm', mime: 'model/gltf-binary', size, role: 'model' };
}

/** Bytes per asset id, counting the reads (assets must be read once per database). */
function assetSource(bytes: Record<string, Uint8Array>) {
  const reads: string[] = [];
  return {
    reads,
    read: (id: AssetId): Promise<Uint8Array> => {
      reads.push(id);
      const data = bytes[id];
      return data === undefined ? Promise.reject(new Error(`no asset ${id}`)) : Promise.resolve(data);
    },
  };
}

/** A lock manager for one test: `release(name)` is what closing that page does. */
function fakeLocks(): LockApi & { release(name: string): void; held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    request(name, _options, callback) {
      held.add(name);
      return callback();
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })) }),
    release: (name) => {
      held.delete(name);
    },
  };
}

describe('IndexedDB autosave store', () => {
  it('names its database after the namespace and claims as_ + 16 base62 slot ids', async () => {
    expect(autosaveDatabaseName()).toBe(AUTOSAVE_DB);
    expect(autosaveDatabaseName('r1')).toBe(`${AUTOSAVE_DB}:r1`);
    const ns = namespace();
    const store = createIndexedDbAutosaveStore({ namespace: ns, locks: fakeLocks() });
    const slot = (await store?.open()) ?? '';
    expect(slot).toMatch(/^as_[0-9A-Za-z]{16}$/);
    expect(await store?.open()).toBe(slot);
    const databases = await indexedDB.databases();
    expect(databases.map((db) => db.name)).toContain(`${AUTOSAVE_DB}:${ns}`);
  });

  it('writes and reads a slot; assets are written once, shared by slots, and collected when unreferenced', async () => {
    const ns = namespace();
    const locks = fakeLocks();
    const bytes = { a: new Uint8Array([1, 2, 3, 4]), b: new Uint8Array(1000).fill(7) };
    const source = assetSource(bytes);
    const page1 = createIndexedDbAutosaveStore({ namespace: ns, locks });
    const page2 = createIndexedDbAutosaveStore({ namespace: ns, locks });
    if (page1 === null || page2 === null) throw new Error('IndexedDB is unavailable');
    const one = await page1.open();
    const two = await page2.open();
    const snapshotJson = JSON.stringify({ format: 'ekza-animator-doc', tables: { x: 1 } });
    const first = await page1.write(
      one,
      { snapshotJson, assets: [asset('a', 4), asset('b', 1000)], info: INFO },
      source.read,
    );
    expect(first.bytes).toBe(new TextEncoder().encode(snapshotJson).byteLength + 1004);
    // the second page references the same model: no read, no bytes counted
    const second = await page2.write(
      two,
      { snapshotJson: '{"n":2}', assets: [asset('a', 4)], info: INFO },
      source.read,
    );
    expect(second.bytes).toBe(7);
    expect(source.reads.sort()).toEqual(['a', 'b']);

    const read = await page2.read(one);
    expect(read?.snapshot).toEqual(JSON.parse(snapshotJson));
    expect([...(read?.assets.keys() ?? [])].sort()).toEqual(['a', 'b']);
    expect(Array.from(read?.assets.get('a' as AssetId)?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    expect(read?.assets.get('b' as AssetId)?.record).toEqual(asset('b', 1000));

    // page 1 closes and its slot is discarded: 'b' goes, 'a' stays for page 2
    locks.release(`${LOCK_PREFIX}${one}`);
    await page2.remove(one);
    expect(await page2.read(one)).toBeNull();
    const kept = await page2.read(two);
    expect([...(kept?.assets.keys() ?? [])]).toEqual(['a']);
    // a rewrite that drops the model collects it as well
    await page2.write(two, { snapshotJson: '{}', assets: [], info: INFO }, source.read);
    const empty = await page2.read(two);
    expect(empty?.assets.size).toBe(0);
    expect(source.reads.sort()).toEqual(['a', 'b']);
  });

  it('a shared asset collected while a write reads its other assets is written again, never left missing', async () => {
    const ns = namespace();
    const locks = fakeLocks();
    const bytes = { a: new Uint8Array([1, 2, 3, 4]), b: new Uint8Array([9, 9]) };
    const page1 = createIndexedDbAutosaveStore({ namespace: ns, locks });
    const page2 = createIndexedDbAutosaveStore({ namespace: ns, locks });
    if (page1 === null || page2 === null) throw new Error('IndexedDB is unavailable');
    const one = await page1.open();
    const two = await page2.open();
    // page 1 stored model 'a'
    await page1.write(one, { snapshotJson: '{"n":1}', assets: [asset('a', 4)], info: INFO }, assetSource(bytes).read);
    // page 2 references 'a' (stored, so not read) and 'b' (new): while page 2 reads 'b', page 1's slot is discarded
    // and 'a', referenced by no slot yet, is collected
    const reads: string[] = [];
    let discarded = false;
    const read = async (id: AssetId): Promise<Uint8Array> => {
      reads.push(id);
      if (!discarded) {
        discarded = true;
        locks.release(`${LOCK_PREFIX}${one}`);
        await page1.remove(one);
      }
      const data = bytes[id as 'a' | 'b'];
      if (data === undefined) throw new Error(`no asset ${id}`);
      return data;
    };
    const written = await page2.write(
      two,
      { snapshotJson: '{"n":2}', assets: [asset('a', 4), asset('b', 2)], info: INFO },
      read,
    );
    // the first attempt found 'a' gone inside its transaction and started over, reading 'a' this time
    expect(reads).toEqual(['b', 'a']);
    expect(written.bytes).toBe(7 + 4 + 2);
    const slot = await page2.read(two);
    expect([...(slot?.assets.keys() ?? [])].sort()).toEqual(['a', 'b']);
    expect(Array.from(slot?.assets.get('a' as AssetId)?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('lists the slots of closed pages (Web Locks) with their info, newest first, never its own or live ones', async () => {
    const ns = namespace();
    const locks = fakeLocks();
    const pages = [0, 1, 2].map(() => createIndexedDbAutosaveStore({ namespace: ns, locks }));
    const slots: string[] = [];
    for (const [i, page] of pages.entries()) {
      const slot = (await page?.open()) ?? '';
      slots.push(slot);
      await page?.write(
        slot,
        { snapshotJson: `{"page":${i}}`, assets: [], info: { ...INFO, savedAt: 1000 + i, projectName: `P${i}` } },
        () => Promise.reject(new Error('no assets')),
      );
    }
    const viewer = pages[2];
    expect(await viewer?.listOrphans()).toEqual([]);
    locks.release(`${LOCK_PREFIX}${slots[0]}`);
    locks.release(`${LOCK_PREFIX}${slots[1]}`);
    const orphans = (await viewer?.listOrphans()) ?? [];
    expect(orphans.map((o) => o.id)).toEqual([slots[1], slots[0]]);
    expect(orphans[0]).toEqual({ ...INFO, savedAt: 1001, projectName: 'P1', id: slots[1], bytes: 10 });
  });

  it('a page that claimed a slot but saved nothing leaves no orphan', async () => {
    const ns = namespace();
    const locks = fakeLocks();
    const gone = createIndexedDbAutosaveStore({ namespace: ns, locks });
    const slot = (await gone?.open()) ?? '';
    locks.release(`${LOCK_PREFIX}${slot}`);
    const next = createIndexedDbAutosaveStore({ namespace: ns, locks });
    await next?.open();
    expect(await next?.listOrphans()).toEqual([]);
  });

  it('holds a real Web Lock for its slot until the page unloads', async () => {
    const ns = namespace();
    const store = createIndexedDbAutosaveStore({ namespace: ns });
    const slot = (await store?.open()) ?? '';
    const held = (await navigator.locks.query()).held?.map((lock) => lock.name) ?? [];
    expect(held).toContain(`${LOCK_PREFIX}${slot}`);
    await store?.write(slot, { snapshotJson: '{}', assets: [], info: INFO }, () => Promise.reject(new Error('none')));
    // another page sees a live slot, not an orphan
    const other = createIndexedDbAutosaveStore({ namespace: ns });
    await other?.open();
    expect(await other?.listOrphans()).toEqual([]);
  });

  it('without Web Locks a slot whose heartbeat is older than 20 s is an orphan', async () => {
    const ns = namespace();
    let now = 10_000_000;
    const clock = () => now;
    const page1 = createIndexedDbAutosaveStore({ namespace: ns, locks: null, now: clock, heartbeatMs: 60_000_000 });
    const slot = (await page1?.open()) ?? '';
    await page1?.write(slot, { snapshotJson: '{"a":1}', assets: [], info: INFO }, () =>
      Promise.reject(new Error('none')),
    );
    const page2 = createIndexedDbAutosaveStore({ namespace: ns, locks: null, now: clock, heartbeatMs: 60_000_000 });
    await page2?.open();
    now += HEARTBEAT_STALE_MS;
    expect(await page2?.listOrphans()).toEqual([]);
    now += 1;
    expect((await page2?.listOrphans())?.map((o) => o.id)).toEqual([slot]);
    // its own slot is never an orphan, and removing it keeps the claim (the heartbeat row) but not the content
    expect((await page1?.listOrphans())?.map((o) => o.id)).not.toContain(slot);
    await page1?.remove(slot);
    expect(await page1?.read(slot)).toBeNull();
  });

  it('keeps namespaces apart', async () => {
    const [a, b] = [namespace(), namespace()];
    const locks = fakeLocks();
    const storeA = createIndexedDbAutosaveStore({ namespace: a, locks });
    const slot = (await storeA?.open()) ?? '';
    await storeA?.write(slot, { snapshotJson: '{}', assets: [], info: INFO }, () => Promise.reject(new Error('none')));
    locks.release(`${LOCK_PREFIX}${slot}`);
    const storeB = createIndexedDbAutosaveStore({ namespace: b, locks });
    await storeB?.open();
    expect(await storeB?.listOrphans()).toEqual([]);
    expect(await storeB?.read(slot)).toBeNull();
  });

  it('is null without IndexedDB; rejects when the database cannot open', async () => {
    expect(createIndexedDbAutosaveStore({ indexedDB: null, namespace: 'x' })).toBeNull();
    const broken = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const store = createIndexedDbAutosaveStore({ indexedDB: broken, locks: fakeLocks() });
    await expect(store?.open()).rejects.toThrow('blocked');
  });
});

describe('browser services: autosave and the storage switches (M2A-SPEC §4.8)', () => {
  it('storage=blocked gives no autosave store; a namespace or a fresh page namespace gives one', async () => {
    expect(createShellServices({ decoderPath: '/d/', storageBlocked: true }).services.autosave).toBeNull();
    expect(createShellServices({ decoderPath: '/d/', storage: null }).services.autosave).toBeNull();
    const ns = namespace();
    const named = createShellServices({ decoderPath: '/d/', storageNamespace: ns }).services.autosave;
    await named?.open();
    expect((await indexedDB.databases()).map((db) => db.name)).toContain(autosaveDatabaseName(ns));
    const before = new Set((await indexedDB.databases()).map((db) => db.name));
    const fresh = createShellServices({ decoderPath: '/d/', storage: 'memory' }).services.autosave;
    await fresh?.open();
    const added = (await indexedDB.databases()).map((db) => db.name ?? '').filter((name) => !before.has(name));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(new RegExp(`^${AUTOSAVE_DB}:page-[0-9A-Za-z]{16}$`));
    created.push(...added);
  });
});
