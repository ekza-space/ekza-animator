// The composition root of the editor kernel: builds an `EditorApp` from a document store, host services and the
// sibling-package bindings (`KernelDeps`), and wires the parts together:
//
//   store batches ──► session keeper (repair, dirty, override lifetime) ─► history capture (doc entries → steps)
//                 └─► character registry (runtimes) ─► evaluation (dirty characters) ─► requestFrame
//   session time  ──► keeper (drop overrides of moved characters) ─► evaluation ─► requestFrame
//   prefs         ──► storage (persisted) ─► keymap (user overrides, Space behaviour)
import type { Disposer } from '@ekza-animator/anim-core';
import type { AnyChange, CharacterId, ChangeBatch, DocumentStore, IdSource } from '@ekza-animator/doc';
import { setDefaultIdSource } from '@ekza-animator/doc';
import type { ExportProfileDef } from '@ekza-animator/io';
import { createStore } from 'zustand/vanilla';
import { gateModelLoader } from '../characters/models';
import { createCharacterRegistry } from '../characters/registry';
import { createEvaluationService } from '../evaluation/service';
import { createDocCapture, type DocCapture } from '../history/capture';
import { createEditorHistory } from '../history/history';
import { createKeymapManager, preferenceBindings } from '../keymap/manager';
import type { OperatorMap } from '../operators/args';
import { registerBuiltins } from '../operators/builtin';
import { pruneCurveBuffers } from '../operators/builtin/graphBuffer';
import { createOperatorRegistry } from '../operators/registry';
import { createOperatorRunner } from '../operators/runner';
import { createPlaybackClock } from '../playback/clock';
import { defaultPrefs } from '../prefs/defaults';
import { loadPrefs, savePrefs } from '../prefs/persist';
import { createRegistry } from '../registries/registry';
import { defaultSession } from '../session/defaults';
import { createSessionKeeper } from '../session/keeper';
import { activeLocation, locateCharacter } from '../session/location';
import { repairSession, templateSymmetry } from '../session/repair';
import { restoreSelection, restoreSelectionPart } from '../session/selection';
import { createToolRegistry } from '../tools/registry';
import type {
  Contribution,
  EditorApp,
  EditorServices,
  ExporterDef,
  ImporterDef,
  KeyBinding,
  MarkingMenuDef,
  MenuItemDef,
  OperatorResult,
  OperatorReturn,
  OperatorRunArgs,
  Prefs,
  RunContext,
  SessionState,
  WorkspaceDef,
} from '../types';
import type { KernelDeps } from './deps';
import { createCapture } from './factories/capture';
import { createComponents } from './factories/components';
import { createExtrude } from './factories/extrude';
import { createBlobs, createMeshes } from './factories/meshes';
import { bindInternals } from './internals';
import { createMeshDisplay } from '../workflows/meshDisplay';

export interface KernelOptions {
  readonly services: EditorServices;
  readonly store?: DocumentStore;
  readonly platform?: 'mac' | 'other';
  readonly idSource?: IdSource;
  /** Default true: `registerBuiltins` (WP-7b). */
  readonly builtins?: boolean;
  /** Defaults to apply before stored preferences (the test kit marks the first run done). */
  readonly prefDefaults?: Partial<Prefs>;
  /** Called for every `run`/`runUntyped` before the runner (the test kit records calls). */
  readonly onRun?: (id: string, args: unknown) => void;
  /** Clock for history coalescing; default `Date.now`. */
  readonly now?: () => number;
}

