// Edit operators (MVP-SPEC §4.9 `edit.*`): undo/redo through the editor history, the menu dispatchers for copy,
// paste and delete (by the panel the command is for), and Esc.
//
// M6a (M6A-SPEC §5.7, §5.8; B11): `edit.adjustLast` (re-runs the last operation with new values in place of its
// step), `edit.repeatLast` (`G`, by the run source), and the extrude-session hook of `edit.undo`/`edit.redo` (while a
// session is open they step its args stack first, `app.extrude.stepBack/stepForward`).
import { EkzaError, stripBound } from '@ekza-studio/anim-core';
import { cancelChannelEditGestures } from '../../edit/channels';
import type { EditorApp, LastRun, RunContext } from '../../types';
import { GLOBAL_SCOPE, type HistoryResult, type OperatorContext, PANEL } from '../../types';
import { type AnyOperator, defineOperator, fail, forward, isRecord, OK, panelOf, runContextOf } from './define';
import {
  activateTool,
  adjustLastRun,
  adjustProblem,
  lastAdjustRefusal,
  NOTHING_TO_REPEAT,
  pendingAdjust,
} from './lastop';

function reportHistory(app: EditorApp, result: HistoryResult | null): HistoryResult | null {
  if (result === null) return null;
  const messages = [...result.warnings];
  const skipped = result.doc?.skipped.length ?? 0;
  if (skipped > 0) messages.push(`${skipped} change${skipped === 1 ? ' was' : 's were'} skipped (changed since)`);
  if (messages.length > 0) {
    app.services.notify.toast({ kind: 'warning', text: `${result.label}: ${messages.join('; ')}` });
  }
  return result;
}

/** Whether `edit.undo`/`edit.redo`'s prepare stepped the extrude session's args stack instead of the history. */
interface Stepped {
  readonly stepped: boolean;
}

const NOT_STEPPED: Stepped = Object.freeze({ stepped: false });

/**
 * §5.8 args stack: while an extrude session is open, undo/redo first ask the session to step (`edit.adjustLast` with
 * the stack's entry; the session stays open, the history length is unchanged). Without a session and without an
 * adjust in flight this stays synchronous, so undo behaves exactly as shipped.
 */
function stepSession(app: EditorApp, direction: 'back' | 'forward'): Stepped | Promise<Stepped> {
  if (app.extrude.state === null && pendingAdjust(app) === null) return NOT_STEPPED;
  return (async () => {
    await pendingAdjust(app);
    if (app.extrude.state === null) return NOT_STEPPED;
    const stepped = direction === 'back' ? app.extrude.stepBack() : app.extrude.stepForward();
    if (stepped) await pendingAdjust(app);
    return { stepped };
  })();
}

const undo = defineOperator<'edit.undo', Stepped>({
  id: 'edit.undo',
  label: 'Undo',
  description: 'Undo the last edit, keyed or not.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  poll: ({ app }) => (app.history.canUndo() || app.extrude.state !== null ? OK : fail('Nothing to undo')),
  prepare: ({ app }) => stepSession(app, 'back'),
  apply: ({ app }, _args, prepared) => (prepared.stepped ? null : reportHistory(app, app.history.undo())),
});

/**
 * `edit.redo {step}` (B12b, §5.8: the zero-drop toast's Undo) redoes only while `step` is the history's top redo entry
 * (an undo of anything else since, or a new edit, leaves it a no-op "Nothing to restore"); it never steps a session.
 */
const redoStep = (args: unknown): number | null =>
  isRecord(args) && typeof args['step'] === 'number' ? args['step'] : null;

const redo = defineOperator<'edit.redo', Stepped>({
  id: 'edit.redo',
  label: 'Redo',
  description: 'Redo the last undone edit.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  poll: ({ app }, args) => {
    const step = redoStep(args);
    if (step !== null) return app.history.peekRedo()?.id === step ? OK : fail('Nothing to restore');
    return app.history.canRedo() || app.extrude.state !== null ? OK : fail('Nothing to redo');
  },
  prepare: ({ app }, args) => (redoStep(args) !== null ? NOT_STEPPED : stepSession(app, 'forward')),
  apply: ({ app }, _args, prepared) => (prepared.stepped ? null : reportHistory(app, app.history.redo())),
});

