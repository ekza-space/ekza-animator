// Character runtime registry (ARCHITECTURE §10, MVP-SPEC §4.11.6 step 9): one runtime per character — parsed model,
// skeleton, compiled rig program, channel and pose buffers, clip samplers and (asynchronously) the display model.
//
// - Runtime creation awaits the asset store (`assets.get` is async and verifies the bytes), parses the model once
//   per asset and compiles the rig from the document's rig records.
// - A structural rig change (rigs, controls, constraints, solvers) recompiles the program in place ('recompiled').
// - Display models load after `setRenderer` (see `characters/models.ts`), then 'display' is emitted.
// - Characters deleted while loading never get a runtime; undoing the deletion re-creates it from the parse cache.
// - M6a (M6A-SPEC §4.2, §9 B0a): only asset-sourced characters get a runtime. A model-sourced character (M6b,
//   `source.kind === 'model'`, `asset === null`) is skipped here until M6b builds its runtime from the skeleton.
// - M6a display hook (M6A-SPEC §5.23, B8): a character with edited meshes displays a container rebuilt in memory
//   (`ctx.display.containerFor`); `redisplay` reloads a display (the previous one stays until the new one is ready,
//   and a later reload wins over an earlier one that finishes after it). Characters without edits load as before.
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type AnyChange,
  type AssetId,
  batchTables,
  batchTouches,
  type CharacterId,
  type CharacterRecord,
  type ChangeBatch,
  type ClipId,
  type DocumentStore,
  type TableName,
} from '@ekza-studio/doc';
import type { GlbContainer } from '@ekza-studio/io';
import type { ChannelBuffer, ClipSampler, CurveCache, PoseBuffers, RigProgram, SkeletonDesc } from '@ekza-studio/rig';
import type { KernelDeps, ModelSource } from '../app/deps';
import type { CharacterDisplaySource } from '../workflows/meshDisplay';
import type {
  AssetStore,
  CharacterEvent,
  CharacterRegistry,
  CharacterRuntime,
  DisplayModel,
  ModelLoader,
  Notifier,
} from '../types';

/** A character with a model asset (every character M6a writes; `asset === null` only for model sources, M6b). */
type AssetCharacter = CharacterRecord & { readonly asset: AssetId };

/** True for characters this registry builds runtimes for (asset-sourced). */
export function isAssetCharacter(character: CharacterRecord): character is AssetCharacter {
  return character.asset !== null && character.source?.kind !== 'model';
}

const STRUCTURAL_TABLES: ReadonlySet<TableName> = new Set<TableName>([
  'characters',
  'rigs',
  'controls',
  'constraints',
  'solvers',
]);

export interface KernelCharacters extends CharacterRegistry {
  /** Resolves once no runtime creation or display-model load is in flight. */
  settled(): Promise<void>;
  /** M6a (§5.23): reloads the character's display model (from its rebuilt container when it has edited meshes). */
  redisplay(id: CharacterId): Promise<void>;
  dispose(): void;
}

class Runtime implements CharacterRuntime {
  display: DisplayModel | null = null;
  private currentProgram: RigProgram;
  private currentChannels: ChannelBuffer;
  private currentPose: PoseBuffers;
  private readonly samplers = new Map<ClipId, ClipSampler>();

  constructor(
    readonly id: CharacterId,
    readonly asset: AssetId,
    readonly container: GlbContainer,
    readonly skeleton: SkeletonDesc,
    program: RigProgram,
    private readonly makeSampler: (clip: ClipId, program: RigProgram) => ClipSampler,
  ) {
    this.currentProgram = program;
    this.currentChannels = program.allocChannels();
    this.currentPose = program.allocPose();
    program.evaluate(this.currentChannels, this.currentPose);
  }

  get program(): RigProgram {
    return this.currentProgram;
  }

  get channels(): ChannelBuffer {
    return this.currentChannels;
  }

  get pose(): PoseBuffers {
    return this.currentPose;
  }

