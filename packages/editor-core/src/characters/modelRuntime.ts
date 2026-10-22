// Runtimes of model-sourced characters (M6B-SPEC §5.1; C1, the lazy character-runtime chunk): the rig program is
// compiled from the records and `skeletonFromDoc` (never from the container), so Animate's controls, the Dope Sheet,
// the Graph Editor and the clip exports work as for imported characters; the display loads a container synthesized
// in memory (`synthesizeContainer`) through the shipped `ModelLoader`.
//
// - The `SkeletonDesc` is rebuilt (and the program recompiled) only when the character's joints, its skeleton record,
//   a mesh's binding (`MeshRecord.skin`: bind, unbind, a bound mesh created or deleted) or its rig record change
//   (`rig.autoRig.update` re-measures). Weight edits (strokes, table, utilities) never rebuild it and never recompile:
//   radii and support stay as measured at the last of those events.
// - A change of the rig's controls, constraints or solvers recompiles against the current SkeletonDesc.
// - The display container is rebuilt debounced after commits that change the character's joints, skin or meshes, at
//   once when the workspace leaves Rig & Skin or Model (`workflows/characterDisplay.ts`), and at once when the joint
//   hierarchy changed (the old display's nodes no longer match); the previous display stays until the new one is
//   ready. `CharacterRuntime.asset` is an in-memory pseudo-asset id (the container's SHA-256), never in `assets`.
// - In Model the display is hidden: mesh-view draws the character's meshes at bind pose there (§5.1 Display).
import type { Disposer } from '@ekza-studio/anim-core';
import {
  type AnyChange,
  type AssetId,
  type ChangeBatch,
  type CharacterId,
  type CharacterRecord,
  type ClipId,
  type MeshRecord,
} from '@ekza-studio/doc';
import { characterVertices, type GlbContainer, type SkeletonFromDocOptions, skeletonFromDoc } from '@ekza-studio/io';
import type { ChannelBuffer, ClipSampler, PoseBuffers, RigProgram, SkeletonDesc } from '@ekza-studio/rig';
import { loadMeshKernel, type MeshKernel } from '../mesh/kernel';
import type { CharacterEvent, CharacterRuntime, DisplayModel, EditorApp } from '../types';
import { loadWritePath } from '../workflows/export';
import { createCharacterDisplaySchedule } from '../workflows/characterDisplay';
import { EDITOR_VERSION } from '../workflows/samples';
import { type AssetMaterialCache, adoptedMaterials } from './assetMaterials';
import type { ModelHookContext } from './model';
import {
  characterMeshes,
  characterPalettes,
  docSkeletonInput,
  type ModelParts,
  meshesSettled,
  modelParts,
  modelProvenance,
} from './modelInput';
import type { KernelCharacters } from './registry';

type MeshIo = Awaited<ReturnType<Awaited<ReturnType<typeof loadWritePath>>['loadMeshIo']>>;

/** A model character's runtime: the shipped runtime shape with a skeleton and container that can be replaced. */
export class ModelRuntime implements CharacterRuntime {
  display: DisplayModel | null = null;
  /** How many times the SkeletonDesc was built (creation included; weight edits never bump it). */
  skeletonBuilds = 1;
  /** How many times the rig program was compiled (creation included). */
  compiles = 1;
  /** Bumps on every synthesized container (creation = 1). */
  containerVersion = 1;
  private currentProgram: RigProgram;
  private currentChannels: ChannelBuffer;
  private currentPose: PoseBuffers;
  private readonly samplers = new Map<ClipId, ClipSampler>();

