// Adjust Last Operation, Repeat Last and the last tool (M6A-SPEC §5.7, ADR 0016 D6; B11): the `LastRun` recorder the
// operator runner calls after every finished run, the per-app state, the polls, and the operators `tool.last` (`Y`)
// and `view.lastOpCard` (`T`). `edit.adjustLast` and `edit.repeatLast` live in ./edit.ts and use the helpers below.
//
// The eager route (§5.27) holds only this part. The tracker that closes the Last-op card (§5.7's table), the adjust
// engine and the card preview (./lastopEngine.ts) and the capture window's state machine (../../edit/captureEngine.ts)
// are the **B11 runtime chunk**: `loadOpsRuntime()` loads it on the first Model entry (the capture binding watches the
// workspace), when a LastRun is recorded, when the capture window arms and when Adjust Last runs.
//
// What is recorded (`session.lastRun`): the last undoable run that finished and recorded a history step, of an
// operator that declares `params` (`[]` allowed) or is flagged adjustable or repeatable, and is not a selection
// gesture. Args are the **resolved** args (the kernel's `OpResult.resolvedArgs` for mesh ops, the runner's coercion
// otherwise; the pass-through `meshes`/`kind` are kept apart as `targets`/`kind`), with the component kind the run
// read, the step, the store version, the pane, the run source, the flags, the targets, the step seed and the
// symmetry/soft context. An adjusted re-run (`edit.adjustLast`) keeps the recorded source, pane, tool, seed, context,
// kind and targets: it is the same operation with new values.
import { EkzaError, type ParamDef, type ParamValue, type ParamValues } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import type { ComponentKind, OpWarning } from '@ekza-studio/mesh-core';
import { openLastOpCard, resetLastOpCard } from '../../edit/capture';
import type * as CaptureEngineModule from '../../edit/captureEngine';
import type { KernelHistory } from '../../history/history';
import { runSeedOf } from '../../mesh/seed';
import type {
  EditorApp,
  LastRun,
  OperatorContext,
  OperatorDef,
  RunContext,
  SessionState,
  SymmetrySettings,
} from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK, runContextOf } from './define';
import type * as LastopEngineModule from './lastopEngine';
import { WHOLE_MESH_OPS } from './mesh/whole';
import { modelOperators } from './modelOps';

// ---------- reasons (§5.7 table) ----------

export const LAST_RUN_CLOSED = {
  another: 'Another operation ran',
  selection: 'Selection changed',
  undone: 'Undone',
  workspace: 'Workspace changed',
  remote: 'Changed by another user',
  settings: 'Settings changed',
  project: 'The project changed',
} as const;

/** Help-line text of `T` and `edit.adjustLast` without a live last operation (§5.7). */
export const NO_OPERATION_TO_ADJUST = 'No operation to adjust';
/** Poll reason of `edit.repeatLast` before anything ran. */
export const NOTHING_TO_REPEAT = 'Nothing to repeat';

/** Arg keys every mesh operator passes through (`MESH_EXTRA_ARGS`); recorded as `targets`/`kind`, not as args. */
const TARGET_KEYS: ReadonlySet<string> = new Set(['meshes', 'kind']);

// ---------- per-app state ----------

export interface LastRunState {
  attached: boolean;
  /** >0 while `edit.adjustLast` undoes and re-runs: the tracker ignores what that does. */
  suspended: number;
  /** The operator id `edit.adjustLast` is re-running (the runner labels its step "<label> (adjusted)"). */
  adjusting: string | null;
  /** What the tracker compares against (taken when lastRun is recorded or refreshed). */
  componentsVersion: number;
  navigations: number;
  /** Warnings of the recorded run (`lastOp().warnings`, the card's message line). */
  warnings: readonly OpWarning[];
  /** The recorded LastRun the warnings belong to. */
  warningsOf: LastRun | null;
  /** The adjust in flight (edit.undo waits for it, so undo and adjust never interleave). */
  pending: Promise<unknown> | null;
  /** Refusal of the last adjusted re-run (edit.adjustLast's second poll reports it). */
  refusal: string | null;
  /**
   * The card preview in progress (§5.7 card drags): it re-shows the pre-op mesh with new values, which the component
   * selection service follows and publishes; that is the card's own preview, not a selection change.
   */
  preview: { readonly active: boolean } | null;
}