  sampler(clip: ClipId): ClipSampler {
    let sampler = this.samplers.get(clip);
    if (sampler === undefined) {
      sampler = this.makeSampler(clip, this.currentProgram);
      this.samplers.set(clip, sampler);
    }
    return sampler;
  }

  /** Swaps in a recompiled program: fresh buffers at rest, samplers rebuilt on demand. */
  setProgram(program: RigProgram): void {
    this.disposeSamplers();
    this.currentProgram = program;
    this.currentChannels = program.allocChannels();
    this.currentPose = program.allocPose();
    program.evaluate(this.currentChannels, this.currentPose);
  }

  disposeSampler(clip: ClipId): void {
    this.samplers.get(clip)?.dispose();
    this.samplers.delete(clip);
  }

  dispose(): void {
    this.disposeSamplers();
    this.display?.dispose();
    this.display = null;
  }

  private disposeSamplers(): void {
    for (const sampler of this.samplers.values()) sampler.dispose();
    this.samplers.clear();
  }
}

type Entry =
  | { readonly state: 'loading'; readonly asset: AssetId }
  | { readonly state: 'ready'; readonly asset: AssetId; readonly runtime: Runtime; readonly source: ModelSource }
  /** No runtime: the loader gave none (`null`) or the rig records are missing (retried on structural changes). */
  | { readonly state: 'idle'; readonly asset: AssetId; readonly source: ModelSource | null }
  /** Loading or compiling failed (retried when a document is loaded). */
  | { readonly state: 'failed'; readonly asset: AssetId };