  constructor(
    readonly id: CharacterId,
    public asset: AssetId,
    public container: GlbContainer,
    public skeleton: SkeletonDesc,
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

  /** Swaps in a program (and the skeleton it was compiled for): fresh buffers at rest, samplers rebuilt on demand. */
  setProgram(program: RigProgram, skeleton: SkeletonDesc = this.skeleton): void {
    this.disposeSamplers();
    this.skeleton = skeleton;
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

/** What a batch asks of one model character. */
interface Work {
  rebuild: boolean;
  recompile: boolean;
  container: boolean;
}

type Entry =
  | { readonly state: 'loading'; readonly token: number }
  | { readonly state: 'ready'; readonly runtime: ModelRuntime; readonly token: number }
  | { readonly state: 'idle' | 'failed'; readonly token: number };

const STRUCTURE_TABLES: ReadonlySet<string> = new Set([
  'characters',
  'skeletons',
  'joints',
  'meshes',
  'groups',
  'rigs',
  'controls',
  'constraints',
  'solvers',
  'palettes',
  'swatches',
]);

/** True for a live model-sourced character. */
function isModelCharacter(character: CharacterRecord): boolean {
  return character.deleted === null && character.source?.kind === 'model';
}

function skinKey(record: Partial<MeshRecord> | undefined): string {
  if (record === undefined || record.deleted !== null || record.skin === null || record.skin === undefined) return '';
  return 'skeleton' in record.skin ? `s:${record.skin.skeleton}` : '';
}

/** Joint names and parents of a SkeletonDesc (an old display's nodes match a new skeleton when these are equal). */
function hierarchyKey(skeleton: SkeletonDesc): string {
  return skeleton.nodes.map((node) => `${node.name}<${node.parent}`).join('|');
}

export function createModelCharacters(
  base: KernelCharacters,
  ctx: ModelHookContext,
  emit: (e: CharacterEvent) => void,
): KernelCharacters {
  const { store, deps } = ctx;
  const app = (): EditorApp | null => ctx.app?.() ?? null;
  const entries = new Map<CharacterId, Entry>();
  const inFlight = new Set<Promise<unknown>>();
  let libs: Promise<{ readonly kernel: MeshKernel; readonly meshIo: MeshIo }> | null = null;
  let tokens = 0;
  let ordered: readonly CharacterRuntime[] | null = null;
  let disposed = false;
  const materialCache: AssetMaterialCache = new Map();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    void promise.then(
      () => inFlight.delete(promise),
      () => inFlight.delete(promise),
    );
    return promise;
  };

  const loadLibs = (): Promise<{ readonly kernel: MeshKernel; readonly meshIo: MeshIo }> => {
    libs ??= Promise.all([loadMeshKernel(), loadWritePath().then((write) => write.loadMeshIo())]).then(
      ([kernel, meshIo]) => ({ kernel, meshIo }),
    );
    return libs;
  };

  const fail = (id: CharacterId, error: unknown): void => {
    entries.set(id, { state: 'failed', token: ++tokens });
    const name = store.get('characters', id)?.name ?? id;
    const message = error instanceof Error ? error.message : String(error);
    ctx.notify.toast({ kind: 'error', text: `Could not build "${name}": ${message}` });
  };

  /** The SkeletonDesc of the parts, measured on the writer's vertex layout (§5.1 equality with the written file). */
  const describe = (kernel: MeshKernel, meshIo: MeshIo, parts: ModelParts): SkeletonDesc => {
    const view = store;
    const meshes = characterMeshes(view, kernel, parts).filter((mesh) => mesh.skin !== null);
    const options: SkeletonFromDocOptions = {
      vertices: characterVertices(meshIo, meshes, characterPalettes(view, meshes)),
    };
    return skeletonFromDoc(docSkeletonInput(view, kernel, parts), options);
  };

  /** The display container (the writer comes with the write path, so glTF Transform loads once for both). */
  const containerOf = async (kernel: MeshKernel, parts: ModelParts, skeleton: SkeletonDesc): Promise<GlbContainer> => {
    const write = await loadWritePath();
    // An imported textured model shows its texture (AR-D8-1): the writer copies the adopted asset materials.
    const a = app();
    const adopted = a === null ? [] : await adoptedMaterials(a, write, parts.meshes, materialCache);
    const meshes = characterMeshes(store, kernel, parts).map((mesh, i) => {
      const assetMaterials = adopted[i];
      return assetMaterials === undefined ? mesh : { ...mesh, assetMaterials };
    });
    return write.synthesizeContainer({
      skeleton,
      joints: parts.joints,
      meshes,
      palettes: characterPalettes(store, meshes),
      clips: [],
      vrm: null,
      thumbnailPng: null,
      model: modelProvenance(parts, skeleton, EDITOR_VERSION),
      heightScale: null,
    });
  };

  /** Parts once every mesh of the character is resident (null: no skeleton or no app). */
  const partsOf = async (id: CharacterId): Promise<ModelParts | null> => {
    const a = app();
    if (a === null) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = modelParts(a, id);
      if (parts !== 'loading') return parts;
      await meshesSettled(a, id);
    }
    const parts = modelParts(a, id);
    return parts === 'loading' ? null : parts;
  };

  const workspace = (): string | null => app()?.session.getState().workspace ?? null;

  /** In Model mesh-view draws the meshes at bind pose: the posed display is hidden there. */
  const applyVisibility = (runtime: ModelRuntime): void => {
    const root = (runtime.display?.handle as { root?: { visible: boolean } } | undefined)?.root;
    if (root !== undefined) root.visible = workspace() !== 'model';
  };

  const displayLoads = new WeakMap<ModelRuntime, number>();
  const loadDisplay = (runtime: ModelRuntime): Promise<void> => {
    const models = ctx.models;
    if (models === null) return Promise.resolve();
    const generation = (displayLoads.get(runtime) ?? 0) + 1;
    displayLoads.set(runtime, generation);
    return track(
      models.load(runtime.container, runtime.skeleton).then(
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
          applyVisibility(runtime);
          emit({ type: 'display', id: runtime.id });
        },
        (error: unknown) => {
          if (disposed) return;
          const message = error instanceof Error ? error.message : String(error);
          ctx.notify.toast({ kind: 'warning', text: `The model of a character could not be displayed: ${message}` });
        },
      ),
    );
  };