const states = new WeakMap<EditorApp, LastRunState>();

/** The per-app LastRun state (shared with the lazy engine, ./lastopEngine.ts). */
export function lastRunState(app: EditorApp): LastRunState {
  let state = states.get(app);
  if (state === undefined) {
    state = {
      attached: false,
      suspended: 0,
      adjusting: null,
      componentsVersion: 0,
      navigations: 0,
      warnings: [],
      warningsOf: null,
      pending: null,
      refusal: null,
      preview: null,
    };
    states.set(app, state);
  }
  return state;
}

/** Resolved args of mesh-op outcomes (`OpResult.resolvedArgs`), keyed by the outcome object `apply` returned. */
const resolvedArgs = new WeakMap<object, ParamValues>();

/** Mesh operators call this with the outcome they return and the kernel's resolved args. */
export function rememberResolvedArgs(outcome: object, args: ParamValues): void {
  resolvedArgs.set(outcome, args);
}

export const navigationsOf = (app: EditorApp): number => (app.history as Partial<KernelHistory>).navigations ?? 0;

// ---------- reading ----------

/** The live LastRun (not closed), else null. */
export function liveLastRun(app: EditorApp): LastRun | null {
  const last = app.session.getState().lastRun;
  return last !== null && last.closed === null ? last : null;
}

/** Warnings of the recorded run (empty when `lastRun` is not the run they came from). */
export function lastRunWarnings(app: EditorApp): readonly OpWarning[] {
  const state = lastRunState(app);
  const last = app.session.getState().lastRun;
  return last !== null &&
    state.warningsOf !== null &&
    state.warningsOf.stepId === last.stepId &&
    state.warningsOf.id === last.id
    ? state.warnings
    : [];
}

/** The operator `edit.adjustLast` is re-running right now, else null (the runner labels its step). */
export function adjustingOperator(app: EditorApp): string | null {
  return lastRunState(app).adjusting;
}

/** The adjust in flight, if any (edit.undo/edit.redo wait for it). */
export function pendingAdjust(app: EditorApp): Promise<unknown> | null {
  return lastRunState(app).pending;
}

// ---------- the B11 runtime chunk (§5.27) ----------

/** The lazy modules of B11's runtime. */
export interface OpsRuntime {
  readonly lastop: typeof LastopEngineModule;
  readonly capture: typeof CaptureEngineModule;
}

let runtime: OpsRuntime | null = null;
let runtimeLoad: Promise<OpsRuntime> | null = null;

/** Loads the B11 runtime chunk once (a failed load is retried by the next call). */
export function loadOpsRuntime(): Promise<OpsRuntime> {
  if (runtimeLoad === null) {
    const load = Promise.all([import('./lastopEngine'), import('../../edit/captureEngine')]).then(
      ([lastop, capture]) => {
        runtime = { lastop, capture };
        return runtime;
      },
    );
    runtimeLoad = load;
    load.catch(() => {
      if (runtimeLoad === load) runtimeLoad = null;
    });
  }
  return runtimeLoad;
}

/** The B11 runtime once its chunk has loaded, else null. */
export function opsRuntime(): OpsRuntime | null {
  return runtime;
}

/**
 * Binds the card's tracker to `app` once (§5.7 "When the card closes"): at once when the runtime chunk has loaded,
 * else when it loads (`load: false` only binds an already loaded chunk: the runner before every run and the built-ins
 * at registration; the recorder loads it). Idempotent.
 */
export function attachLastRunTracker(app: EditorApp, load = true): void {
  if (lastRunState(app).attached) return;
  const loaded = opsRuntime();
  if (loaded !== null) loaded.lastop.attachTracker(app);
  else if (load) {
    loadOpsRuntime().then(
      (rt) => rt.lastop.attachTracker(app),
      () => {
        // Offline after a redeploy: the card stays until the chunk loads (the next record retries).
      },
    );
  }
}

