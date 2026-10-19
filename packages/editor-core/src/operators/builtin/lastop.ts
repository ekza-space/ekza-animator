// Adjust Last Operation, Repeat Last and the last tool (M6A-SPEC §5.7, ADR 0016 D6; B11): the `LastRun` recorder the
// operator runner calls after every finished run, the tracker that closes the Last-op card on the events of §5.7's
// table, and the operators `tool.last` (`Y`) and `view.lastOpCard` (`T`). `edit.adjustLast` and `edit.repeatLast` live
// in ./edit.ts and use the helpers below.
//
// What is recorded (`session.lastRun`): the last undoable run that finished and recorded a history step, of an
// operator that declares `params` (`[]` allowed) or is flagged adjustable or repeatable, and is not a selection
// gesture. Args are the **resolved** args (the kernel's `OpResult.resolvedArgs` for mesh ops, the runner's coercion
// otherwise; the pass-through `meshes`/`kind` are kept apart as `targets`/`kind`), with the component kind the run
// read, the step, the store version, the pane, the run source, the flags, the targets, the step seed and the
// symmetry/soft context. An adjusted re-run (`edit.adjustLast`) keeps the recorded source, pane, tool, seed, context,
// kind and targets: it is the same operation with new values.
import { coerceArgs, EkzaError, type ParamDef, type ParamValue, type ParamValues } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type { ComponentKind, OpWarning } from '@ekza-animator/mesh-core';
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import type { KernelHistory } from '../../history/history';
import { attachMeshes } from '../../mesh';
import { meshKernel } from '../../mesh/kernel';
import { runSeedOf } from '../../mesh/seed';
import type {
  EditorApp,
  LastRun,
  MeshOpSession,
  OperatorContext,
  OperatorDef,
  RunContext,
  SessionState,
  SymmetrySettings,
} from '../../types';
import { openLastOpCard, resetLastOpCard } from '../../edit/capture';
import { type AnyOperator, defineOperator, fail, isRecord, OK, runContextOf } from './define';

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

interface LastRunState {
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
}

const states = new WeakMap<EditorApp, LastRunState>();

