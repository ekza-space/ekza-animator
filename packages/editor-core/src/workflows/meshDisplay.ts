// Character meshes made editable (M6A-SPEC §5.21, §5.23; B8):
//
// - the record id of a character's glTF mesh, `derivedId('mesh', 'asset', [characterId], '', meshIndex)`, and the
//   virtual 'asset' rows of the glTF meshes that have no record yet (Outliner, test API);
// - the edits of a character (records with a source whose revision moved past the first, Make editable's) as the
//   surgeon's `PrimitiveEdit`s, for the bake-into-model export and the display;
// - the display: characters outside Model are shown through the shipped `ModelLoader` on a container rebuilt in memory
//   by `rebuildContainer` from the latest revisions of their edited meshes (never a geometry swap inside the loaded
//   scene). The rebuild runs when leaving Model and on idle after commits (debounced 500 ms, then
//   `requestIdleCallback` with a 2 s timeout); the previous display stays until the new one is ready.
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import {
  type ChangeBatch,
  type CharacterId,
  type DocumentStore,
  derivedId,
  type MeshId,
  type MeshRecord,
} from '@ekza-animator/doc';
import type { GlbContainer, PrimitiveEdit } from '@ekza-animator/io';
import { isAssetCharacter } from '../characters/registry';
import { loadMeshKernel } from '../mesh';
import type { CharacterRuntime, EditorApp, MeshRuntimeRegistry, SessionStore } from '../types';
import { loadWritePath } from './export';

/** The record id of a character's glTF mesh (§3 rule 3): deterministic, so a re-run or an M3 peer never duplicates it. */
export function assetMeshId(character: CharacterId, meshIndex: number): MeshId {
  return derivedId('mesh', 'asset', [character], '', meshIndex);
}

/** A loaded character's glTF mesh without a record (the Model Outliner's `⊘ asset` row). */
export interface AssetMeshRow {
  readonly id: MeshId;
  readonly character: CharacterId;
  readonly meshIndex: number;
  readonly name: string;
}

/** The glTF meshes of every loaded asset character that have no live record yet, in character then mesh order. */
export function assetMeshRows(app: EditorApp): readonly AssetMeshRow[] {
  const rows: AssetMeshRow[] = [];
  for (const runtime of app.characters.list()) {
    const character = app.store.get('characters', runtime.id);
    if (character === undefined || !isAssetCharacter(character)) continue;
    const meshes = runtime.container.json['meshes'];
    if (!Array.isArray(meshes)) continue;
    (meshes as unknown[]).forEach((mesh, meshIndex) => {
      const id = assetMeshId(runtime.id, meshIndex);
      if (app.store.get('meshes', id) !== undefined) return;
      const name = typeof mesh === 'object' && mesh !== null ? (mesh as { name?: unknown }).name : undefined;
      rows.push({
        id,
        character: runtime.id,
        meshIndex,
        name: typeof name === 'string' && name.trim() !== '' ? name : `Mesh ${meshIndex}`,
      });
    });
  }
  return rows;
}

/** Live records of a character's glTF meshes (made editable), by glTF mesh index. */
export function characterMeshRecords(store: DocumentStore, character: CharacterId): readonly MeshRecord[] {
  return store
    .list('meshes')
    .filter(
      (record) =>
        'character' in record.owner &&
        record.owner.character === character &&
        record.source !== null &&
        record.data !== null,
    )
    .sort((a, b) => (a.source?.mesh ?? 0) - (b.source?.mesh ?? 0));
}

/** A made-editable mesh counts as edited once its revision moved past Make editable's first one. */
export function isEditedMesh(record: MeshRecord): boolean {
  return record.source !== null && record.data !== null && record.data.rev > 1;
}

/** Whether a character has edited meshes (cheap: a store scan, no kernel). */
export function hasMeshEdits(store: DocumentStore, character: CharacterId): boolean {
  return characterMeshRecords(store, character).some(isEditedMesh);
}

/** The revision data of a mesh once its runtime is ready (waits for the kernel and a loading runtime). */
async function readyData(meshes: MeshRuntimeRegistry, id: MeshId, name: string) {
  await loadMeshKernel();
  const runtime = meshes.get(id);
  if (runtime === undefined) throw new EkzaError('mesh-not-ready', `Mesh '${name}' has no runtime`);
  if (runtime.state === 'loading') {
    await new Promise<void>((resolve) => {
      const off = runtime.subscribe((event) => {
        if (event.type === 'state' && event.state !== 'loading') {
          off();
          resolve();
        }
      });
      if (runtime.state !== 'loading') {
        off();
        resolve();
      }
    });
  }
  const data = runtime.data();
  if (data === null) {
    throw new EkzaError(
      'mesh-not-ready',
      `Mesh '${name}' is ${runtime.state}${runtime.error === null ? '' : `: ${runtime.error}`}`,
    );
  }
  return data;
}

/**
 * The edited meshes of a character as surgeon edits (§5.22): the latest revision of every record whose revision moved
 * past Make editable's, with the source facts the export needs (targets that had NORMAL deltas, tangents).
 */