/**
 * `edit.adjustLast`'s prepare (§5.7; the engine is ./lastopEngine.ts): undo the step, re-run the operator with the
 * recorded context, targets and kind plus the new values. Resolves to the refusal (null when it ran). While the
 * runtime chunk loads, `pendingAdjust` already answers for this adjust (undo and redo wait for it).
 */
export function adjustLastRun(app: EditorApp, patch: unknown): Promise<string | null> {
  const loaded = opsRuntime();
  if (loaded !== null) return loaded.lastop.adjustLastRun(app, patch);
  const state = lastRunState(app);
  const run = loadOpsRuntime().then((rt) => rt.lastop.adjustLastRun(app, patch));
  state.pending = run;
  const settled = (): void => {
    if (state.pending === run) state.pending = null;
  };
  run.then(settled, settled);
  return run;
}

// ---------- closing ----------

/** Closes the live LastRun with `reason` (the card and the INPUTS entry disappear; `G` keeps working). */
export function closeLastRun(app: EditorApp, reason: string): void {
  const last = app.session.getState().lastRun;
  if (last === null || last.closed !== null) return;
  app.session.setState({ lastRun: { ...last, closed: reason } });
}

/**
 * Lets the component selection service publish what the run itself stored before the tracker's baseline is taken
 * (§5.7: the op's result selection is part of the run, not a "Selection changed" after it). B10's service settles an
 * op's pending result when it next reads the mesh after the commit, else in a microtask at the end of the task, which
 * would land after the baseline and close the fresh card. A read of the run's meshes and the hilited ones settles it
 * now. Call it before the LastRun is installed (its publish must not reach the new card) and before `takeBaseline`.
 */
export function settleSelection(app: EditorApp, meshes: readonly MeshId[]): void {
  const ids = new Set<MeshId>(meshes);
  for (const id of app.session.getState().model.hilite) ids.add(id);
  if (ids.size === 0) return;
  try {
    app.components.snapshot([...ids]);
  } catch {
    // A service that cannot read yet (the mesh kernel loading) has nothing pending to settle.
  }
}

/** Re-reads what the tracker compares against (after recording or after an adjust that redid the original step). */
export function takeBaseline(app: EditorApp): void {
  const state = lastRunState(app);
  state.componentsVersion = app.components.version;
  state.navigations = navigationsOf(app);
}

// ---------- recording ----------

/** What the runner hands the recorder after a finished run. */
export interface FinishedRun {
  readonly def: OperatorDef<unknown, unknown, unknown>;
  /** The args the operator ran with (after the runner's coercion). */
  readonly args: unknown;
  readonly ctx: RunContext | undefined;
  readonly value: unknown;
  /** The history step the run recorded, null when none. */
  readonly stepId: number | null;
  /** The session right before the run. */
  readonly before: SessionState;
  /** The step seed of the latest mesh run before this run started (to tell whether this run set one). */
  readonly seedBefore: object | null;
}

/** True when an operator's runs can become `lastRun` (§5.7): params declared, or adjustable/repeatable flags. */
export function recordsLastRun(def: OperatorDef<unknown, unknown, unknown>): boolean {
  if (def.flags?.selection === true) return false;
  return def.params !== undefined || def.flags?.adjustable === true || def.flags?.repeatable === true;
}

/**
 * The component kind a run read: its explicit `kind`, else the mode at the start; null for object-level ops, for
 * whole-mesh runs (object mode, or an explicit `kind: null` of a `WHOLE_MESH_OPS` op) and for operators that take no
 * `kind` (only mesh operators pass `kind` through, `MeshOpArgs`).
 */