export function createKernelApp(opts: KernelOptions, deps: KernelDeps): EditorApp {
  const platform = opts.platform ?? 'other';
  const store = opts.store ?? deps.createStore();
  const now = opts.now ?? Date.now;
  const idSource = opts.idSource ?? null;
  if (idSource !== null) setDefaultIdSource(idSource);
  const disposers: Disposer[] = [];
  // M2A-SPEC §5.3: the built-in rig ops (ik2, A1) are registered before the first rig compiles.
  const disposeRigOps = deps.rig.registerBuiltinRigOps?.() ?? null;

  let frameRequester: () => void = () => {};
  /** False until a host installs a frame requester: then `scheduleBeforeFrame` runs tasks synchronously (Node). */
  let hasFrameRequester = false;
  const requestFrame = (): void => frameRequester();

  // ---------- tasks before the next frame (M2A-SPEC §4.5, M-1 mechanism 1) ----------
  // Keyed: a later task with the same key replaces the pending one (keeps its place in the order). The frame loop
  // runs them first (`flushScheduled`), so pointer moves coalesce to one preview update per animation frame.
  const scheduled = new Map<string, () => void>();
  const flushScheduled = (): void => {
    let failure: { readonly error: unknown } | null = null;
    // Tasks may schedule further tasks; those run in the same flush (bounded, so a task that reschedules itself
    // forever cannot hang the frame).
    for (let guard = 0; scheduled.size > 0 && guard < 10_000; guard++) {
      const [key, task] = scheduled.entries().next().value as [string, () => void];
      scheduled.delete(key);
      try {
        task();
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== null) throw failure.error;
  };
  const scheduleBeforeFrame = (key: string, task: () => void): void => {
    if (!hasFrameRequester) {
      scheduled.delete(key);
      task();
      return;
    }
    scheduled.set(key, task);
    requestFrame();
  };

  // ---------- state ----------
  const initial = defaultSession(store.user);
  const session = createStore<SessionState>()(() => ({ ...initial, ...repairSession(store, initial, 'open') }));
  const prefs = createStore<Prefs>()(() =>
    loadPrefs(opts.services.storage, { ...defaultPrefs(platform), ...opts.prefDefaults }),
  );

  // ---------- services and registries ----------
  const services: EditorServices = {
    ...opts.services,
    models: opts.services.models === null ? null : gateModelLoader(opts.services.models),
  };
  let syncingOverrides = false;
  const keymap = createKeymapManager(platform, {
    onOverrides: (bindings: readonly KeyBinding[]) => {
      if (!syncingOverrides) prefs.setState({ keymapOverrides: bindings });
    },
  });
  const applyKeymapPrefs = (p: Prefs): void => {
    syncingOverrides = true;
    try {
      keymap.setOverrides(p.keymapOverrides);
    } finally {
      syncingOverrides = false;
    }
    keymap.setPreferenceBindings(preferenceBindings(p.spaceBehaviour));
  };
  applyKeymapPrefs(prefs.getState());
  const tools = createToolRegistry();
  const importers = createRegistry<ImporterDef>('Importer');
  const exporters = createRegistry<ExporterDef>('Exporter');
  const exportProfiles = createRegistry<ExportProfileDef>('Export profile');
  const menus = createRegistry<MenuItemDef>('Menu item');
  // M6a (M6A-SPEC §4.6, §9.1): workspaces, marking menus and the modeling services, one factory file each.
  const workspaces = createRegistry<WorkspaceDef>('Workspace');
  const markingMenus = createRegistry<MarkingMenuDef>('Marking menu');
  const blobs = createBlobs(services);
  const meshes = createMeshes({ store, blobs, services, requestFrame });
  const components = createComponents({ session, meshes: () => meshes });
  const numericCapture = createCapture();
  const extrude = createExtrude();

  // ---------- characters and evaluation ----------
  const cache = deps.rig.createCurveCache(store, deps.curves.engine);
  // M6a (§5.23, B8): characters with edited meshes display a container rebuilt from their latest revisions.
  const meshDisplay = createMeshDisplay({
    store,
    session,
    app: () => app,
    redisplay: (character) => characters.redisplay(character),
  });
  const characters = createCharacterRegistry({
    store,
    deps,
    cache,
    assets: services.assets,
    notify: services.notify,
    models: services.models,
    display: meshDisplay,
  });
  const evaluation = createEvaluationService({ store, session, characters, deps, cache, requestFrame });
  const playback = createPlaybackClock({ store, session, deps, requestFrame });

  // ---------- history and operators ----------
  // The closures below reference `app` (defined at the end) and only run after construction.
  let capture: DocCapture | null = null;
  const history = createEditorHistory({
    store,
    session,
    now,
    locate: (character: CharacterId) => locateCharacter(app, character),
    restoreSelection: (snapshot: unknown) => restoreSelection(app, snapshot),
    restoreSelectionPart: (part, side) => restoreSelectionPart(app, part, side),
    reconcile: () => capture?.reconcile(),
    navigated: () => capture?.sync(),
  });
  capture = createDocCapture(store, () => history);
  const operators = createOperatorRegistry(() => app);
  const runner = createOperatorRunner({
    app: () => app,
    registry: operators,
    store,
    session,
    history,
    capture,
    location: () => activeLocation(app),
  });
  const keeper = createSessionKeeper({
    store,
    session,
    deps,
    history,
    evaluation,
    symmetryTolerance: () => prefs.getState().modeling.symmetryTolerance,
  });
  {
    // An app opened on a stored document: template meshes take their Object X symmetry (acceptance fix round 1).
    const model = session.getState().model;
    const next = templateSymmetry(store, model, prefs.getState().modeling.symmetryTolerance);
    if (next !== model) session.setState({ model: next });
  }

  // ---------- wiring ----------
  /** Characters whose pose a document batch changes (null: all of them). */
  const affectedCharacters = (batch: ChangeBatch): Set<CharacterId> | null => {
    if (batch.origin === 'load') return null;
    const byClip = new Map<string, CharacterId>();
    for (const [character, clip] of Object.entries(session.getState().activeClip)) {
      byClip.set(clip, character as CharacterId);
    }
    const ids = new Set<CharacterId>();
    // M-1: a drag batch is 1,000 key changes of one clip; each clip is looked up once per run.
    let lastClip: unknown = null;
    const changes = batch.changes;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i] as AnyChange;
      const row = (change.after ?? change.before) as Readonly<Record<string, unknown>> | undefined;
      if (row === undefined) continue;
      if (change.table === 'project') return null;
      if (change.table === 'keys' || change.table === 'curves' || change.table === 'layers') {
        const clip = row['clip'];
        if (clip === lastClip) continue;
        lastClip = clip;
        const owner = byClip.get(clip as string);
        if (owner !== undefined) ids.add(owner);
      } else if (change.table === 'clips') {
        const owner = byClip.get(change.id);
        if (owner !== undefined) ids.add(owner);
      }
    }
    return ids;
  };
  /** M2A-SPEC §5.15.1: deleting a curve drops its buffer (loads, undo and remote deletes included). */
  const dropsCurves = (batch: ChangeBatch): boolean => {
    if (batch.origin === 'load') return true;
    for (const change of batch.changes) {
      if (change.table !== 'curves') continue;
      if (change.after === undefined || change.after.deleted !== null) return true;
    }
    return false;
  };
  disposers.push(
    store.subscribe((batch) => {
      const ids = affectedCharacters(batch);
      if (ids === null) evaluation.invalidate();
      else if (ids.size > 0) evaluation.invalidate(ids);
      if (session.getState().curveBuffers.size > 0 && dropsCurves(batch)) pruneCurveBuffers(app);
    }),
    session.subscribe((state, previous) => {
      if (state.overrides !== previous.overrides) {
        const ids = new Set<CharacterId>();
        for (const control of new Set([...state.overrides.keys(), ...previous.overrides.keys()])) {
          if (state.overrides.get(control) === previous.overrides.get(control)) continue;
          const owner = evaluation.characterOf(control);
          if (owner !== null) ids.add(owner);
        }
        evaluation.invalidate(ids);
      } else if (
        state.time.sceneFrame !== previous.time.sceneFrame ||
        state.activeClip !== previous.activeClip ||
        (state.time.playing && !previous.time.playing)
      ) {
        // Evaluation notices the new clip frames by itself; the frame loop only has to run.
        requestFrame();
      }
    }),
    characters.subscribe((event) => {
      if (event.type === 'added' || event.type === 'recompiled') evaluation.invalidate([event.id]);
      else requestFrame();
    }),
    prefs.subscribe((next, previous) => {
      savePrefs(services.storage, next);
      if (next.keymapOverrides !== previous.keymapOverrides || next.spaceBehaviour !== previous.spaceBehaviour) {
        applyKeymapPrefs(next);
      }
    }),
  );

  const run = (id: string, args: unknown, ctx: RunContext | undefined): Promise<OperatorResult<unknown>> => {
    opts.onRun?.(id, args);
    return runner.run(id, args, ctx);
  };

  let disposed = false;
  const app: EditorApp = {
    store,
    session,
    prefs,
    operators,
    tools,
    keymap,
    importers,
    exporters,
    exportProfiles,
    menus,
    characters,
    evaluation,
    playback,
    history,
    services,
    workspaces,
    markingMenus,
    meshes,
    components,
    extrude,
    capture: numericCapture,
    blobs,
    run<K extends keyof OperatorMap>(id: K, ...rest: OperatorRunArgs<K>): Promise<OperatorResult<OperatorReturn<K>>> {
      const [args, ctx] = rest as readonly [unknown?, RunContext?];
      return run(id, args, ctx) as Promise<OperatorResult<OperatorReturn<K>>>;
    },
    runUntyped: (id: string, args?: unknown, ctx?: RunContext) => run(id, args, ctx),
    contribute(contribution: Contribution): Disposer {
      switch (contribution.kind) {
        case 'operator':
          return operators.register(contribution.def);
        case 'tool':
          return tools.register(contribution.def);
        case 'keymap':
          return keymap.add(contribution.bindings);
        case 'importer':
          return importers.register(contribution.def);
        case 'exporter':
          return exporters.register(contribution.def);
        case 'exportProfile':
          return exportProfiles.register(contribution.def);
        case 'menu':
          return menus.register(contribution.def);
        case 'workspace':
          return workspaces.register(contribution.def);
        case 'markingMenu':
          return markingMenus.register(contribution.def);
      }
    },
    requestFrame,
    setFrameRequester(fn: () => void): void {
      frameRequester = fn;
      hasFrameRequester = true;
    },
    scheduleBeforeFrame,
    flushScheduled,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scheduled.clear();
      for (const dispose of disposers.splice(0).reverse()) dispose();
      keeper.dispose();
      capture?.dispose();
      history.dispose();
      meshes.dispose();
      meshDisplay.dispose();
      characters.dispose();
      evaluation.dispose();
      cache.dispose();
      disposeRigOps?.();
      frameRequester = () => {};
      hasFrameRequester = false;
      if (idSource !== null) setDefaultIdSource(null);
    },
  };
  bindInternals(app, { deps, capture, idSource });
  if (opts.builtins !== false) disposers.push(registerBuiltins(app));
  return app;
}
