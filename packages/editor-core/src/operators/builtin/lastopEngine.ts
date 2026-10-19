// The lazy half of Adjust Last Operation and the Last-op card (M6A-SPEC §5.7, §5.27; B11): the tracker that closes the
// card on the events of §5.7's table, the engine of `edit.adjustLast` (undo + re-run with the recorded context) and
// the card's live mesh preview. It loads with the B11 runtime chunk (`loadOpsRuntime` in ./lastop.ts: the first Model
// entry, a recorded LastRun, an adjust); the eager route keeps only the recorder, the per-app state and the polls.
import { coerceArgs, type ParamDef, type ParamValue, type ParamValues } from '@ekza-animator/anim-core';
import { attachMeshes } from '../../mesh';
import { meshKernel } from '../../mesh/kernel';
import type { EditorApp, LastRun, MeshOpSession, RunContext, SessionState, SymmetrySettings } from '../../types';
import { isRecord } from './define';
import {
  adjustProblem,
  closeLastRun,
  LAST_RUN_CLOSED,
  lastRunState,
  liveLastRun,
  NO_OPERATION_TO_ADJUST,
  navigationsOf,
  takeBaseline,
} from './lastop';
import { WHOLE_MESH_OPS } from './mesh/whole';
import { MESH_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';

// ---------- the tracker (§5.7 "When the card closes") ----------

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
 * Binds the tracker to `app` once (§5.7 "When the card closes"); lastop.ts's `attachLastRunTracker` calls it once this
 * chunk has loaded. Mode switches with the same hilited meshes, shading, display toggles, camera, panels, `T` and
 * menus never close the card. Bound after a LastRun was recorded (the chunk was still loading), it first closes that
 * LastRun if what it would have seen happened meanwhile (an undo, another write, a component selection change).
 */
export function attachTracker(app: EditorApp): void {
  const state = lastRunState(app);
  if (state.attached) return;
  state.attached = true;
  const recorded = liveLastRun(app);
  if (recorded === null) takeBaseline(app);
  else if (navigationsOf(app) !== state.navigations) closeLastRun(app, LAST_RUN_CLOSED.undone);
  else if (app.history.peekUndo()?.id !== recorded.stepId || app.store.version !== recorded.docSeqAfter) {
    closeLastRun(app, LAST_RUN_CLOSED.another);
  } else if (app.components.version !== state.componentsVersion) closeLastRun(app, LAST_RUN_CLOSED.selection);
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

/**
 * The args the adjusted re-run gets: the recorded args, the new values, the recorded targets and kind. A whole-mesh
 * run of a `WHOLE_MESH_OPS` op passes `kind: null`, so it stays on the whole mesh after a switch to a component mode.
 */
export function adjustedArgs(app: EditorApp, last: LastRun, patch: unknown): Record<string, unknown> {
  const def = app.operators.get(last.id);
  const extra = def?.extraArgs ?? [];
  const kind = last.kind !== null || WHOLE_MESH_OPS.has(last.id);
  return {
    ...last.args,
    ...coercePartial(last.params, patch),
    ...(extra.includes('meshes') ? { meshes: last.targets } : {}),
    ...(extra.includes('kind') && kind ? { kind: last.kind } : {}),
  };
}

/**
 * `edit.adjustLast`'s prepare (§5.7): undo the step, re-run the operator with the recorded context, targets and kind
 * plus the new values (`source: 'card'`, label "<label> (adjusted)"; history length unchanged). A refusal redoes the
 * original step; the returned reason makes the dispatcher's second poll report it.
 */
export async function adjustLastRun(app: EditorApp, patch: unknown): Promise<string | null> {
  const state = lastRunState(app);
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