function kindOfRun(
  def: OperatorDef<unknown, unknown, unknown>,
  args: unknown,
  before: SessionState,
): ComponentKind | null {
  // Object-level kernel ops (their descriptors, M6A-INT-13: with the Model operators chunk, loaded once one ran).
  if (modelOperators()?.OBJECT_LEVEL_MESH_OPS.has(def.id) === true) return null;
  if (def.extraArgs?.includes('kind') !== true) return null;
  const given = isRecord(args) ? args['kind'] : undefined;
  if (given === null && WHOLE_MESH_OPS.has(def.id)) return null;
  if (given === 'vertex' || given === 'edge' || given === 'face') return given;
  const mode = before.model.componentMode;
  return mode === 'object' ? null : mode;
}

const meshIds = (value: unknown): MeshId[] =>
  Array.isArray(value) ? value.filter((id): id is MeshId => typeof id === 'string' && id.startsWith('msh_')) : [];

/** The meshes a run acted on (the re-run of `edit.adjustLast` passes them as `meshes`). */
function targetsOfRun(
  def: OperatorDef<unknown, unknown, unknown>,
  args: unknown,
  value: unknown,
  before: SessionState,
): MeshId[] {
  const explicit = isRecord(args) ? args['meshes'] : undefined;
  if (modelOperators()?.MESH_SET_OPS.has(def.id) === true) {
    // Set-ops: the inputs (Combine removes all but the first; the adjusted re-run first undoes, restoring them).
    return Array.isArray(explicit) ? meshIds(explicit) : meshIds(before.selection.objects);
  }
  if (isRecord(value) && Array.isArray(value['meshes'])) return meshIds(value['meshes']);
  if (isRecord(value) && typeof value['mesh'] === 'string') return meshIds([value['mesh']]);
  if (Array.isArray(explicit)) return meshIds(explicit);
  if (isRecord(args) && typeof args['mesh'] === 'string') return meshIds([args['mesh']]);
  return [];
}

/** Resolved args of a run: the kernel's for mesh ops; a primitive's live parameters for `mesh.create.*`. */
function resolvedOf(
  app: EditorApp,
  def: OperatorDef<unknown, unknown, unknown>,
  value: unknown,
): ParamValues | undefined {
  if (!isRecord(value)) return undefined;
  const kernel = resolvedArgs.get(value);
  if (kernel !== undefined) return kernel;
  const mesh = value['mesh'];
  if (def.id.startsWith('mesh.create.') && typeof mesh === 'string' && mesh.startsWith('msh_')) {
    // The record's generator holds the parameters the primitive was built with (the preferred default set applied).
    return app.store.get('meshes', mesh as MeshId)?.generator?.params;
  }
  return undefined;
}

/** The recorded args: resolved, without the pass-through target keys. */
function recordedArgs(
  app: EditorApp,
  def: OperatorDef<unknown, unknown, unknown>,
  args: unknown,
  value: unknown,
): ParamValues {
  const resolved = resolvedOf(app, def, value);
  const base: Record<string, ParamValue> = {};
  if (isRecord(args)) {
    for (const [key, v] of Object.entries(args)) {
      if (!TARGET_KEYS.has(key) && v !== undefined) base[key] = v as ParamValue;
    }
  }
  if (resolved !== undefined) {
    for (const [key, v] of Object.entries(resolved)) if (!TARGET_KEYS.has(key)) base[key] = v;
  }
  // Every declared param has a value (defaults for anything the run left out).
  for (const param of def.params ?? []) if (!Object.hasOwn(base, param.name)) base[param.name] = param.default;
  return Object.freeze(base);
}

function contextOf(targets: readonly MeshId[], before: SessionState): LastRun['context'] {
  const symmetry: Record<string, SymmetrySettings> = {};
  for (const id of targets) {
    const settings = before.model.symmetry.get(id);
    if (settings !== undefined) symmetry[id] = settings;
  }
  return Object.freeze({
    symmetry: Object.freeze(symmetry),
    soft: before.model.softSelect.on ? before.model.softSelect : null,
  });
}

function warningsOf(value: unknown): readonly OpWarning[] {
  if (!isRecord(value) || !Array.isArray(value['warnings'])) return [];
  return value['warnings'] as readonly OpWarning[];
}

