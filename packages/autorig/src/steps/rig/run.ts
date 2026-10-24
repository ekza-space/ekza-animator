// Running the ③ compositions from the wizard (AUTORIG-SPEC §5.3 *Auto-rig ▸*, §5.4 progress, §4.5 exclusivity; D4; a
// lazy chunk shared by ② and ③). The orchestration is editor-core's `autorigFlow` (T5b, shared with Halo's *Rig it*):
// `runRig` runs `autorig.rig` with the shared argument rules (`straighten` from the session's start pose, a re-run
// only while `skel.tpose` is there; `rigidParts`; `confirm` when nothing was painted since the wizard's own bind),
// follows the stages (Create Skeleton → skin, Bind Skin → straighten or check, Straighten to T-Pose → check, with the
// bind's own fraction), measures a straighten's stretch and names the new character as the subject; `rebindSkin` is
// *Bind again* and Done's rebind. This module keeps `session.busy` for the whole run — so the frame's undo/redo keys
// and buttons stay off and the progress sheet is up — and ③'s view state: a re-run of a bound skeleton asks M6b's
// "Rebind replaces painted weights" first; a bind cancelled from the sheet (`autorig.cancel`) leaves the skeleton and
// ③ says so with *Bind again*. Nothing here writes the document: every change is an operator run.
import type { CharacterId } from '@ekza-studio/doc';
import {
  type AutoRigRigStage,
  bindPartsRigidly as flowBindPartsRigidly,
  cancelRig,
  type EditorApp,
  REBIND_CONFIRM,
  rebindSkin,
  rigidPartsOn as flowRigidPartsOn,
  runRig,
  wantsStraighten as flowWantsStraighten,
} from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import type { AutoRigSession } from '../../types';
import { flowHost } from '../model/flowHost';
import { rigUi } from './ui';
import '../markers/strings';
import './strings';

export { rebindUnasked, stageAfter, weightsKey } from '@ekza-studio/editor-core';

/** Whether a straighten is due (§4.3, §4.5): an A-posed input; on a re-run only while `skel.tpose` is still there. */
export function wantsStraighten(app: EditorApp, session: AutoRigSession): boolean {
  return flowWantsStraighten(app, session);
}

/**
 * *Separate parts move rigidly* (AR-R4-5): the slice's choice, else on for a multi-part subject (①'s ticked parts, or
 * the character's meshes) and off for one mesh.
 */
export function rigidPartsOn(app: EditorApp, session: AutoRigSession): boolean {
  return flowRigidPartsOn(app, { rigidParts: session.rig.rigidParts, subject: session.subject });
}

/** Binds the separate parts that reach two limbs again: rigidly to their best joint, a limb part over its own limb's
 *  joints (one Bind Skin per mask, `rigidPartBinds`). */
export function bindPartsRigidly(app: EditorApp, character: CharacterId): Promise<boolean> {
  return flowBindPartsRigidly({ app, quiet: (op, args) => app.runUntyped(op, args) }, character);
}

/** Writes the flow's stage into `session.busy` (the progress sheet). */
const busyStage =
  (ctx: Pick<WizardContext, 'session'>) =>
  (stage: AutoRigRigStage, fraction: number | null): void =>
    ctx.session.set({ busy: { stage, fraction } });

/** Resolves after the next frame (the sheet paints a stage), or at once without a window. */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** *Auto-rig ▸* (§5.3): runs `autorig.rig` and moves to ③. Resolves when it ended (any outcome). */
export async function runAutoRig(ctx: WizardContext, opts: { readonly confirm?: boolean } = {}): Promise<void> {
  const { session } = ctx;
  if (session.getState().busy !== null) return;
  const ui = rigUi(ctx);
  const outcome = await runRig(flowHost(ctx), {
    ...(opts.confirm === true ? { confirm: true } : {}),
    onPlan: (plan) => ui.set((current) => ({ ...current, plan, notice: null, error: null })),
    onStage: busyStage(ctx),
    // `check`: the sheet shows the stage for a frame, then the C7 rows of the new rig are derived
    beforeChecks: nextFrame,
  });
  if (outcome.status === 'skipped') return;
  if (outcome.status === 'finished') {
    session.patch('rig', { sub: 'review' });
    session.set({ busy: null });
    ui.set((current) => ({ ...current, plan: null }));
    ctx.go('rig');
    return;
  }
  session.set({ busy: null });
  ui.set((current) => ({ ...current, plan: null }));
  if (outcome.status === 'confirm-required') {
    const m = messages().markers;
    const ok = await ctx.host.confirm({ title: m.rebindTitle, text: REBIND_CONFIRM, confirmLabel: m.rebindConfirm });
    if (ok) await runAutoRig(ctx, { confirm: true });
    return;
  }
  // the steps already made stay (each undoable): a skeleton made before the stop makes ③ reachable
  if (outcome.status === 'cancelled') {
    ui.set((current) => ({ ...current, notice: 'cancelled' }));
    ctx.go('rig');
    return;
  }
  if (outcome.status === 'interrupted') {
    ui.set((current) => ({ ...current, notice: 'interrupted', error: outcome.message }));
    return;
  }
  ui.set((current) => ({ ...current, error: messages().markers.rigFailed(outcome.message) }));
}

/** `autorig.cancel` from the sheet (only during `skin`). */
export function cancelAutoRig(ctx: WizardContext): void {
  cancelRig(flowHost(ctx));
}

/**
 * A plain Bind Skin of the subject character with the wizard's busy state (*Bind again* after a cancel, Done after
 * *Adjust joints*): `confirm: true` reruns with the stored arguments without M6b's question; without it a bound mesh
 * gets the shared `rebindSkin` question (the host's dialog), and the run itself ends without a step. With `straighten`
 * (*Bind again* on an A-posed input, `wantsStraighten`) a finished bind is followed by Straighten to T-Pose while the
 * character still has its `skel.tpose` row — the same two-then-three steps as the first run's, and the sheet lists
 * *Straightening*. Done after *Adjust joints* never straightens (a `skel.tpose` row there is the joints' placement).
 */
export async function rebind(
  ctx: WizardContext,
  opts: { readonly confirm: boolean; readonly straighten?: boolean },
): Promise<boolean> {
  const { session } = ctx;
  const host = flowHost(ctx);
  if (session.getState().busy !== null) return false;
  const ui = rigUi(ctx);
  const straighten = opts.straighten === true;
  let started = false;
  try {
    const outcome = await rebindSkin(host, {
      confirm: opts.confirm,
      straighten,
      onStage: (stage, fraction) => {
        if (!started) {
          started = true;
          ui.set((current) => ({
            ...current,
            rebinding: true,
            notice: null,
            error: null,
            plan: straighten ? { bind: true, straighten } : current.plan,
          }));
        }
        busyStage(ctx)(stage, fraction);
      },
    });
    if (outcome.status === 'cancelled') ui.set((current) => ({ ...current, notice: 'cancelled' }));
    if (outcome.status === 'failed' && outcome.code !== 'op-refused' && outcome.code !== 'poll') {
      const error = outcome.message;
      ui.set((current) => ({ ...current, error }));
    }
    if (outcome.status !== 'finished') return false;
    if (outcome.straightenError !== null) {
      const error = messages().markers.rigFailed(outcome.straightenError);
      ui.set((current) => ({ ...current, error }));
    }
    return true;
  } finally {
    if (started) {
      session.set({ busy: null });
      ui.set((current) => ({ ...current, rebinding: false, ...(straighten ? { plan: null } : {}) }));
    }
  }
}