  /** Builds the runtime of a live model character (idle without a skeleton or rig records). */
  const start = (id: CharacterId): void => {
    const token = ++tokens;
    entries.set(id, { state: 'loading', token });
    const current = (): boolean => entries.get(id)?.token === token && !disposed;
    void track(
      (async () => {
        const { kernel, meshIo } = await loadLibs();
        const parts = await partsOf(id);
        if (!current()) return;
        const character = store.get('characters', id);
        const def = character === undefined ? undefined : deps.rig.readRigDefinition(store, character.rig);
        if (parts === null || def === undefined) {
          entries.set(id, { state: 'idle', token });
          return;
        }
        const skeleton = describe(kernel, meshIo, parts);
        const program = deps.rig.compileRig(def, skeleton);
        const container = await containerOf(kernel, parts, skeleton);
        if (!current()) return;
        const runtime = new ModelRuntime(id, container.sha256 as AssetId, container, skeleton, program, (clip, p) =>
          deps.rig.createClipSampler(store, ctx.cache, clip, p),
        );
        entries.set(id, { state: 'ready', runtime, token });
        ordered = null;
        emit({ type: 'added', id });
        void loadDisplay(runtime);
      })().catch((error: unknown) => {
        if (current()) fail(id, error);
      }),
    );
  };

  const remove = (id: CharacterId): void => {
    const entry = entries.get(id);
    entries.delete(id);
    if (entry?.state !== 'ready') return;
    entry.runtime.dispose();
    ordered = null;
    emit({ type: 'removed', id });
  };

  /** Rebuilds the display container now (the previous display stays until the new one is ready). */
  const rebuildContainer = async (id: CharacterId): Promise<void> => {
    const entry = entries.get(id);
    if (entry?.state !== 'ready') return;
    const runtime = entry.runtime;
    const { kernel } = await loadLibs();
    const parts = await partsOf(id);
    if (parts === null || entries.get(id) !== entry) return;
    const skeleton = runtime.skeleton;
    const container = await containerOf(kernel, parts, skeleton);
    if (disposed || entries.get(id) !== entry || runtime.skeleton !== skeleton) return;
    runtime.container = container;
    runtime.asset = container.sha256 as AssetId;
    runtime.containerVersion++;
    await loadDisplay(runtime);
  };

  const schedule = createCharacterDisplaySchedule({
    session: app()?.session ?? null,
    rebuild: (id) => track(rebuildContainer(id)),
  });