export function createCharacterRegistry(ctx: {
  readonly store: DocumentStore;
  readonly deps: KernelDeps;
  readonly cache: CurveCache;
  readonly assets: AssetStore;
  readonly notify: Notifier;
  readonly models: ModelLoader | null;
  /** M6a (§5.23, B8): which container a display loads; absent = always the character's own. */
  readonly display?: CharacterDisplaySource | null;
}): KernelCharacters {
  const { store, deps } = ctx;
  const entries = new Map<CharacterId, Entry>();
  const listeners = new Set<(e: CharacterEvent) => void>();
  const sources = new Map<AssetId, Promise<ModelSource | null> | ModelSource | null>();
  const inFlight = new Set<Promise<unknown>>();
  let ordered: readonly CharacterRuntime[] = [];
  let disposed = false;

  const emit = (type: CharacterEvent['type'], id: CharacterId): void => {
    for (const listener of listeners) listener({ type, id });
  };

  const track = (promise: Promise<unknown>): void => {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
  };

  const reorder = (): void => {
    const runtimes: CharacterRuntime[] = [];
    const characters = [...store.list('characters')].sort((a, b) =>
      a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1,
    );
    for (const character of characters) {
      const entry = entries.get(character.id);
      if (entry?.state === 'ready') runtimes.push(entry.runtime);
    }
    ordered = runtimes;
  };

  const fail = (character: AssetCharacter, error: unknown): void => {
    entries.set(character.id, { state: 'failed', asset: character.asset });
    const message = error instanceof Error ? error.message : String(error);
    ctx.notify.toast({ kind: 'error', text: `Could not load "${character.name}": ${message}` });
  };

  /** Display loads started per runtime: a load applies only when it is the runtime's latest (M6a redisplay). */
  const displayLoads = new WeakMap<Runtime, number>();

  const loadDisplay = (runtime: Runtime): Promise<void> => {
    const models = ctx.models;
    if (models === null) return Promise.resolve();
    const generation = (displayLoads.get(runtime) ?? 0) + 1;
    displayLoads.set(runtime, generation);
    const display = ctx.display;
    // Characters without edited meshes load exactly as before (no extra step).
    const model =
      display === null || display === undefined || !display.hasEdits(runtime.id)
        ? models.load(runtime.container, runtime.skeleton)
        : display
            .containerFor(runtime)
            .catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              ctx.notify.toast({ kind: 'warning', text: `Edited meshes could not be displayed: ${message}` });
              return null;
            })
            .then((container) => models.load(container ?? runtime.container, runtime.skeleton));
    const loading = model.then(
      (model) => {
        const entry = entries.get(runtime.id);
        if (
          disposed ||
          entry?.state !== 'ready' ||
          entry.runtime !== runtime ||
          displayLoads.get(runtime) !== generation
        ) {
          model.dispose();
          return;
        }
        runtime.display?.dispose();
        runtime.display = model;
        emit('display', runtime.id);
      },
      (error: unknown) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        ctx.notify.toast({ kind: 'warning', text: `The model of a character could not be displayed: ${message}` });
      },
    );
    track(loading);
    return loading;
  };

  /** Builds the runtime of a live character from its parsed model (idle while its rig records are missing). */
  const build = (character: AssetCharacter, source: ModelSource): void => {
    const def = deps.rig.readRigDefinition(store, character.rig);
    if (def === undefined) {
      entries.set(character.id, { state: 'idle', asset: character.asset, source });
      return;
    }
    let runtime: Runtime;
    try {
      const program = deps.rig.compileRig(def, source.skeleton);
      runtime = new Runtime(character.id, character.asset, source.container, source.skeleton, program, (clip, prog) =>
        deps.rig.createClipSampler(store, ctx.cache, clip, prog),
      );
    } catch (error) {
      fail(character, error);
      return;
    }
    entries.set(character.id, { state: 'ready', asset: character.asset, runtime, source });
    reorder();
    emit('added', character.id);
    void loadDisplay(runtime);
  };

  const sourceOf = (character: AssetCharacter): Promise<ModelSource | null> | ModelSource | null => {
    let source = sources.get(character.asset);
    if (source === undefined) {
      source = deps.loadModel(character, ctx.assets);
      sources.set(character.asset, source);
    }
    return source;
  };

  const start = (character: AssetCharacter): void => {
    let source: Promise<ModelSource | null> | ModelSource | null;
    try {
      source = sourceOf(character);
    } catch (error) {
      sources.delete(character.asset);
      fail(character, error);
      return;
    }
    if (!(source instanceof Promise)) {
      if (source === null) entries.set(character.id, { state: 'idle', asset: character.asset, source: null });
      else build(character, source);
      return;
    }
    entries.set(character.id, { state: 'loading', asset: character.asset });
    const loading = source.then(
      (resolved) => {
        if (disposed) return;
        sources.set(character.asset, resolved);
        const current = store.get('characters', character.id);
        const entry = entries.get(character.id);
        // Deleted or re-pointed while loading: the next sync handles the character as it is now.
        if (
          current === undefined ||
          !isAssetCharacter(current) ||
          entry?.state !== 'loading' ||
          current.asset !== character.asset
        ) {
          return;
        }
        if (resolved === null) entries.set(character.id, { state: 'idle', asset: character.asset, source: null });
        else build(current, resolved);
      },
      (error: unknown) => {
        sources.delete(character.asset);
        if (disposed) return;
        const entry = entries.get(character.id);
        const current = store.get('characters', character.id);
        if (current !== undefined && isAssetCharacter(current) && entry?.state === 'loading') fail(current, error);
      },
    );
    track(loading);
  };

  const remove = (id: CharacterId): void => {
    const entry = entries.get(id);
    entries.delete(id);
    if (entry?.state !== 'ready') return;
    entry.runtime.dispose();
    reorder();
    emit('removed', id);
  };

  const recompile = (character: AssetCharacter, entry: Extract<Entry, { state: 'ready' }>): void => {
    const def = deps.rig.readRigDefinition(store, character.rig);
    if (def === undefined) {
      remove(character.id);
      entries.set(character.id, { state: 'idle', asset: character.asset, source: entry.source });
      return;
    }
    try {
      entry.runtime.setProgram(deps.rig.compileRig(def, entry.source.skeleton));
    } catch (error) {
      remove(character.id);
      fail(character, error);
      return;
    }
    emit('recompiled', character.id);
  };

  /** Brings runtimes in line with the document; `touched` = characters with structural changes (all on load). */
  const sync = (touched: ReadonlySet<CharacterId> | 'all'): void => {
    const live = new Map(
      store
        .list('characters')
        .filter(isAssetCharacter)
        .map((character) => [character.id, character]),
    );
    for (const id of entries.keys()) if (!live.has(id)) remove(id);
    for (const [id, character] of live) {
      let entry = entries.get(id);
      if (entry !== undefined && entry.asset !== character.asset) {
        remove(id);
        entry = undefined;
      }
      if (entry === undefined) {
        start(character);
        continue;
      }
      const changed = touched === 'all' || touched.has(id);
      if (!changed) continue;
      if (entry.state === 'ready') recompile(character, entry);
      else if (entry.state === 'idle' && entry.source !== null) build(character, entry.source);
      else if (entry.state === 'failed' && touched === 'all') {
        entries.delete(id);
        start(character);
      }
    }
    reorder();
  };

  /**
   * Characters whose rig program a batch changes: any rig, control, constraint or solver change of their rig, or a
   * character pointing at another rig. Other character fields (name, placement, order, deletion) only need a sync.
   */
  const recompileTargets = (changes: readonly AnyChange[]): Set<CharacterId> => {
    const ids = new Set<CharacterId>();
    for (const change of changes) {
      if (!STRUCTURAL_TABLES.has(change.table)) continue;
      const row = (change.after ?? change.before) as Readonly<Record<string, unknown>> | undefined;
      if (row === undefined) continue;
      if (change.table === 'characters') {
        if (change.before !== undefined && change.after !== undefined && change.before.rig !== change.after.rig) {
          ids.add(change.id);
        }
      } else if (change.table === 'rigs') {
        ids.add(row['character'] as CharacterId);
      } else {
        const rig = store.getIncludingDeleted('rigs', row['rig'] as CharacterRecord['rig']);
        if (rig !== undefined) ids.add(rig.character);
      }
    }
    return ids;
  };

  /** Samplers of clips that a batch deleted. */
  const dropSamplers = (changes: readonly AnyChange[]): void => {
    for (const change of changes) {
      if (change.table !== 'clips') continue;
      const after = change.after as { readonly deleted: unknown; readonly character: CharacterId } | undefined;
      if (after !== undefined && after.deleted === null) continue;
      const before = change.before as { readonly character: CharacterId } | undefined;
      const owner = after?.character ?? before?.character;
      const entry = owner === undefined ? undefined : entries.get(owner);
      if (entry?.state === 'ready') entry.runtime.disposeSampler(change.id);
    }
  };

  const onBatch = (batch: ChangeBatch): void => {
    if (batch.origin === 'load') {
      for (const asset of sources.keys()) {
        if (!store.list('characters').some((character) => character.asset === asset)) sources.delete(asset);
      }
      sync('all');
      return;
    }
    // M-1: the batch's table set (one scan per batch for every listener) decides whether this batch matters here.
    if (batchTables(batch).has('clips')) dropSamplers(batch.changes);
    if (batchTouches(batch, STRUCTURAL_TABLES)) sync(recompileTargets(batch.changes));
  };

  sync('all');
  const unsubscribe = store.subscribe(onBatch);

  return {
    get: (id: CharacterId) => {
      const entry = entries.get(id);
      return entry?.state === 'ready' ? entry.runtime : undefined;
    },
    list: () => ordered,
    subscribe(listener: (e: CharacterEvent) => void): Disposer {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async settled(): Promise<void> {
      while (inFlight.size > 0) await Promise.allSettled(inFlight);
    },
    redisplay(id: CharacterId): Promise<void> {
      const entry = entries.get(id);
      return entry?.state === 'ready' ? loadDisplay(entry.runtime) : Promise.resolve();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const entry of entries.values()) if (entry.state === 'ready') entry.runtime.dispose();
      entries.clear();
      ordered = [];
      listeners.clear();
    },
  };
}
