// The browser's AutosaveStore (M2A-SPEC §5.20, FR-PROJ-05): IndexedDB database `ekza-animator-autosave-v1` (plus the
// storage namespace of e2e runs) with two object stores — `slots` (slot info, the snapshot JSON and the asset ids it
// references) and `assets` (model bytes by SHA-256, shared by every slot and written once). A slot belongs to one page
// load: a Web Lock `ekza-animator:autosave:<slot>` held until the page unloads marks it live; without Web Locks the
// page writes a heartbeat every 5 s and a slot whose heartbeat is older than 20 s is an orphan. Every IndexedDB and
// Web Locks call is feature-detected; failures reject, and the autosave controller turns itself off. A write checks,
// inside its transaction, that every stored asset it relies on is still there (another page may have collected it
// meanwhile) and starts over when one is gone.
//
// M6a (M6A-SPEC §5.20, B7): database version 2 adds the `blobs` object store (mesh manifests and chunks by SHA-256),
// **owned by this store alone** (the BlobStore has no persistence of its own). A slot row lists its blob set (the
// closure the controller passes); a write stores only the blobs the database does not have, checks inside its
// transaction that the ones it relies on are still there, and an idle pass after a write or a removal deletes the
// blobs no slot lists. `read(slot).blob` reads them back for recovery (lazily, through the BlobStore's sources).
import type { AssetId, AssetRecord } from '@ekza-animator/doc';
import type { AutosaveSlotInfo, AutosaveStore, BlobId } from '@ekza-animator/editor-core';

export const AUTOSAVE_DB = 'ekza-animator-autosave-v1';
/** 1: M2a (slots, assets); 2: M6a adds `blobs`. */
export const AUTOSAVE_DB_VERSION = 2;
export const LOCK_PREFIX = 'ekza-animator:autosave:';
export const HEARTBEAT_MS = 5000;
export const HEARTBEAT_STALE_MS = 20_000;

/** A write starts over when an asset it relies on was collected meanwhile; it gives up after this many tries. */
const MAX_WRITE_ATTEMPTS = 3;

const SLOTS = 'slots';
const ASSETS = 'assets';
const BLOBS = 'blobs';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** One row of `slots`. A row without a snapshot is a claimed slot (heartbeat) with nothing to recover yet. */
interface SlotRow {
  readonly id: string;
  readonly info: Omit<AutosaveSlotInfo, 'id'> | null;
  readonly snapshot: string | null;
  readonly assets: readonly AssetId[];
  readonly heartbeatAt: number | null;
  /** M6a: the slot's mesh blob set (absent in rows written by M2a). */
  readonly blobs?: readonly BlobId[];
}

/** One row of `blobs` (M6a). */
interface BlobRow {
  readonly id: BlobId;
  readonly bytes: Uint8Array;
}

/** One row of `assets`. */
interface AssetRow {
  readonly id: AssetId;
  readonly record: AssetRecord;
  readonly bytes: Uint8Array;
}

/** The subset of `navigator.locks` the store uses. */
export interface LockApi {
  request(name: string, options: { readonly mode: 'exclusive' }, callback: () => Promise<void>): Promise<void>;
  query(): Promise<{ readonly held?: readonly { readonly name?: string }[] }>;
}

export interface IndexedDbAutosaveOptions {
  /** Database suffix (`ekza-animator-autosave-v1:<namespace>`); e2e runs use one per URL `ns` or page load. */
  readonly namespace?: string;
  /** Default `globalThis.indexedDB`; null: IndexedDB is missing (the store is null). */
  readonly indexedDB?: IDBFactory | null;
  /** Default `navigator.locks` when present; null forces the heartbeat mode. */
  readonly locks?: LockApi | null;
  readonly now?: () => number;
  /** Heartbeat interval without Web Locks (default 5 s). */
  readonly heartbeatMs?: number;
  /** Runs the idle blob collection (default: `requestIdleCallback`, else a 0 ms timeout). */
  readonly idle?: (fn: () => void) => void;
}

/** The database name of a storage namespace. */
export function autosaveDatabaseName(namespace?: string): string {
  return namespace === undefined || namespace === '' ? AUTOSAVE_DB : `${AUTOSAVE_DB}:${namespace}`;
}

/** 'as_' + 16 base62 characters from the platform's CSPRNG (§4.5 AutosaveSlotInfo.id). */
export function newSlotId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let id = 'as_';
  for (const byte of bytes) id += BASE62[byte % 62];
  return id;
}

function defaultLocks(): LockApi | null {
  const locks = (globalThis.navigator as { locks?: LockApi } | undefined)?.locks;
  return locks !== undefined && typeof locks.request === 'function' && typeof locks.query === 'function' ? locks : null;
}