// ---------- Adjust Last Operation and Repeat Last (§5.7) ----------

/** Per app: the adjust whose refusal the second poll reports (set by prepare, read once). */
const refused = new WeakMap<EditorApp, string>();

const adjustLast = defineOperator({
  id: 'edit.adjustLast',
  label: 'Adjust Last Operation',
  description: 'Re-runs the last operation with new parameters, replacing its undo step.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  flags: { internal: true },
  extraArgs: ['args'],
  poll({ app }) {
    const reason = refused.get(app);
    if (reason !== undefined) {
      refused.delete(app);
      return fail(reason);
    }
    const problem = adjustProblem(app);
    return problem === null ? OK : fail(problem);
  },
  async prepare({ app }, args) {
    const patch = isRecord(args) ? args['args'] : undefined;
    const refusal = await adjustLastRun(app, patch ?? {});
    if (refusal !== null) refused.set(app, refusal);
  },
  apply() {
    // Dispatcher: the re-run in prepare recorded its own step (in place of the undone one).
  },
});

/** Args of a Repeat Last re-run: the recorded values without selection- and pointer-bound ones (§5.7 rule 2). */
export function repeatArgs(last: LastRun): Record<string, unknown> {
  return { ...stripBound(last.params, last.args, ['pointer', 'selection']) };
}

type RepeatPlan =
  | { readonly kind: 'tool'; readonly tool: string }
  | { readonly kind: 'run'; readonly args: Record<string, unknown> }
  | { readonly kind: 'none'; readonly reason: string };

/** §5.7 `edit.repeatLast` decides by the run source, as `G` does in desktop DCCs. */
function repeatPlan(last: LastRun | null): RepeatPlan {
  if (last === null) return { kind: 'none', reason: NOTHING_TO_REPEAT };
  // 1. A tool run (Multi-Cut cut, Insert Edge Loop by its tool, Target Weld, Slide, Paint Colour): re-enter the tool.
  if (last.source === 'tool' && last.tool !== null) return { kind: 'tool', tool: last.tool };
  // 2. Repeatable: the same values on the current selection (selection-bound args re-resolve).
  if (last.repeatable) return { kind: 'run', args: repeatArgs(last) };
  // 3. An operation with a required pointer-bound param: activate its tool.
  if (last.tool !== null) return { kind: 'tool', tool: last.tool };
  return { kind: 'none', reason: `${last.label} cannot be repeated` };
}

/** The run context a repeat forwards (the dispatcher's source, so `G` from the keyboard arms the capture window). */
function repeatContext(ctx: OperatorContext): RunContext {
  return { ...runContextOf(ctx), ...(ctx.source === undefined ? {} : { source: ctx.source }) };
}

/** Apps whose `edit.repeatLast` ran its operator in prepare (its second poll passes once). */
const repeated = new WeakSet<EditorApp>();

const repeatLastOperator = defineOperator({
  id: 'edit.repeatLast',
  label: 'Repeat Last',
  description: 'Runs the last operation again on the current selection, or re-activates the last tool (G).',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  poll(ctx) {
    // The runner's second poll answers for the run prepare made (the repeated operation may no longer poll on its
    // own result); apply consumes the token.
    if (repeated.has(ctx.app)) return OK;
    const plan = repeatPlan(ctx.app.session.getState().lastRun);
    switch (plan.kind) {
      case 'none':
        return fail(plan.reason);
      case 'tool':
        return ctx.app.operators.poll('view.tool', runContextOf(ctx), { panel: 'viewport', tool: plan.tool });
      case 'run': {
        const last = ctx.app.session.getState().lastRun;
        return last === null ? fail(NOTHING_TO_REPEAT) : ctx.app.operators.poll(last.id, repeatContext(ctx), plan.args);
      }
    }
  },
  async prepare(ctx) {
    repeated.delete(ctx.app); // a token left by an interrupted run
    const last = ctx.app.session.getState().lastRun;
    const plan = repeatPlan(last);
    if (plan.kind === 'none' || last === null) return; // the second poll reports why
    if (plan.kind === 'tool') {
      await activateTool(ctx, plan.tool);
      return;
    }
    const result = await ctx.app.runUntyped(last.id, plan.args, repeatContext(ctx));
    if (result.status === 'failed') throw new EkzaError(result.error.code, result.error.message);
    if (result.status === 'cancelled') throw new EkzaError('unsupported', result.reason);
    // The second poll answers for the repeated run: its own poll may fail now that it changed the selection.
    repeated.add(ctx.app);
  },
  apply({ app }) {
    repeated.delete(app);
  },
});