/**
 * Card fields that apply only to some arguments of an operation (acceptance fix round 1): a Handheld or Prop template
 * has none of the humanoid fields, Humanoid Guides take height and proportions, a Humanoid Body height and style; Insert
 * Edge Loop shows Number of Loops only for "Multiple edge loops", and the weight only for the other two modes.
 */
const CARD_FIELDS: Readonly<Record<string, (args: ParamValues) => (name: string) => boolean>> = {
  'mesh.create.template': (args) => {
    const template = args['template'];
    if (template === 'humanoid') return (name) => name === 'height' || name === 'preset';
    if (template === 'humanoidBody') return (name) => name === 'height' || name === 'style';
    return () => false;
  },
  'mesh.insertLoop': (args) => {
    const multiple = (args['mode'] ?? 'relative') === 'multiple';
    return (name) => (name === 'divisions' ? multiple : name === 'weight' ? !multiple : true);
  },
};

/** The params a LastRun's card shows for its recorded args. */
function cardParams(def: OperatorDef<unknown, unknown, unknown>, args: ParamValues): readonly ParamDef[] {
  const params = def.params ?? [];
  const fields = CARD_FIELDS[def.id];
  if (fields === undefined) return params;
  const shown = fields(args);
  return params.filter((param) => shown(param.name));
}

/**
 * The runner's LastRun hook (§5.7): records `session.lastRun` for qualifying runs, closes a live card for any other run
 * that recorded a step, and arms the capture window after a keyboard-invoked run with a primary param (§5.10 (b)).
 */
export function recordLastRun(app: EditorApp, run: FinishedRun): void {
  const { def, args, ctx, value, stepId, before } = run;
  if (stepId === null || def.flags?.undo !== true) return;
  if (!recordsLastRun(def)) {
    closeLastRun(app, def.flags?.selection === true ? LAST_RUN_CLOSED.selection : LAST_RUN_CLOSED.another);
    return;
  }
  const state = lastRunState(app);
  const previous = before.lastRun;
  const adjusted = state.adjusting === def.id && ctx?.source === 'card' && previous !== null && previous.id === def.id;
  const seedNow = runSeedOf(app);
  const seed = seedNow !== null && seedNow !== run.seedBefore && seedNow.opId === def.id ? seedNow.seed : '';
  const targets = adjusted ? previous.targets : targetsOfRun(def, args, value, before);
  settleSelection(app, targets);
  const flags = def.flags;
  const recorded = recordedArgs(app, def, args, value);
  const lastRun: LastRun = Object.freeze({
    id: def.id,
    label: def.label,
    params: cardParams(def, recorded),
    args: recorded,
    kind: adjusted ? previous.kind : kindOfRun(def, args, before),
    stepId,
    docSeqAfter: app.store.version,
    paneId: adjusted ? previous.paneId : (ctx?.paneId ?? null),
    source: adjusted ? previous.source : (ctx?.source ?? 'api'),
    adjustable: flags?.adjustable === true,
    repeatable: flags?.repeatable === true,
    tool: adjusted ? previous.tool : (def.tool ?? null),
    targets: Object.freeze([...targets]),
    seed: adjusted ? previous.seed : seed,
    context: adjusted ? previous.context : contextOf(targets, before),
    closed: null,
  });
  app.session.setState({ lastRun });
  if (!adjusted) resetLastOpCard(app);
  state.warnings = warningsOf(value);
  state.warningsOf = lastRun;
  takeBaseline(app);
  // A live LastRun needs the tracker (loads the B11 runtime chunk when an operation records before any Model entry).
  attachLastRunTracker(app);
  if (
    !adjusted &&
    ctx?.source === 'keyboard' &&
    lastRun.adjustable &&
    app.session.getState().workspace === 'model' &&
    primaryOf(lastRun.params) !== null
  ) {
    app.capture.arm('keyboard-op', 'last-run');
  }
}

