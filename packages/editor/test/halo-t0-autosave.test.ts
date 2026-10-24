// Halo T0 (STUDIO-TOUCH-SPEC S11, S24, §16.4; ST-22): on iOS the page's own autosave snapshot outlives a clean end
// (a project shared to Files is not proof that it arrived); other slots are still removed. And the request to keep
// this site's storage (`navigator.storage.persist()`).
import type { AutosaveSlotInfo } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autosaveDatabaseName,
  createIndexedDbAutosaveStore,
  type LockApi,
  newSlotId,
  requestPersistentStorage,
} from '../src/services/autosave';

const created: string[] = [];
function namespace(): string {
  const ns = `t0-${newSlotId().slice(3)}`;
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
  appVersion: '0.6.0',
  schemaVersion: 2,
};
const none = (): Promise<Uint8Array> => Promise.reject(new Error('none'));

function fakeLocks(): LockApi & { release(name: string): void } {
  const held = new Set<string>();
  return {
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

const write = { snapshotJson: '{"doc":1}', assets: [], info: INFO, blobs: [] };

describe('the autosave store on iOS (S24)', () => {
  it('keeps this page’s own snapshot through a clean end; the next write replaces it', async () => {
    const ns = namespace();
    const locks = fakeLocks();
    const page = createIndexedDbAutosaveStore({ namespace: ns, locks, keepOwnSnapshot: true });
    const slot = (await page?.open()) ?? '';
    await page?.write(slot, write, none, none);
    await page?.remove(slot); // a save, new or open, or an unload while clean
    expect(await page?.read(slot)).not.toBeNull();
    await page?.write(slot, { ...write, snapshotJson: '{"doc":2}' }, none, none);
    expect((await page?.read(slot))?.snapshot).toEqual({ doc: 2 });
    // after a reload the slot is offered for recovery like any orphan
    locks.release(`ekza-animator:autosave:${slot}`);
    const next = createIndexedDbAutosaveStore({ namespace: ns, locks, keepOwnSnapshot: true });
    expect((await next?.listOrphans())?.map((s) => s.id)).toEqual([slot]);
    // other slots (a recovered or discarded one) are still removed
    await next?.remove(slot);
    expect(await next?.read(slot)).toBeNull();
  });

  it('elsewhere a clean end removes it, as before', async () => {
    const ns = namespace();
    const page = createIndexedDbAutosaveStore({ namespace: ns, locks: fakeLocks(), keepOwnSnapshot: false });
    const slot = (await page?.open()) ?? '';
    await page?.write(slot, write, none, none);
    await page?.remove(slot);
    expect(await page?.read(slot)).toBeNull();
    // the default follows the device class: the desktop test browser removes it
    const desktop = createIndexedDbAutosaveStore({ namespace: namespace(), locks: fakeLocks() });
    const own = (await desktop?.open()) ?? '';
    await desktop?.write(own, write, none, none);
    await desktop?.remove(own);
    expect(await desktop?.read(own)).toBeNull();
  });
});

describe('requestPersistentStorage (S11, D12)', () => {
  it('reports granted, refused, already persisted and missing', async () => {
    expect(await requestPersistentStorage({ persist: () => Promise.resolve(true) })).toBe(true);
    expect(await requestPersistentStorage({ persist: () => Promise.resolve(false) })).toBe(false);
    let asked = false;
    const persisted = {
      persisted: () => Promise.resolve(true),
      persist: () => {
        asked = true;
        return Promise.resolve(true);
      },
    };
    expect(await requestPersistentStorage(persisted)).toBe(true);
    expect(asked).toBe(false);
    expect(await requestPersistentStorage({})).toBeNull();
    expect(await requestPersistentStorage({ persist: () => Promise.reject(new Error('blocked')) })).toBeNull();
  });
});