/** Panels whose copy/paste/delete act on keys rather than on the pose. */
// M2a: copy, paste and delete act on keys in the Dope Sheet too (M2A-SPEC §5.10).
const KEY_PANELS: ReadonlySet<string> = new Set([PANEL.graph, PANEL.timeline, PANEL.dopeSheet]);

/**
 * Dispatchers whose target already ran in this run's `prepare`. The runner polls again after `prepare` (§4.11.0 rule
 * 3); by then the target's own effect may have changed its poll (deleted keys are no longer selected), so that one
 * poll answers from this marker instead.
 */
const forwarded = new WeakMap<EditorApp, Set<string>>();

/** A menu command forwarded to the pose or key operator of the panel it is for (§4.9). */
function dispatcher(
  id: 'edit.copy' | 'edit.paste' | 'edit.delete',
  label: string,
  targets: { readonly pose: string; readonly keys: string },
): AnyOperator {
  const target = (ctx: OperatorContext): string => {
    const panel = panelOf(ctx);
    return panel !== null && KEY_PANELS.has(panel) ? targets.keys : targets.pose;
  };
  return defineOperator({
    id,
    label,
    description: `${label} poses (viewport, outliner, Channel Box) or keys (Graph Editor, time slider).`,
    category: 'edit',
    scope: GLOBAL_SCOPE,
    poll(ctx) {
      if (forwarded.get(ctx.app)?.delete(id) === true) return OK;
      return ctx.app.operators.poll(target(ctx), runContextOf(ctx));
    },
    async prepare(ctx) {
      await forward(ctx, target(ctx), undefined);
      let done = forwarded.get(ctx.app);
      if (done === undefined) {
        done = new Set();
        forwarded.set(ctx.app, done);
      }
      done.add(id);
    },
    apply() {},
  });
}

const escape = defineOperator({
  id: 'edit.escape',
  label: 'Cancel',
  description: 'Cancel the edit in progress; else close the dialog; else stop playback.',
  category: 'edit',
  scope: GLOBAL_SCOPE,
  apply({ app }) {
    if (cancelChannelEditGestures(app)) return;
    const preview = app.store.preview;
    if (preview !== null && preview.active) {
      preview.cancel();
      return;
    }
    const state = app.session.getState();
    if (state.dialog !== null) {
      app.session.setState({ dialog: null });
      return;
    }
    if (state.time.playing) app.session.setState({ time: { ...state.time, playing: false } });
  },
});

export const EDIT_OPERATORS: readonly AnyOperator[] = [
  undo,
  redo,
  dispatcher('edit.copy', 'Copy', { pose: 'pose.copy', keys: 'graph.keys.copy' }),
  dispatcher('edit.paste', 'Paste', { pose: 'pose.paste', keys: 'graph.keys.paste' }),
  dispatcher('edit.delete', 'Delete', { pose: 'key.deleteAtFrame', keys: 'graph.keys.delete' }),
  escape,
  // M6a (M6A-SPEC §5.7; B11)
  adjustLast,
  repeatLastOperator,
];

/** The refusal of the latest Adjust Last (for UIs that report it next to the card). */
export { lastAdjustRefusal };