  /** Rebuilds the SkeletonDesc and recompiles (synchronously when every mesh is resident). */
  const rebuild = (id: CharacterId, entry: Extract<Entry, { state: 'ready' }>): void => {
    const run = (kernel: MeshKernel, meshIo: MeshIo, parts: ModelParts | null): void => {
      if (entries.get(id) !== entry) return;
      const character = store.get('characters', id);
      const def = character === undefined ? undefined : deps.rig.readRigDefinition(store, character.rig);
      if (parts === null || def === undefined) {
        remove(id);
        entries.set(id, { state: 'idle', token: ++tokens });
        return;
      }
      const runtime = entry.runtime;
      const before = hierarchyKey(runtime.skeleton);
      try {
        const skeleton = describe(kernel, meshIo, parts);
        runtime.setProgram(deps.rig.compileRig(def, skeleton), skeleton);
      } catch (error) {
        remove(id);
        fail(id, error);
        return;
      }
      runtime.skeletonBuilds++;
      runtime.compiles++;
      emit({ type: 'recompiled', id });
      // An old display whose nodes no longer match the skeleton is replaced at once; else on idle.
      if (hierarchyKey(runtime.skeleton) !== before) void track(rebuildContainer(id));
      else schedule.mark(id);
    };
    const kernel = libsNow?.kernel;
    const meshIo = libsNow?.meshIo;
    const a = app();
    const parts = a === null ? null : modelParts(a, id);
    if (kernel !== undefined && meshIo !== undefined && parts !== 'loading') {
      run(kernel, meshIo, parts);
      return;
    }
    void track(
      (async () => {
        const loaded = await loadLibs();
        run(loaded.kernel, loaded.meshIo, await partsOf(id));
      })(),
    );
  };

  const recompile = (id: CharacterId, entry: Extract<Entry, { state: 'ready' }>): void => {
    const character = store.get('characters', id);
    const def = character === undefined ? undefined : deps.rig.readRigDefinition(store, character.rig);
    if (def === undefined) {
      remove(id);
      entries.set(id, { state: 'idle', token: ++tokens });
      return;
    }
    try {
      entry.runtime.setProgram(deps.rig.compileRig(def, entry.runtime.skeleton));
    } catch (error) {
      remove(id);
      fail(id, error);
      return;
    }
    entry.runtime.compiles++;
    emit({ type: 'recompiled', id });
  };

  let libsNow: { readonly kernel: MeshKernel; readonly meshIo: MeshIo } | null = null;
  void loadLibs().then(
    (loaded) => {
      libsNow = loaded;
    },
    () => {
      libs = null;
    },
  );

  /** What a batch asks of each model character. */
  const workOf = (changes: readonly AnyChange[]): Map<CharacterId, Work> => {
    const out = new Map<CharacterId, Work>();
    const live = store.list('characters').filter(isModelCharacter);
    if (live.length === 0) return out;
    const of = (id: CharacterId): Work => {
      let work = out.get(id);
      if (work === undefined) {
        work = { rebuild: false, recompile: false, container: false };
        out.set(id, work);
      }
      return work;
    };
    const bySkeleton = new Map<string, CharacterId>();
    const byRig = new Map<string, CharacterId>();
    for (const character of live) {
      if (character.source.kind === 'model') bySkeleton.set(character.source.skeleton, character.id);
      byRig.set(character.rig, character.id);
    }
    for (const change of changes) {
      const before = change.before as Readonly<Record<string, unknown>> | undefined;
      const after = change.after as Readonly<Record<string, unknown>> | undefined;
      const row = after ?? before;
      if (row === undefined) continue;
      const table = change.table;
      if (table === 'characters') {
        if (before !== undefined && after !== undefined && before['rig'] !== after['rig']) of(change.id).rebuild = true;
      } else if (table === 'skeletons') {
        const owner = bySkeleton.get(change.id) ?? (row['character'] as CharacterId | undefined);
        if (owner !== undefined) of(owner).rebuild = true;
      } else if (table === 'joints') {
        const owner = bySkeleton.get(row['skeleton'] as string);
        if (owner !== undefined) of(owner).rebuild = true;
      } else if (table === 'meshes') {
        const changedSkin = skinKey(before) !== skinKey(after);
        for (const record of [before, after]) {
          const owner = record?.['owner'] as { readonly character?: CharacterId } | undefined;
          if (owner?.character === undefined) continue;
          const work = of(owner.character);
          work.container = true;
          if (changedSkin) work.rebuild = true;
        }
      } else if (table === 'groups') {
        const owner = row['owner'] as { readonly character?: CharacterId } | undefined;
        if (owner?.character !== undefined) of(owner.character).container = true;
      } else if (table === 'rigs') {
        const owner = byRig.get(change.id);
        if (owner !== undefined) of(owner).rebuild = true;
      } else if (table === 'controls' || table === 'constraints' || table === 'solvers') {
        const owner = byRig.get(row['rig'] as string);
        if (owner !== undefined) of(owner).recompile = true;
      } else if (table === 'palettes' || table === 'swatches') {
        for (const character of live) of(character.id).container = true;
      }
    }
    return out;
  };