function defaultIdle(): (fn: () => void) => void {
  const idle = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  return typeof idle === 'function'
    ? (fn) => {
        idle(fn, { timeout: 2000 });
      }
    : (fn) => {
        globalThis.setTimeout(fn, 0);
      };
}

/** Exactly `bytes`, in a buffer of its own (structured cloning a view stores its whole buffer). */
function own(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new DOMException('IndexedDB transaction aborted', 'AbortError'));
  });
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;

/** IndexedDB autosave store; `null` when IndexedDB is missing (the controller then reports autosave off). */
export function createIndexedDbAutosaveStore(opts: IndexedDbAutosaveOptions = {}): AutosaveStore | null {
  let factory: IDBFactory | null | undefined;
  try {
    factory = opts.indexedDB === undefined ? globalThis.indexedDB : opts.indexedDB;
  } catch {
    return null;
  }
  if (factory === undefined || factory === null) return null;
  const idb = factory;
  const name = autosaveDatabaseName(opts.namespace);
  const locks = opts.locks === undefined ? defaultLocks() : opts.locks;
  const now = opts.now ?? (() => Date.now());
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const idle = opts.idle ?? defaultIdle();
  let database: Promise<IDBDatabase> | null = null;
  let ownSlot: string | null = null;
  let collectionQueued = false;
  /** Resolves when the last scheduled blob collection finished (tests). */
  let collected: Promise<void> = Promise.resolve();

  const db = (): Promise<IDBDatabase> => {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = idb.open(name, AUTOSAVE_DB_VERSION);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      request.onupgradeneeded = () => {
        const upgrade = request.result;
        if (!upgrade.objectStoreNames.contains(SLOTS)) upgrade.createObjectStore(SLOTS, { keyPath: 'id' });
        if (!upgrade.objectStoreNames.contains(ASSETS)) upgrade.createObjectStore(ASSETS, { keyPath: 'id' });
        // Version 2 (M6a): mesh blobs; rows of version-1 slots have no blob set and keep working.
        if (!upgrade.objectStoreNames.contains(BLOBS)) upgrade.createObjectStore(BLOBS, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const opened = request.result;
        // Another tab upgrading the database (a later version) closes this connection instead of blocking it.
        opened.onversionchange = () => opened.close();
        resolve(opened);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
      request.onblocked = () => reject(new DOMException('The autosave database is blocked', 'InvalidStateError'));
    });
    database.catch(() => {
      database = null;
    });
    return database;
  };

  const allSlots = async (): Promise<SlotRow[]> => {
    const tx = (await db()).transaction(SLOTS, 'readonly');
    return (await promised(tx.objectStore(SLOTS).getAll())) as SlotRow[];
  };

  /** Lock names currently held in this origin (Web Locks mode). */
  const heldLocks = async (): Promise<ReadonlySet<string>> => {
    if (locks === null) return new Set();
    const snapshot = await locks.query();
    return new Set((snapshot.held ?? []).map((lock) => lock.name ?? ''));
  };

  const isLive = (row: SlotRow, held: ReadonlySet<string>, at: number): boolean => {
    if (row.id === ownSlot) return true;
    if (locks !== null) return held.has(`${LOCK_PREFIX}${row.id}`);
    return row.heartbeatAt !== null && at - row.heartbeatAt <= HEARTBEAT_STALE_MS;
  };

  /**
   * Deletes the asset rows no slot references any more, inside `tx` (readwrite over both stores). `slots` are the rows
   * as they will be after the transaction.
   */
  const collectAssets = (tx: IDBTransaction, slots: readonly SlotRow[]): void => {
    const referenced = new Set<string>();
    for (const row of slots) for (const id of row.assets) referenced.add(id);
    const request = tx.objectStore(ASSETS).getAllKeys();
    request.onsuccess = () => {
      for (const key of request.result) {
        if (typeof key === 'string' && !referenced.has(key)) tx.objectStore(ASSETS).delete(key);
      }
    };
  };

  /** Removes rows of pages that are gone and have nothing to recover (a claim or heartbeat only). */
  const pruneDeadClaims = async (): Promise<void> => {
    const [rows, held] = await Promise.all([allSlots(), heldLocks()]);
    const at = now();
    const dead = rows.filter((row) => row.snapshot === null && !isLive(row, held, at));
    if (dead.length === 0) return;
    const tx = (await db()).transaction(SLOTS, 'readwrite');
    for (const row of dead) tx.objectStore(SLOTS).delete(row.id);
    await completed(tx);
  };

  /** Deletes the blobs no slot lists (the idle pass after a write or a removal, §5.20). */
  const collectBlobs = async (): Promise<void> => {
    const tx = (await db()).transaction([SLOTS, BLOBS], 'readwrite');
    const rows = tx.objectStore(SLOTS).getAll();
    rows.onsuccess = () => {
      const referenced = new Set<string>();
      for (const row of rows.result as SlotRow[]) for (const id of row.blobs ?? []) referenced.add(id);
      const keys = tx.objectStore(BLOBS).getAllKeys();
      keys.onsuccess = () => {
        for (const key of keys.result) {
          if (typeof key === 'string' && !referenced.has(key)) tx.objectStore(BLOBS).delete(key);
        }
      };
    };
    await completed(tx);
  };
  const scheduleCollection = (): void => {
    if (collectionQueued) return;
    collectionQueued = true;
    collected = new Promise<void>((resolve) => {
      idle(() => {
        collectionQueued = false;
        collectBlobs().then(resolve, resolve);
      });
    });
  };

  const heartbeat = async (slot: string): Promise<void> => {
    const tx = (await db()).transaction(SLOTS, 'readwrite');
    const slots = tx.objectStore(SLOTS);
    const request = slots.get(slot);
    request.onsuccess = () => {
      const row = (request.result as SlotRow | undefined) ?? { id: slot, info: null, snapshot: null, assets: [] };
      slots.put({ ...row, heartbeatAt: now() } satisfies SlotRow);
    };
    await completed(tx);
  };

  return {
    async open(): Promise<string> {
      if (ownSlot !== null) return ownSlot;
      await db();
      const slot = newSlotId();
      if (locks !== null) {
        // The lock is held until the page unloads: its callback never settles.
        await new Promise<void>((granted, refused) => {
          locks
            .request(`${LOCK_PREFIX}${slot}`, { mode: 'exclusive' }, () => {
              granted();
              return new Promise<void>(() => {});
            })
            .catch(refused);
        });
      } else {
        await heartbeat(slot);
        const timer = setInterval(() => {
          void heartbeat(slot).catch(() => {});
        }, heartbeatMs);
        // Never keeps a Node test process alive.
        (timer as { unref?: () => void }).unref?.();
      }
      ownSlot = slot;
      await pruneDeadClaims().catch(() => {});
      return slot;
    },

    async write(slot, data, readAsset, readBlob): Promise<{ readonly bytes: number }> {
      const handle = await db();
      /** Bytes read so far (a write that starts over does not read them again). */
      const read = new Map<AssetId, Uint8Array>();
      const readBlobs = new Map<BlobId, Uint8Array>();
      const slotBlobs = [...new Set(data.blobs)].sort();
      for (let attempt = 1; ; attempt++) {
        const known = new Set(
          (await promised(handle.transaction(ASSETS, 'readonly').objectStore(ASSETS).getAllKeys())).filter(
            (key): key is string => typeof key === 'string',
          ),
        );
        const knownBlobs = new Set(
          (await promised(handle.transaction(BLOBS, 'readonly').objectStore(BLOBS).getAllKeys())).filter(
            (key): key is string => typeof key === 'string',
          ),
        );
        // Mesh blobs the database does not have yet (read outside the transaction, like assets).
        const freshBlobs = new Map<BlobId, BlobRow>();
        for (const id of slotBlobs) {
          if (knownBlobs.has(id)) continue;
          const bytes = readBlobs.get(id) ?? (await readBlob(id));
          readBlobs.set(id, bytes);
          freshBlobs.set(id, { id, bytes: own(bytes) });
        }
        // Bytes of assets this database has not seen yet (read outside the transaction: it must not wait on them).
        const fresh = new Map<AssetId, AssetRow>();
        for (const record of data.assets) {
          if (known.has(record.id) || fresh.has(record.id)) continue;
          const bytes = read.get(record.id) ?? (await readAsset(record.id));
          read.set(record.id, bytes);
          // Structured cloning a view stores its whole buffer: keep exactly the asset's bytes.
          fresh.set(record.id, { id: record.id, record, bytes: own(bytes) });
        }
        const bytes =
          utf8Length(data.snapshotJson) +
          [...fresh.values()].reduce((sum, row) => sum + row.bytes.byteLength, 0) +
          [...freshBlobs.values()].reduce((sum, row) => sum + row.bytes.byteLength, 0);
        const row: SlotRow = {
          id: slot,
          info: { ...data.info, bytes },
          snapshot: data.snapshotJson,
          assets: data.assets.map((record) => record.id),
          heartbeatAt: locks === null ? now() : null,
          blobs: slotBlobs,
        };
        const tx = handle.transaction([SLOTS, ASSETS, BLOBS], 'readwrite');
        const assets = tx.objectStore(ASSETS);
        const blobStore = tx.objectStore(BLOBS);
        for (const asset of fresh.values()) assets.put(asset);
        for (const blob of freshBlobs.values()) blobStore.put(blob);
        // An asset listed above may have been collected since (another page's removal, a discard, housekeeping):
        // check each one inside this transaction, and start over when one is gone, so that a slot never points at
        // bytes the database no longer has.
        let missing = false;
        for (const record of data.assets) {
          if (fresh.has(record.id)) continue;
          const check = assets.count(record.id);
          check.onsuccess = () => {
            if (check.result > 0 || missing) return;
            missing = true;
            tx.abort();
          };
        }
        // The same for the blobs this slot shares with others (an idle collection elsewhere may have run).
        for (const id of slotBlobs) {
          if (freshBlobs.has(id)) continue;
          const check = blobStore.count(id);
          check.onsuccess = () => {
            if (check.result > 0 || missing) return;
            missing = true;
            tx.abort();
          };
        }
        tx.objectStore(SLOTS).put(row);
        const others = tx.objectStore(SLOTS).getAll();
        others.onsuccess = () => {
          const rows = (others.result as SlotRow[]).map((other) => (other.id === slot ? row : other));
          collectAssets(tx, rows);
        };
        try {
          await completed(tx);
          // The previous content of this slot may have been the last user of some blobs.
          scheduleCollection();
          return { bytes };
        } catch (error) {
          if (!missing) throw error;
          if (attempt >= MAX_WRITE_ATTEMPTS) {
            throw new DOMException('The autosave assets kept changing during the write', 'AbortError');
          }
        }
      }
    },

    async listOrphans(): Promise<readonly AutosaveSlotInfo[]> {
      const [rows, held] = await Promise.all([allSlots(), heldLocks()]);
      const at = now();
      return rows
        .filter((row) => row.snapshot !== null && row.info !== null && !isLive(row, held, at))
        .map((row) => ({ ...(row.info as Omit<AutosaveSlotInfo, 'id'>), id: row.id }))
        .sort((a, b) => b.savedAt - a.savedAt);
    },

    async read(slot) {
      const tx = (await db()).transaction([SLOTS, ASSETS], 'readonly');
      const row = (await promised(tx.objectStore(SLOTS).get(slot))) as SlotRow | undefined;
      if (row === undefined || row.snapshot === null) return null;
      const assets = new Map<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>();
      for (const id of row.assets) {
        const asset = (await promised(tx.objectStore(ASSETS).get(id))) as AssetRow | undefined;
        if (asset !== undefined) assets.set(id, { record: asset.record, bytes: new Uint8Array(asset.bytes) });
      }
      // M6a: the slot's mesh blobs, read on demand (recovery loads them lazily through the BlobStore).
      const listed = new Set<string>(row.blobs ?? []);
      const blob = async (id: BlobId): Promise<Uint8Array | undefined> => {
        if (!listed.has(id)) return undefined;
        const found = (await promised((await db()).transaction(BLOBS, 'readonly').objectStore(BLOBS).get(id))) as
          | BlobRow
          | undefined;
        return found === undefined ? undefined : new Uint8Array(found.bytes);
      };
      return { snapshot: JSON.parse(row.snapshot) as unknown, assets, blob };
    },

    async remove(slot): Promise<void> {
      const tx = (await db()).transaction([SLOTS, ASSETS], 'readwrite');
      const slots = tx.objectStore(SLOTS);
      if (slot === ownSlot && locks === null) {
        // This page's claim stays (its heartbeat); only the recoverable content goes.
        const request = slots.get(slot);
        request.onsuccess = () => {
          if (request.result !== undefined) {
            slots.put({ id: slot, info: null, snapshot: null, assets: [], heartbeatAt: now() } satisfies SlotRow);
          }
        };
      } else {
        slots.delete(slot);
      }
      const rest = slots.getAll();
      rest.onsuccess = () => {
        collectAssets(
          tx,
          (rest.result as SlotRow[]).filter((row) => row.id !== slot),
        );
      };
      await completed(tx);
      scheduleCollection();
    },
    /** Resolves once the last scheduled idle blob collection has run (tests). */
    blobsCollected: () => collected,
  } as AutosaveStore & { blobsCollected(): Promise<void> };
}

/** The idle blob collection's completion of a store made by `createIndexedDbAutosaveStore` (tests). */
export function blobsCollected(store: AutosaveStore): Promise<void> {
  const withHook = store as Partial<{ blobsCollected(): Promise<void> }>;
  return withHook.blobsCollected?.() ?? Promise.resolve();
}
