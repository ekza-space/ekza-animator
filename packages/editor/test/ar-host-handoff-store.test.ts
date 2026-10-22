// AUTORIG-SPEC §4.4 (D1): one-shot handoff records of the IndexedDB AutosaveStore, against the browser's real
// IndexedDB — a record round-trips its snapshot, assets, blobs and HandoffInfo once (read-and-delete), is never an
// orphan, never touches the writing page's own slot, keeps the assets and blobs it shares with slots, expires after
// 10 minutes and is pruned by housekeeping.
import type { AssetId, AssetRecord } from '@ekza-studio/doc';
import type { AutosaveSlotInfo, HandoffInfo } from '@ekza-studio/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autosaveDatabaseName,
  blobsCollected,
  createIndexedDbAutosaveStore,
  HANDOFF_TTL_MS,
  newSlotId,
} from '../src/services/autosave';

const created: string[] = [];

function namespace(): string {
  const ns = `handoff-${newSlotId().slice(3)}`;
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
  projectName: 'Cube Lad',
  savedAt: 1_700_000_000_000,
  characters: 1,
  clips: 1,
  appVersion: '0.4.0',
  schemaVersion: 4,
};

function asset(id: string, size: number): AssetRecord {
  return {
    id: id,
    name: `${id}.glb`,
    ext: 'glb',
    mime: 'model/gltf-binary',
    size,
    role: 'model',
    provenance: null,
  } as AssetRecord;
}

const BYTES: Readonly<Record<string, Uint8Array>> = {
  a: new Uint8Array([1, 2, 3]),
  b: new Uint8Array([4, 5]),
  m1: new Uint8Array([9, 9, 9, 9]),
  c1: new Uint8Array([8]),
};
const readBytes = (id: string): Promise<Uint8Array> => {
  const bytes = BYTES[id];
  return bytes === undefined ? Promise.reject(new Error(`no ${id}`)) : Promise.resolve(bytes);
};

function handoffInfo(createdAt: number): HandoffInfo {
  return {
    route: 'studio',
    workspace: 'animate',
    subject: { character: null, meshes: ['msh_body' as never] },
    autorig: { step: 'animations', startPose: { armAngle: 0.7, kind: 'a' } },
    createdAt,
  };
}

function store(ns: string, now: () => number = () => Date.now()) {
  const created = createIndexedDbAutosaveStore({ namespace: ns, now, idle: (fn) => setTimeout(fn, 0) });
  if (created === null) throw new Error('IndexedDB is unavailable');
  const members = ['writeHandoff', 'takeHandoff', 'pruneHandoffs'];
  expect(members.filter((member) => typeof Reflect.get(created, member) !== 'function')).toEqual([]);
  return created;
}

describe('handoff records of the IndexedDB AutosaveStore (§4.4)', () => {
  it('round-trips once: snapshot, assets, blobs and info; never an orphan; the own slot untouched', async () => {
    const ns = namespace();
    const source = store(ns);
    const slot = await source.open();
    const snapshotJson = JSON.stringify({ format: 'ekza-animator-doc', tables: { n: 1 } });
    const info = handoffInfo(Date.now());
    const written = await source.writeHandoff?.(
      'u-1',
      { snapshotJson, assets: [asset('a', 3)], blobs: ['m1', 'c1'], info },
      (id) => readBytes(id),
      (id) => readBytes(id),
    );
    expect(written?.bytes).toBe(new TextEncoder().encode(snapshotJson).byteLength + 3 + 5);
    expect(await source.listOrphans()).toEqual([]);
    expect(await source.read(slot)).toBeNull();

    const receiver = store(ns);
    await receiver.open();
    const taken = await receiver.takeHandoff?.('u-1');
    expect(taken?.snapshot).toEqual(JSON.parse(snapshotJson));
    expect(taken?.info).toEqual(info);
    expect([...(taken?.assets.keys() ?? [])]).toEqual(['a']);
    expect(Array.from(taken?.assets.get('a' as AssetId)?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(taken?.assets.get('a' as AssetId)?.record).toEqual(asset('a', 3));
    expect(
      [...(taken?.blobs.entries() ?? [])]
        .map(([id, bytes]) => [id, Array.from(bytes)] as const)
        .sort((x, y) => x[0].localeCompare(y[0])),
    ).toEqual([
      ['c1', [8]],
      ['m1', [9, 9, 9, 9]],
    ]);
    // one-shot
    expect(await receiver.takeHandoff?.('u-1')).toBeNull();
    expect(await receiver.takeHandoff?.('never-written')).toBeNull();
  });

  it('keeps the assets and blobs a slot shares with a taken record', async () => {
    const ns = namespace();
    const page = store(ns);
    const slot = await page.open();
    await page.write(
      slot,
      { snapshotJson: '{"slot":1}', assets: [asset('a', 3)], info: INFO, blobs: ['m1'] },
      readBytes,
      readBytes,
    );
    await page.writeHandoff?.(
      'u-2',
      {
        snapshotJson: '{"handoff":1}',
        assets: [asset('a', 3), asset('b', 2)],
        blobs: ['m1', 'c1'],
        info: handoffInfo(Date.now()),
      },
      readBytes,
      readBytes,
    );
    expect((await page.takeHandoff?.('u-2'))?.blobs.size).toBe(2);
    await blobsCollected(page);
    const read = await page.read(slot);
    expect([...(read?.assets.keys() ?? [])]).toEqual(['a']);
    expect(Array.from((await read?.blob('m1')) ?? [])).toEqual([9, 9, 9, 9]);
  });

  it('expires after 10 minutes (taken as null, and deleted) and is pruned by housekeeping', async () => {
    const ns = namespace();
    let clock = 1_000_000;
    const page = store(ns, () => clock);
    await page.open();
    const write = (id: string, createdAt: number) =>
      page.writeHandoff?.(
        id,
        { snapshotJson: '{}', assets: [], blobs: [], info: handoffInfo(createdAt) },
        readBytes,
        readBytes,
      );
    await write('old', clock);
    await write('fresh', clock + HANDOFF_TTL_MS);
    clock += HANDOFF_TTL_MS + 1;
    expect(await page.takeHandoff?.('old')).toBeNull();
    await write('older', clock - HANDOFF_TTL_MS - 5);
    expect(await page.pruneHandoffs?.(HANDOFF_TTL_MS)).toBe(1);
    expect((await page.takeHandoff?.('fresh'))?.info.createdAt).toBe(1_000_000 + HANDOFF_TTL_MS);
    expect(await page.takeHandoff?.('older')).toBeNull();
  });
});
