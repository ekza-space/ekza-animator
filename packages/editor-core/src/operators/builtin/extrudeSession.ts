// The extrude session (M6A-SPEC §5.8, ADR 0016 D7; B12b), eager part: `app.extrude`'s shim, the operator runner's
// hooks and the Model tools' help-line channel.
//
// The session's logic (opening after an extrude, the end triggers and the zero-drop, the args undo stack, absorbing
// manipulator and W/E/R drags into the extrude's `local*` args, `T`'s reopen, smart extrude) is the lazy
// ./extrudeEngine.ts (§5.27: the eager route holds descriptors, registrations, keymap rows and shell code). It loads
// on the first Model entry, before an extrude can run there; an extrude that finishes before it has loaded opens its
// session once it has (the cap's frame then comes from the result). While no engine is loaded no session exists, so
// the shim answers `state: null`, `beginAbsorb → null`, `stepBack/stepForward → false`.
//
// The shim is created before the app exists (app/kernel.ts); the runner's hooks bind the app on its first run.
import type { Disposer } from '@ekza-animator/anim-core';
import type {
  AbsorbGesture,
  EditorApp,
  ExtrudeSessionApi,
  ExtrudeSessionState,
  OperatorDef,
  RunContext,
} from '../../types';
import type { AnyOperator } from './define';
import type * as ExtrudeEngineChunk from './extrudeEngine';

/** The session adds no operator ids: `edit.undo`/`edit.redo` and `edit.adjustLast` step its args stack. */
export const EXTRUDE_SESSION_OPERATORS: readonly AnyOperator[] = [];

// ---------- the lazy engine ----------

export type ExtrudeEngineModule = typeof ExtrudeEngineChunk;

let engineModule: ExtrudeEngineModule | null = null;
let engineLoad: Promise<ExtrudeEngineModule> | null = null;

/** Loads the engine chunk once (a failed load is retried by the next call). */
export function loadExtrudeEngine(): Promise<ExtrudeEngineModule> {
  if (engineLoad === null) {
    const load = import('./extrudeEngine').then((module) => {
      engineModule = module;
      return module;
    });
    engineLoad = load;
    load.catch(() => {
      if (engineLoad === load) engineLoad = null;
    });
  }
  return engineLoad;
}

/** The engine module once loaded, else null. */
export function extrudeEngineModule(): ExtrudeEngineModule | null {
  return engineModule;
}

/** What the engine implements for one app (the shim forwards to it). */
export interface ExtrudeEngine {
  readonly state: ExtrudeSessionState | null;
  beginAbsorb(tool: 'move' | 'rotate' | 'scale' | 'mmb', space: 'world' | 'object' | 'component'): AbsorbGesture | null;
  end(reason: string, opts: { readonly drop: boolean }): void;
  stepBack(): boolean;
  stepForward(): boolean;
  reopen(): boolean;
  setManipSpace(space: 'local' | 'world'): void;
  /** The runner's hook at the start of a run, after its first poll (§5.8: before the gesture reads the mesh). */
  beforeRun(def: OperatorDef<unknown, unknown, unknown>, args: unknown, ctx: RunContext | undefined): void;
  /** The runner's hook after a finished run (`stepId`: the step it recorded, null when none). */
  afterRun(def: OperatorDef<unknown, unknown, unknown>, ctx: RunContext | undefined, stepId: number | null): void;
}

/** What the engine reads and writes through (the shim's state and listeners). */
export interface ExtrudeEngineHost {
  readonly app: EditorApp;
  setState(next: ExtrudeSessionState | null): void;
}

/** `app.extrude` with its internal hooks (the public surface is `ExtrudeSessionApi`). */
export interface ExtrudeSessionShim extends ExtrudeSessionApi {
  /** The bound app, null before the runner's first run. */
  readonly app: EditorApp | null;
  /** The engine of the bound app once the chunk has loaded, else null. */
  engine(): ExtrudeEngine | null;
  subscribe(listener: (state: ExtrudeSessionState | null) => void): Disposer;
}

const shims = new WeakMap<ExtrudeSessionApi, { bind(app: EditorApp): void }>();

/** Binds the app to its extrude session (idempotent). */
export function bindExtrude(app: EditorApp): void {
  shims.get(app.extrude)?.bind(app);
}

