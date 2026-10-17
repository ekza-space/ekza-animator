// createFakeEditorApp (MVP-SPEC §7 WP-0b): a complete EditorApp for unit tests and the /dev/panels harness, built
// from the naive parts of the shared test kit. It never touches the stubbed production modules, so it works before
// WP-1/WP-2/WP-3/WP-7a land; it never imports Node APIs, so it runs in Vitest browser mode as well.
import type { Disposer } from '@ekza-animator/anim-core';
import type { CharacterId, DocSnapshot } from '@ekza-animator/doc';
import type { ExportProfileDef } from '@ekza-animator/io';
import type { SkeletonDesc } from '@ekza-animator/rig';
import { createStore } from 'zustand/vanilla';
import { MAYA_KEYMAP } from '../keymap/maya';
import type { OperatorMap } from '../operators/args';
import type {
  Contribution,
  EditorApp,
  EditorServices,
  ExporterDef,
  ImporterDef,
  MenuItemDef,
  OperatorResult,
  OperatorReturn,
  OperatorRunArgs,
  Prefs,
  RunContext,
  SessionState,
} from '../types';
import { createFakeCharacters } from './characters';
import { createCurveCompiler, createFakeEvaluation } from './evaluation';
import { createFakeHistory } from './history';
import { createFakeOperators } from './operators';
import { createFakePlayback } from './playback';
import { createKeymap, createRegistry, createToolRegistry } from './registries';
import { createFakeServices } from './services';
import { fakeDefaultPrefs, sessionForDocument } from './session';
import { createNaiveStore } from './store/naiveStore';

export interface FakeEditorApp extends EditorApp {
  readonly calls: readonly { readonly id: string; readonly args: unknown }[];
}

/**
 * A full EditorApp over a naive document store (strictPut on), naive curves and naive FK.
 *
 * - `snapshot` is loaded into the store; the first character becomes active and every character's first clip is its
 *   active clip.
 * - `skeleton` gives every character a runtime (rig program, pose buffers, samplers); without it there are no
 *   runtimes, but channel values and states still evaluate from the curves.
 * - `services` override the recording fakes of `createFakeServices()` (no model loader, validator or storage).
 * - No operators are registered: every `run` is recorded in `calls`, registered operators run through the §4.11.0
 *   runner, unknown ids resolve to `cancelled`.
 */
export function createFakeEditorApp(opts?: {
  readonly snapshot?: DocSnapshot;
  readonly skeleton?: SkeletonDesc;
  readonly services?: Partial<EditorServices>;
  readonly platform?: 'mac' | 'other';
}): FakeEditorApp {
  const platform = opts?.platform ?? 'other';
  const store = createNaiveStore();
  if (opts?.snapshot !== undefined) store.load(opts.snapshot);
  const services: EditorServices = { ...createFakeServices(), ...opts?.services };
  const session = createStore<SessionState>()(() => sessionForDocument(store));
  const prefs = createStore<Prefs>()(() => fakeDefaultPrefs(platform));
  const keymap = createKeymap(platform, MAYA_KEYMAP);
  const tools = createToolRegistry();
  const importers = createRegistry<ImporterDef>('Importer');
  const exporters = createRegistry<ExporterDef>('Exporter');
  const exportProfiles = createRegistry<ExportProfileDef>('Export profile');
  const menus = createRegistry<MenuItemDef>('Menu item');

  let frameRequester: () => void = () => {};
  const requestFrame = (): void => frameRequester();
  const compiler = createCurveCompiler(store);
  const characters = createFakeCharacters(store, opts?.skeleton ?? null, compiler);
  const evaluation = createFakeEvaluation({ store, session, characters, compiler, requestFrame });
  const clipFrameOf = (character: CharacterId) => {
    const clip = session.getState().activeClip[character];
    const frame = evaluation.clipFrame(character);
    return clip === undefined || frame === null ? null : { clip, frame };
  };
  const history = createFakeHistory({ store, session, now: Date.now, clipFrameOf });
  const playback = createFakePlayback(store, session);
  const operators = createFakeOperators({ app: () => app, store, session, history, clipFrameOf });

  const disposers: Disposer[] = [
    store.subscribe((batch) => {
      evaluation.invalidate();
      if (batch.origin === 'load') session.setState({ dirty: false });
      else if (batch.origin !== 'preview' && !session.getState().dirty) session.setState({ dirty: true });
    }),
    session.subscribe((state, previous) => {
      if (
        state.time.sceneFrame !== previous.time.sceneFrame ||
        state.activeClip !== previous.activeClip ||
        state.overrides !== previous.overrides
      ) {
        evaluation.invalidate();
      }
    }),
    characters.subscribe(() => evaluation.invalidate()),
  ];

  const app: FakeEditorApp = {
    store,
    session,
    prefs,
    operators: operators.registry,
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
    get calls() {
      return operators.calls;
    },
    run<K extends keyof OperatorMap>(id: K, ...rest: OperatorRunArgs<K>): Promise<OperatorResult<OperatorReturn<K>>> {
      const [args, ctx] = rest as readonly [unknown?, RunContext?];
      return operators.run(id, args, ctx) as Promise<OperatorResult<OperatorReturn<K>>>;
    },
    runUntyped: (id: string, args?: unknown, ctx?: RunContext) => operators.run(id, args, ctx),
    contribute(contribution: Contribution): Disposer {
      switch (contribution.kind) {
        case 'operator':
          return operators.registry.register(contribution.def);
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
      }
    },
    requestFrame,
    setFrameRequester(fn: () => void): void {
      frameRequester = fn;
    },
    dispose(): void {
      for (const dispose of disposers.splice(0).reverse()) dispose();
      characters.dispose();
      evaluation.dispose();
      compiler.dispose();
    },
  };
  return app;
}