const primaryOf = (params: readonly ParamDef[]): ParamDef | null =>
  params.find((param) => param.primary === true && param.hidden !== true && param.bound === 'value') ?? null;

// ---------- adjust (edit.adjustLast's engine) ----------

/** Why `edit.adjustLast` cannot run now (null: it can). */
export function adjustProblem(app: EditorApp): string | null {
  const last = liveLastRun(app);
  if (last === null) return NO_OPERATION_TO_ADJUST;
  if (!last.adjustable) return `${last.label} has no settings to adjust`;
  if (app.history.peekUndo()?.id !== last.stepId) return NO_OPERATION_TO_ADJUST;
  if (app.store.version !== last.docSeqAfter) return NO_OPERATION_TO_ADJUST;
  for (const id of last.targets) {
    if (app.meshes.get(id)?.state === 'loading') return 'Mesh is loading';
  }
  return null;
}

/** The refusal of the latest adjust (cleared by the next one). */
export function lastAdjustRefusal(app: EditorApp): string | null {
  return lastRunState(app).refusal;
}

// ---------- operators ----------

const lastTool = defineOperator({
  id: 'tool.last',
  label: 'Last Tool',
  description: 'Re-activates the last viewport tool (Y).',
  category: 'tool',
  scope: 'model',
  workspaces: ['model'],
  poll: ({ app }) => (app.session.getState().model.lastTool === null ? fail('No tool used yet') : OK),
  async prepare(ctx) {
    const tool = ctx.app.session.getState().model.lastTool;
    if (tool === null) return;
    await activateTool(ctx, tool);
  },
  apply() {},
});

/** Activates a viewport tool through `view.tool` (from a dispatcher's prepare). */
export async function activateTool(ctx: OperatorContext, tool: string): Promise<void> {
  const result = await ctx.app.runUntyped('view.tool', { panel: 'viewport', tool }, runContextOf(ctx));
  if (result.status === 'cancelled') throw new EkzaError('unsupported', result.reason);
  if (result.status === 'failed') throw new EkzaError(result.error.code, result.error.message);
}

const lastOpCard = defineOperator({
  id: 'view.lastOpCard',
  label: 'Adjust Last Operation',
  description: "Opens the Last-op card with the last operation's parameters (T).",
  category: 'view',
  scope: 'model',
  workspaces: ['model'],
  aliases: ['Redo Last', 'Adjust Last Operation'],
  poll({ app }) {
    const last = liveLastRun(app);
    if (last === null) return fail(NO_OPERATION_TO_ADJUST);
    return OK;
  },
  apply({ app, paneId }, args) {
    const last = liveLastRun(app);
    if (last === null) return;
    const opts = isRecord(args) ? args : {};
    openLastOpCard(app, {
      expand: opts['expand'] !== false,
      focusPrimary: opts['focusPrimary'] !== false,
      paneId: last.paneId ?? paneId ?? app.session.getState().hoveredPanel?.paneId ?? null,
    });
    // Maya's `T` on the extrude node: reopen the extrude session and its manipulator when the current selection is
    // still the extrude's result (§5.7; B12b's `reopen` decides the rest).
    if (last.id === 'mesh.extrude' && app.extrude.state === null && resultIsSelection(app, last)) app.extrude.reopen();
  },
});

/**
 * Whether the current selection still equals the live LastRun's result (§5.7, `T` and the extrude session): the
 * component mode the run read is the current mode, its meshes are hilited, and the component selection has not changed
 * since it was recorded (the tracker's baseline holds the run's own result, `settleSelection`). A mode switch that
 * keeps the card live (same hilite) shows another kind's selection, so it does not qualify.
 */
export function resultIsSelection(app: EditorApp, last: LastRun): boolean {
  const model = app.session.getState().model;
  if (last.kind === null || model.componentMode !== last.kind) return false;
  if (!last.targets.every((id) => model.hilite.includes(id))) return false;
  return app.components.version === lastRunState(app).componentsVersion;
}

export const LASTOP_OPERATORS: readonly AnyOperator[] = [lastTool, lastOpCard];