function stateOf(app: EditorApp): LastRunState {
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

const navigationsOf = (app: EditorApp): number => (app.history as Partial<KernelHistory>).navigations ?? 0;

// ---------- reading ----------

/** The live LastRun (not closed), else null. */
export function liveLastRun(app: EditorApp): LastRun | null {
  const last = app.session.getState().lastRun;
  return last !== null && last.closed === null ? last : null;
}

/** Warnings of the recorded run (empty when `lastRun` is not the run they came from). */
export function lastRunWarnings(app: EditorApp): readonly OpWarning[] {
  const state = stateOf(app);
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
  return stateOf(app).adjusting;
}

/** The adjust in flight, if any (edit.undo/edit.redo wait for it). */
export function pendingAdjust(app: EditorApp): Promise<unknown> | null {
  return stateOf(app).pending;
}

// ---------- closing ----------

/** Closes the live LastRun with `reason` (the card and the INPUTS entry disappear; `G` keeps working). */
export function closeLastRun(app: EditorApp, reason: string): void {
  const last = app.session.getState().lastRun;
  if (last === null || last.closed !== null) return;
  app.session.setState({ lastRun: { ...last, closed: reason } });
}

/** Re-reads what the tracker compares against (after recording or after an adjust that redid the original step). */
function takeBaseline(app: EditorApp): void {
  const state = stateOf(app);
  state.componentsVersion = app.components.version;
  state.navigations = navigationsOf(app);
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
};

function sameSymmetry(a: SymmetrySettings | undefined, b: SymmetrySettings | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.mode === b.mode && a.tolerance === b.tolerance && a.preserveSeam === b.preserveSeam;
}

function settingsChanged(last: LastRun, state: SessionState, previous: SessionState): boolean {
  if (state.model.symmetry !== previous.model.symmetry) {
    for (const id of last.targets ?? []) {
      if (!sameSymmetry(state.model.symmetry.get(id), previous.model.symmetry.get(id))) return true;
    }
  }
  const soft = state.model.softSelect;
  const before = previous.model.softSelect;
  return (
    soft !== before &&
    (soft.on !== before.on ||
      soft.radius !== before.radius ||
      soft.falloff !== before.falloff ||
      soft.curve !== before.curve)
  );
}

/**
 * Binds the tracker to `app` once (§5.7 "When the card closes"). Idempotent; the runner calls it before every run and
 * the built-ins at registration. Mode switches with the same hilited meshes, shading, display toggles, camera,
 * panels, `T` and menus never close the card.
 */
export function attachLastRunTracker(app: EditorApp): void {
  const state = stateOf(app);
  if (state.attached) return;
  state.attached = true;
  takeBaseline(app);
  const live = (): LastRun | null => (state.suspended > 0 ? null : liveLastRun(app));
  app.store.subscribe((batch) => {
    const last = live();
    if (last === null) return;
    switch (batch.origin) {
      case 'preview':
        // A preview is not a write; the adjust poll compares versions, so follow it.
        app.session.setState({ lastRun: { ...last, docSeqAfter: batch.version } });
        return;
      case 'local':
        closeLastRun(app, LAST_RUN_CLOSED.another);
        return;
      case 'undo':
      case 'redo':
        closeLastRun(app, LAST_RUN_CLOSED.undone);
        return;
      case 'load':
        closeLastRun(app, LAST_RUN_CLOSED.project);
        return;
      case 'remote':
      case 'import':
      case 'migration':
      case 'cleanup': {
        // Another user, an import, a repair: only a change of a target mesh closes the card.
        const targets = new Set<string>(last.targets ?? []);
        const touches = batch.changes.some((change) => change.table === 'meshes' && targets.has(change.id));
        if (touches) closeLastRun(app, LAST_RUN_CLOSED.remote);
        else app.session.setState({ lastRun: { ...last, docSeqAfter: batch.version } });
      }
    }
  });
  app.session.subscribe((next, previous) => {
    const last = state.suspended > 0 ? null : next.lastRun;
    if (last === null || last.closed !== null) return;
    // An update that installs or replaces the LastRun itself is authoritative (the recorder, B9's workspace switch).
    if (next.lastRun !== previous.lastRun) return;
    if (next.workspace !== previous.workspace) closeLastRun(app, LAST_RUN_CLOSED.workspace);
    else if (
      next.selection.objects !== previous.selection.objects &&
      !sameSet(next.selection.objects, previous.selection.objects)
    ) {
      closeLastRun(app, LAST_RUN_CLOSED.selection);
    } else if (
      next.selection.controls !== previous.selection.controls &&
      !sameSet(next.selection.controls, previous.selection.controls)
    ) {
      closeLastRun(app, LAST_RUN_CLOSED.selection);
    } else if (next.model.hilite !== previous.model.hilite && !sameSet(next.model.hilite, previous.model.hilite)) {
      // A mode switch with the same hilited meshes keeps the card (§5.7, E2E-MOD-19); another hilite set does not.
      closeLastRun(app, LAST_RUN_CLOSED.selection);
    } else if (settingsChanged(last, next, previous)) closeLastRun(app, LAST_RUN_CLOSED.settings);
  });
  app.components.subscribe((version) => {
    const last = live();
    if (last === null || version === state.componentsVersion) return;
    closeLastRun(app, LAST_RUN_CLOSED.selection);
  });
  app.history.subscribe(() => {
    const last = live();
    if (last === null) return;
    if (navigationsOf(app) !== state.navigations) closeLastRun(app, LAST_RUN_CLOSED.undone);
  });
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
 * The component kind a run read: its explicit `kind`, else the mode at the start; null for object-level ops and for
 * operators that take no `kind` (only mesh operators pass `kind` through, `MeshOpArgs`).
 */
function kindOfRun(
  def: OperatorDef<unknown, unknown, unknown>,
  args: unknown,
  before: SessionState,
): ComponentKind | null {
  const desc = MESH_OP_DESCRIPTORS[def.id];
  if (desc !== undefined && desc.kinds === 'object') return null;
  if (def.extraArgs?.includes('kind') !== true) return null;
  const given = isRecord(args) ? args['kind'] : undefined;
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
  if (MESH_SET_OP_DESCRIPTORS[def.id] !== undefined) {
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
 * The runner's LastRun hook (§5.7): records `session.lastRun` for qualifying runs, closes a live card for any other run
 * that recorded a step, and arms the capture window after a keyboard-invoked run with a primary param (§5.10 (b)).
 */
export function recordLastRun(app: EditorApp, run: FinishedRun): void {
  attachLastRunTracker(app);
  const { def, args, ctx, value, stepId, before } = run;
  if (stepId === null || def.flags?.undo !== true) return;
  if (!recordsLastRun(def)) {
    closeLastRun(app, def.flags?.selection === true ? LAST_RUN_CLOSED.selection : LAST_RUN_CLOSED.another);
    return;
  }
  const state = stateOf(app);
  const previous = before.lastRun;
  const adjusted = state.adjusting === def.id && ctx?.source === 'card' && previous !== null && previous.id === def.id;
  const seedNow = runSeedOf(app);
  const seed = seedNow !== null && seedNow !== run.seedBefore && seedNow.opId === def.id ? seedNow.seed : '';
  const targets = adjusted ? previous.targets : targetsOfRun(def, args, value, before);
  const flags = def.flags;
  const lastRun: LastRun = Object.freeze({
    id: def.id,
    label: def.label,
    params: def.params ?? [],
    args: recordedArgs(app, def, args, value),
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

/** Coerces only the given keys (absent params keep the recorded values; unknown keys drop). */
export function coercePartial(params: readonly ParamDef[], raw: unknown): ParamValues {
  if (!isRecord(raw)) return {};
  const out: Record<string, ParamValue> = {};
  for (const param of params) {
    if (!Object.hasOwn(raw, param.name) || raw[param.name] === undefined) continue;
    const value = coerceArgs([param], { [param.name]: raw[param.name] }).args[param.name];
    if (value !== undefined) out[param.name] = value;
  }
  return out;
}

/** The args the adjusted re-run gets: the recorded args, the new values, the recorded targets and kind. */
export function adjustedArgs(app: EditorApp, last: LastRun, patch: unknown): Record<string, unknown> {
  const def = app.operators.get(last.id);
  const extra = def?.extraArgs ?? [];
  return {
    ...last.args,
    ...coercePartial(last.params, patch),
    ...(extra.includes('meshes') ? { meshes: last.targets } : {}),
    ...(extra.includes('kind') && last.kind !== null ? { kind: last.kind } : {}),
  };
}

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

/**
 * `edit.adjustLast`'s prepare (§5.7): undo the step, re-run the operator with the recorded context, targets and kind
 * plus the new values (`source: 'card'`, label "<label> (adjusted)"; history length unchanged). A refusal redoes the
 * original step; the returned reason makes the dispatcher's second poll report it.
 */
export async function adjustLastRun(app: EditorApp, patch: unknown): Promise<string | null> {
  const state = stateOf(app);
  const last = liveLastRun(app);
  if (last === null) return NO_OPERATION_TO_ADJUST;
  const args = adjustedArgs(app, last, patch);
  const ctx: RunContext = {
    source: 'card',
    ...(last.paneId === null ? {} : { paneId: last.paneId }),
  };
  state.suspended++;
  state.adjusting = last.id;
  state.refusal = null;
  let resolveDone: (value?: unknown) => void = () => {};
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  state.pending = done;
  try {
    app.history.undo();
    const result = await app.runUntyped(last.id, args, ctx);
    if (result.status === 'finished' && liveLastRun(app)?.stepId !== last.stepId) return null;
    // Refused, failed or recorded nothing: the original step comes back, the card stays as it was.
    const reason =
      result.status === 'cancelled'
        ? result.reason
        : result.status === 'failed'
          ? result.error.message
          : `${last.label} changed nothing`;
    if (app.history.canRedo()) app.history.redo();
    const top = app.history.peekUndo();
    app.session.setState({
      lastRun: { ...last, stepId: top?.id ?? last.stepId, docSeqAfter: app.store.version, closed: null },
    });
    takeBaseline(app);
    state.refusal = `${last.label}: ${reason}`;
    return state.refusal;
  } finally {
    state.adjusting = null;
    state.suspended--;
    if (state.pending === done) state.pending = null;
    resolveDone();
  }
}

/** The refusal of the latest adjust (cleared by the next one). */
export function lastAdjustRefusal(app: EditorApp): string | null {
  return stateOf(app).refusal;
}

// ---------- card drags (§5.7 "Card drags") ----------

/** A live preview of new values of the last mesh op from its pre-op mesh (no document writes). */
export interface CardPreview {
  update(patch: ParamValues): void;
  /** The preview's re-runs exceeded 50 ms: the card switches to "update on release". */
  readonly slow: boolean;
  cancel(): void;
}

/** Above this per re-run the card stops previewing and updates on release (§5.7). */
export const CARD_PREVIEW_BUDGET_MS = 50;

/**
 * Opens `meshes.beginOp(op, targets, args', { base: 'before-last' })` for the live LastRun when it is a kernel mesh op
 * (null otherwise: the field updates on release). Release runs `edit.adjustLast` once, which commits the matching
 * session.
 */
export function beginCardPreview(app: EditorApp, now: () => number = () => performance.now()): CardPreview | null {
  const last = liveLastRun(app);
  if (last === null || !last.adjustable || adjustProblem(app) !== null) return null;
  if (MESH_OP_DESCRIPTORS[last.id] === undefined) return null;
  if (attachMeshes(app) === null) return null;
  const op = meshKernel()?.MESH_OPS[last.id];
  if (op === undefined) return null;
  const base = { ...last.args };
  let session: MeshOpSession;
  try {
    session = app.meshes.beginOp(op, last.targets, base, { base: 'before-last' });
  } catch {
    return null;
  }
  let slow = false;
  return {
    get slow() {
      return slow;
    },
    update(patch: ParamValues): void {
      if (slow || !session.active) return;
      const start = now();
      session.update({ ...base, ...coercePartial(last.params, patch) });
      if (now() - start > CARD_PREVIEW_BUDGET_MS) slow = true;
    },
    cancel(): void {
      if (session.active) session.cancel();
    },
  };
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
    // Maya's `T` on the extrude node: reopen the extrude session and its manipulator (B12b decides when it can).
    if (last.id === 'mesh.extrude' && app.extrude.state === null) app.extrude.reopen();
  },
});

export const LASTOP_OPERATORS: readonly AnyOperator[] = [lastTool, lastOpCard];