export async function characterEdits(
  app: Pick<EditorApp, 'store' | 'meshes' | 'characters'>,
  character: CharacterId,
  opts: { readonly dropTangents?: boolean } = {},
): Promise<PrimitiveEdit[]> {
  const records = characterMeshRecords(app.store, character).filter(isEditedMesh);
  if (records.length === 0) return [];
  const runtime = app.characters.get(character);
  if (runtime === undefined) throw new EkzaError('unsupported', 'The character is still loading');
  const io = await (await loadWritePath()).loadMeshIo();
  const edits: PrimitiveEdit[] = [];
  for (const record of records) {
    const meshIndex = (record.source as { readonly mesh: number }).mesh;
    const facts = io.meshFacts(runtime.container, meshIndex);
    edits.push({
      meshIndex,
      data: await readyData(app.meshes, record.id, record.name),
      morphNormals: new Set(facts.morphNormals),
      hadTangents: facts.hadTangents,
      dropTangents: opts.dropTangents === true,
    });
  }
  return edits;
}

/**
 * The container to display for a character: its model rebuilt with the edited meshes (tangents dropped: display
 * only), or null when it has none (its own container). Exposed for tests and the rebuild bench.
 */
export async function displayContainer(
  app: Pick<EditorApp, 'store' | 'meshes' | 'characters'>,
  runtime: CharacterRuntime,
): Promise<GlbContainer | null> {
  const edits = await characterEdits(app, runtime.id, { dropTangents: true });
  if (edits.length === 0) return null;
  return (await loadWritePath()).rebuildContainer(runtime.container, edits);
}

// ---------- the display controller ----------

/** The registry's display hook (`characters/registry.ts`): which container a character's display model loads. */
export interface CharacterDisplaySource {
  /** True when the character's display needs a rebuilt container (it has edited meshes). Synchronous and cheap. */
  hasEdits(character: CharacterId): boolean;
  /** The container to load for the runtime's display (null: its own). */
  containerFor(runtime: CharacterRuntime): Promise<GlbContainer | null>;
}

/** Timers of the debounced idle rebuild (injected in tests). */
export interface DisplayTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** `requestIdleCallback` with a timeout where it exists, else a 0 ms timeout. */
  idle(fn: () => void, timeoutMs: number): void;
}

export const DISPLAY_DEBOUNCE_MS = 500;
export const DISPLAY_IDLE_TIMEOUT_MS = 2000;

export function browserDisplayTimers(): DisplayTimers {
  const idle = (globalThis as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    idle: (fn, timeoutMs) => {
      if (typeof idle === 'function') idle(fn, { timeout: timeoutMs });
      else globalThis.setTimeout(fn, 0);
    },
  };
}

export interface MeshDisplayController extends CharacterDisplaySource {
  /** Rebuilds the displays of characters whose edited meshes changed, now (leaving Model calls it). */
  flush(): Promise<void>;
  dispose(): void;
}

/**
 * The display controller: tracks commits that change the edited meshes of characters, schedules their display
 * rebuild (debounced, on idle) and runs it at once when the workspace leaves Model. `redisplay` is the registry's
 * (late-bound: the registry takes this controller as its display hook).
 */
export function createMeshDisplay(deps: {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly app: () => Pick<EditorApp, 'store' | 'meshes' | 'characters'> | null;
  readonly redisplay: (character: CharacterId) => Promise<void>;
  readonly timers?: DisplayTimers;
}): MeshDisplayController {
  const timers = deps.timers ?? browserDisplayTimers();
  const dirty = new Set<CharacterId>();
  const cache = new Map<CharacterId, { readonly key: string; readonly container: Promise<GlbContainer | null> }>();
  let timer: unknown = null;
  let idleQueued = false;
  let disposed = false;

  const ownerOf = (row: unknown): CharacterId | null => {
    const record = row as Partial<MeshRecord> | undefined;
    const owner = record?.owner;
    return record?.source !== null && record?.source !== undefined && owner !== undefined && 'character' in owner
      ? owner.character
      : null;
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    const characters = [...dirty];
    dirty.clear();
    await Promise.all(characters.map((character) => deps.redisplay(character).catch(() => {})));
  };

  const schedule = (): void => {
    if (disposed || timer !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (idleQueued) return;
      idleQueued = true;
      timers.idle(() => {
        idleQueued = false;
        if (!disposed) void flush();
      }, DISPLAY_IDLE_TIMEOUT_MS);
    }, DISPLAY_DEBOUNCE_MS);
  };

  const onBatch = (batch: ChangeBatch): void => {
    let touched = false;
    for (const change of batch.changes) {
      if (change.table !== 'meshes') continue;
      for (const row of [change.before, change.after]) {
        const owner = ownerOf(row);
        if (owner === null) continue;
        dirty.add(owner);
        touched = true;
      }
    }
    if (touched) schedule();
  };

  const disposers: Disposer[] = [
    deps.store.subscribe(onBatch),
    deps.session.subscribe((state, previous) => {
      if (previous.workspace === 'model' && state.workspace !== 'model' && dirty.size > 0) void flush();
    }),
  ];

  return {
    hasEdits: (character) => hasMeshEdits(deps.store, character),
    containerFor(runtime: CharacterRuntime): Promise<GlbContainer | null> {
      const app = deps.app();
      if (app === null) return Promise.resolve(null);
      const records = characterMeshRecords(deps.store, runtime.id).filter(isEditedMesh);
      if (records.length === 0) return Promise.resolve(null);
      const key = `${runtime.container.sha256}:${records.map((r) => `${r.source?.mesh}=${r.data?.manifest}`).join(',')}`;
      const cached = cache.get(runtime.id);
      if (cached?.key === key) return cached.container;
      const container = displayContainer(app, runtime);
      cache.set(runtime.id, { key, container });
      container.catch(() => {
        if (cache.get(runtime.id)?.container === container) cache.delete(runtime.id);
      });
      return container;
    },
    flush,
    dispose(): void {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      for (const dispose of disposers.splice(0)) dispose();
      cache.clear();
      dirty.clear();
    },
  };
}