export function createExtrudeSession(): ExtrudeSessionShim {
  let app: EditorApp | null = null;
  let state: ExtrudeSessionState | null = null;
  let engine: ExtrudeEngine | null = null;
  const listeners = new Set<(state: ExtrudeSessionState | null) => void>();

  const host = (bound: EditorApp): ExtrudeEngineHost => ({
    app: bound,
    setState(next) {
      if (next === state) return;
      state = next === null ? null : Object.freeze({ ...next });
      const model = bound.session.getState().model;
      if (model.extrudeSession !== state) bound.session.setState({ model: { ...model, extrudeSession: state } });
      for (const listener of Array.from(listeners)) listener(state);
    },
  });

  /** The engine once its chunk has loaded (created on first use), else null. */
  const engineNow = (): ExtrudeEngine | null => {
    if (engine === null && app !== null && engineModule !== null) engine = engineModule.createExtrudeEngine(host(app));
    return engine;
  };

  const shim: ExtrudeSessionShim = {
    get app() {
      return app;
    },
    get state() {
      return state;
    },
    engine: engineNow,
    beginAbsorb: (tool, space) => (state === null ? null : (engineNow()?.beginAbsorb(tool, space) ?? null)),
    end(reason, opts) {
      if (state !== null) engineNow()?.end(reason, opts);
    },
    stepBack: () => (state === null ? false : (engineNow()?.stepBack() ?? false)),
    stepForward: () => (state === null ? false : (engineNow()?.stepForward() ?? false)),
    reopen() {
      const now = engineNow();
      if (now !== null) return now.reopen();
      if (app === null) return false;
      // `T` before the chunk has loaded: reopen once it has, if nothing else happened meanwhile.
      const bound = app;
      const last = bound.session.getState().lastRun;
      void loadExtrudeEngine().then(
        () => {
          if (bound.session.getState().lastRun === last) engineNow()?.reopen();
        },
        () => {},
      );
      return false;
    },
    setManipSpace(space) {
      engineNow()?.setManipSpace(space);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  shims.set(shim, {
    bind(next: EditorApp): void {
      if (app === next) return;
      app = next;
      // The engine loads with the Model workspace, before an extrude can run there (§5.27).
      next.session.subscribe((session, previous) => {
        if (session.workspace === 'model' && previous.workspace !== 'model') void loadExtrudeEngine().catch(() => {});
      });
      if (next.session.getState().workspace === 'model') void loadExtrudeEngine().catch(() => {});
    },
  });
  return shim;
}

const shimOf = (app: EditorApp): ExtrudeSessionShim | null =>
  shims.has(app.extrude) ? (app.extrude as ExtrudeSessionShim) : null;

/**
 * The operator runner's hook at the start of every run, after its first poll and before `prepare` (§5.8 "What ends
 * the session": at the start of the ending gesture, before it reads the mesh).
 */
export function extrudeBeforeRun(
  app: EditorApp,
  def: OperatorDef<unknown, unknown, unknown>,
  args: unknown,
  ctx: RunContext | undefined,
): void {
  bindExtrude(app);
  const shim = shimOf(app);
  if (shim === null) return;
  const engine = shim.engine();
  if (engine !== null) engine.beforeRun(def, args, ctx);
  else if (def.id === 'mesh.extrude') void loadExtrudeEngine().catch(() => {});
}

/** The operator runner's hook after every finished run (`stepId`: the history step it recorded, null when none). */
export function extrudeAfterRun(
  app: EditorApp,
  def: OperatorDef<unknown, unknown, unknown>,
  ctx: RunContext | undefined,
  stepId: number | null,
): void {
  const shim = shimOf(app);
  if (shim === null) return;
  const engine = shim.engine();
  if (engine !== null) {
    engine.afterRun(def, ctx, stepId);
    return;
  }
  if (def.id !== 'mesh.extrude' || stepId === null) return;
  // The chunk has not loaded yet (an extrude before the first Model entry finished loading it): open the session once
  // it has, when the extrude is still the last operation.
  const last = app.session.getState().lastRun;
  void loadExtrudeEngine().then(
    () => {
      if (app.session.getState().lastRun === last) shim.engine()?.afterRun(def, ctx, stepId);
    },
    () => {},
  );
}

// ---------- the Model tools' help line ----------

/** A help-line message of a Model tool (the editor's capture bridge shows it). */
export interface ModelToolMessage {
  readonly text: string;
  readonly tone: 'info' | 'warning';
}

const helpListeners = new WeakMap<EditorApp, Set<(message: ModelToolMessage) => void>>();

/** Says `text` on the help line (Multi-Cut hints, "Extrude removed: it did not move", unmatched partners). */
export function sayModelHelp(app: EditorApp, text: string, tone: ModelToolMessage['tone'] = 'info'): void {
  for (const listener of Array.from(helpListeners.get(app) ?? [])) listener({ text, tone });
}

/** Listens to the Model tools' help-line messages. */
export function onModelHelp(app: EditorApp, listener: (message: ModelToolMessage) => void): Disposer {
  let set = helpListeners.get(app);
  if (set === undefined) {
    set = new Set();
    helpListeners.set(app, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}