  const sync = (batch: ChangeBatch | null): void => {
    const live = new Map(
      store
        .list('characters')
        .filter(isModelCharacter)
        .map((character) => [character.id, character]),
    );
    for (const id of entries.keys()) if (!live.has(id)) remove(id);
    const work = batch === null ? null : workOf(batch.changes);
    for (const id of live.keys()) {
      const entry = entries.get(id);
      if (entry === undefined || entry.state === 'failed' || (entry.state === 'idle' && work?.has(id) === true)) {
        if (entry?.state === 'failed' && batch !== null) continue;
        start(id);
        continue;
      }
      if (entry.state !== 'ready') {
        // A build in flight reads the document when it resumes; a structural change restarts it.
        if (batch === null || work?.get(id)?.rebuild === true || work?.get(id)?.recompile === true) start(id);
        continue;
      }
      const todo = work === null ? { rebuild: true, recompile: true, container: true } : work.get(id);
      if (todo === undefined) continue;
      if (todo.rebuild) rebuild(id, entry);
      else if (todo.recompile) recompile(id, entry);
      if (todo.container && !todo.rebuild) schedule.mark(id);
    }
    if (live.size !== entries.size) ordered = null;
  };

  const onBatch = (batch: ChangeBatch): void => {
    if (disposed) return;
    if (batch.origin === 'load') {
      sync(null);
      return;
    }
    let relevant = false;
    for (const change of batch.changes) {
      if (STRUCTURE_TABLES.has(change.table)) {
        relevant = true;
        break;
      }
    }
    if (relevant) sync(batch);
  };

  /** Samplers of deleted clips (as the shipped registry drops them). */
  const dropSamplers = (batch: ChangeBatch): void => {
    for (const change of batch.changes) {
      if (change.table !== 'clips') continue;
      const after = change.after as { readonly deleted: unknown; readonly character: CharacterId } | undefined;
      if (after !== undefined && after.deleted === null) continue;
      const before = change.before as { readonly character: CharacterId } | undefined;
      const owner = after?.character ?? before?.character;
      const entry = owner === undefined ? undefined : entries.get(owner);
      if (entry?.state === 'ready') entry.runtime.disposeSampler(change.id);
    }
  };

  const disposers: Disposer[] = [
    store.subscribe((batch) => {
      dropSamplers(batch);
      onBatch(batch);
    }),
  ];
  const session = app()?.session;
  if (session !== undefined) {
    disposers.push(
      session.subscribe((state, previous) => {
        if (state.workspace === previous.workspace) return;
        for (const entry of entries.values()) if (entry.state === 'ready') applyVisibility(entry.runtime);
      }),
    );
  }
  sync(null);

  const list = (): readonly CharacterRuntime[] => {
    if (ordered !== null) return ordered;
    const byId = new Map<string, CharacterRuntime>();
    for (const runtime of base.list()) byId.set(runtime.id, runtime);
    for (const [id, entry] of entries) if (entry.state === 'ready') byId.set(id, entry.runtime);
    const characters = [...store.list('characters')].sort((a, b) =>
      a.order === b.order ? (a.id < b.id ? -1 : 1) : a.order < b.order ? -1 : 1,
    );
    ordered = characters.flatMap((character) => {
      const runtime = byId.get(character.id);
      return runtime === undefined ? [] : [runtime];
    });
    return ordered;
  };
  // The base registry's order changes with its own events.
  disposers.push(
    base.subscribe(() => {
      ordered = null;
    }),
  );

  return {
    get(id: CharacterId): CharacterRuntime | undefined {
      const entry = entries.get(id);
      return entry?.state === 'ready' ? entry.runtime : base.get(id);
    },
    list,
    subscribe: (listener) => base.subscribe(listener),
    async settled(): Promise<void> {
      await base.settled();
      while (inFlight.size > 0) await Promise.allSettled(inFlight);
    },
    redisplay(id: CharacterId): Promise<void> {
      const entry = entries.get(id);
      if (entry === undefined) return base.redisplay(id);
      return track(rebuildContainer(id));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      schedule.dispose();
      for (const dispose of disposers.splice(0)) dispose();
      for (const entry of entries.values()) if (entry.state === 'ready') entry.runtime.dispose();
      entries.clear();
      base.dispose();
    },
  };
}
