// Running the ③ compositions from the wizard (AUTORIG-SPEC §5.3 *Auto-rig ▸*, §5.4 progress, §4.5 exclusivity; D4; a
// lazy chunk shared by ② and ③). `runAutoRig` runs `autorig.rig {straighten}` — `straighten` is the session's start
// pose (§4.3: 'a' straightens; a re-run straightens only while the character still has its `skel.tpose` row) — and
// keeps `session.busy` for its whole duration, so the frame's undo/redo keys and buttons stay off and the progress
// sheet is up. The stages come from the operators: the history's new top step (Create Skeleton → skin, Bind Skin →
// straighten or check, Straighten to T-Pose → check) and the bind's own `session.busy.progress` (meshes done / meshes).
// Afterwards: the subject is the new character, ③ opens in review; a re-run of a bound skeleton asks M6b's "Rebind
// replaces painted weights" first; a bind cancelled from the sheet (`autorig.cancel`) leaves the skeleton and ③ says
// so with *Bind again*. Nothing here writes the document: every change is an operator run.
import type { CharacterId } from '@ekza-studio/doc';
import {
  autoRigBindMeshes,
  autoRigRefitBound,
  type EditorApp,
  quickRigOf,
  REBIND_CONFIRM,
  rigidPartBinds,
} from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import { AUTORIG_PROFILE, resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';
import type { AutoRigSession, AutoRigStage } from '../../types';
import { watchStraighten } from './stretch';
import { rigUi } from './ui';
import '../markers/strings';
import './strings';

/** The undo labels of the inner steps (M6b's and A0's operators). */
const LABELS = {
  create: 'Create Skeleton',
  refit: 'Refit Skeleton',
  bind: 'Bind Skin',
  straighten: 'Straighten to T-Pose',
} as const;
/** `skin.bind`'s busy label (M6B-C4-15). */
const BINDING = 'Binding skin…';

/** The next stage after a step label appeared on top of the history. */
export function stageAfter(
  label: string | undefined,
  plan: { readonly bind: boolean; readonly straighten: boolean },
): AutoRigStage | null {
  if (label === LABELS.create || label === LABELS.refit) {
    return plan.bind ? 'skin' : plan.straighten ? 'straighten' : 'check';
  }
  if (label === LABELS.bind) return plan.straighten ? 'straighten' : 'check';
  if (label === LABELS.straighten) return 'check';
  return null;
}

/** Whether a straighten is due (§4.3, §4.5): an A-posed input; on a re-run only while `skel.tpose` is still there. */
export function wantsStraighten(app: EditorApp, session: AutoRigSession): boolean {
  if (session.startPose?.kind !== 'a') return false;
  const state = quickRigOf(app);
  if (state === null || state.refit === null) return true;
  const character = resolveSubject(app.store, session.subject).character;
  if (character === null || !app.rig.loaded) return true;
  return app.rig.validation.rows(character.id, AUTORIG_PROFILE).some((row) => row.code === 'skel.tpose');
}

/**
 * *Separate parts move rigidly* (AR-R4-5): the slice's choice, else on for a multi-part subject (①'s ticked parts, or
 * the character's meshes) and off for one mesh.
 */
export function rigidPartsOn(app: EditorApp, session: AutoRigSession): boolean {
  if (session.rig.rigidParts !== null) return session.rig.rigidParts;
  const character = resolveSubject(app.store, session.subject).character;
  const meshes = character === null ? session.subject.meshes.length : autoRigBindMeshes(app, character.id).length;
  return meshes > 1;
}

/** Binds the separate parts that reach two limbs rigidly to their best joint (one Bind Skin per joint). */
export async function bindPartsRigidly(app: EditorApp, character: CharacterId): Promise<boolean> {
  for (const group of rigidPartBinds(app, character)) {
    const result = await app.runUntyped('skin.bind', {
      meshes: group.meshes,
      method: 'rigid-islands',
      joints: [group.joint],
      confirm: true,
    });
    if (result.status !== 'finished') return false;
  }
  return true;
}

/** Follows the running composition into `session.busy` (stage and fraction); the disposer stops it. */
function trackStages(
  ctx: WizardContext,
  plan: { readonly bind: boolean; readonly straighten: boolean },
  initial: AutoRigStage = 'skeleton',
): () => void {
  const { app, session } = ctx;
  let stage: AutoRigStage = initial;
  const write = (): void => {
    const busy = app.session.getState().busy;
    const fraction = stage === 'skin' && busy?.label === BINDING ? busy.progress : null;
    session.set({ busy: { stage, fraction } });
  };
  const offHistory = app.history.subscribe(() => {
    const next = stageAfter(app.history.peekUndo()?.label, plan);
    if (next !== null && next !== stage) {
      stage = next;
      write();
    }
  });
  const offSession = app.session.subscribe((state, previous) => {
    if (state.busy !== previous.busy && stage === 'skin') write();
  });
  write();
  return () => {
    offHistory();
    offSession();
  };
}

/** Resolves after the next frame (the sheet paints a stage), or at once without a window. */
function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** After a run: the subject names the character it made (Create Skeleton adopted the scene meshes). */
function adoptSubject(ctx: WizardContext, character: CharacterId | null): void {
  const subject = ctx.session.getState().subject;
  const resolved = character ?? resolveSubject(ctx.app.store, subject).character?.id ?? null;
  if (resolved !== null && resolved !== subject.character) {
    ctx.session.set({ subject: { character: resolved, meshes: subject.meshes } });
  }
}

/** The bound meshes of a character and their revisions (`id:manifest`), or null without a bound mesh (AR-D8-8). */
export function weightsKey(app: EditorApp, character: CharacterId | null): string | null {
  if (character === null) return null;
  const parts = app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.skin !== null && 'skeleton' in mesh.skin && mesh.data !== null)
    .map((mesh) => `${mesh.id}:${mesh.data?.manifest}`);
  return parts.length === 0 ? null : parts.join('|');
}

/**
 * Whether a re-rig (a refit that rebinds) skips M6b's rebind question (AR-D8-8): nothing was painted since the
 * wizard's own bind — the flag is clear and the bound meshes are the revisions that bind wrote.
 */
export function rebindUnasked(
  plan: { readonly bind: boolean },
  painted: boolean,
  boundKey: string | null,
  nowKey: string | null,
): boolean {
  return !plan.bind && !painted && boundKey !== null && boundKey === nowKey;
}

/** Records the weights the wizard's own bind wrote (a later re-rig with these weights asks nothing). */
function rememberBound(ctx: WizardContext, character: CharacterId | null): void {
  const boundKey = weightsKey(ctx.app, character);
  rigUi(ctx).set((current) => ({ ...current, boundKey }));
}

/** *Auto-rig ▸* (§5.3): runs `autorig.rig` and moves to ③. Resolves when it ended (any outcome). */
export async function runAutoRig(ctx: WizardContext, opts: { readonly confirm?: boolean } = {}): Promise<void> {
  const { app, session } = ctx;
  const state = quickRigOf(app);
  if (state === null || session.getState().busy !== null) return;
  const ui = rigUi(ctx);
  const straighten = wantsStraighten(app, session.getState());
  // the operator's own rule (`autoRigRefitBound`): a refit of a bound skeleton rebinds inside the commit
  const plan = { bind: !autoRigRefitBound(app, state.refit), straighten };
  // AR-D8-8: weights exactly as the wizard's own bind wrote them (nothing painted since, here or in Studio) lose
  // nothing in the refit's rebind, so M6b's "Rebind replaces painted weights" is not asked
  const current = resolveSubject(app.store, session.getState().subject).character?.id ?? null;
  const unpainted = rebindUnasked(
    plan,
    session.getState().rig.paintedSinceBind,
    ui.get().boundKey,
    weightsKey(app, current),
  );
  ui.set((current) => ({ ...current, plan, notice: null, error: null }));
  const stop = trackStages(ctx, plan);
  const straightened = watchStraighten(ctx);
  let result: Awaited<ReturnType<EditorApp['runUntyped']>>;
  try {
    result = await app.runUntyped('autorig.rig', {
      straighten,
      rigidParts: rigidPartsOn(app, session.getState()),
      ...(opts.confirm === true || unpainted ? { confirm: true } : {}),
    });
    await straightened.done();
  } catch (error) {
    result = { status: 'failed', error: { code: 'internal', message: String(error) } };
  } finally {
    stop();
    straightened.stop();
  }
  if (result.status === 'finished') {
    session.set({ busy: { stage: 'check', fraction: null } });
    const value = result.value as { readonly character: CharacterId };
    adoptSubject(ctx, value.character);
    // `check`: the sheet shows the stage for a frame, then the C7 rows of the new rig are derived (and cached: ③'s
    // summary reads them again)
    await nextFrame();
    if (app.rig.loaded) app.rig.validation.rows(value.character, AUTORIG_PROFILE);
    session.patch('rig', { sub: 'review', paintedSinceBind: false });
    rememberBound(ctx, value.character);
    session.set({ busy: null });
    ui.set((current) => ({ ...current, plan: null }));
    ctx.go('rig');
    return;
  }
  session.set({ busy: null });
  ui.set((current) => ({ ...current, plan: null }));
  const code = result.status === 'failed' ? result.error.code : 'poll';
  const message = result.status === 'failed' ? result.error.message : result.reason;
  if (code === 'confirm-required') {
    const m = messages().markers;
    const ok = await ctx.host.confirm({ title: m.rebindTitle, text: REBIND_CONFIRM, confirmLabel: m.rebindConfirm });
    if (ok) await runAutoRig(ctx, { confirm: true });
    return;
  }
  // the steps already made stay (each undoable): a skeleton made before the stop makes ③ reachable
  adoptSubject(ctx, null);
  if (code === 'cancelled') {
    ui.set((current) => ({ ...current, notice: 'cancelled' }));
    ctx.go('rig');
    return;
  }
  if (message === messages().rig.interrupted) {
    ui.set((current) => ({ ...current, notice: 'interrupted', error: message }));
    return;
  }
  ui.set((current) => ({ ...current, error: messages().markers.rigFailed(message) }));
}

/** `autorig.cancel` from the sheet (only during `skin`). */
export function cancelAutoRig(ctx: WizardContext): void {
  void ctx.app.runUntyped('autorig.cancel');
}

/**
 * A plain Bind Skin of the subject character with the wizard's busy state (*Bind again* after a cancel, Done after
 * *Adjust joints*): `confirm: true` reruns with the stored arguments without M6b's question; without it a bound mesh
 * gets the shared `rebindSkin` question (the host's dialog), and the run itself ends without a step. With `straighten`
 * (*Bind again* on an A-posed input, `wantsStraighten`) a finished bind is followed by Straighten to T-Pose
 * (`skel.pose.applyAsRest {character, pose: 'tStance'}`, A0) while the character still has its `skel.tpose` row — the
 * same two-then-three steps as the first run's, and the sheet lists *Straightening*. Done after *Adjust joints* never
 * straightens (a `skel.tpose` row there is the joints' placement, §5.4).
 */
export async function rebind(
  ctx: WizardContext,
  opts: { readonly confirm: boolean; readonly straighten?: boolean },
): Promise<boolean> {
  const { app, session } = ctx;
  const character = resolveSubject(app.store, session.getState().subject).character;
  if (character === null || session.getState().busy !== null) return false;
  const ui = rigUi(ctx);
  const straighten = opts.straighten === true;
  ui.set((current) => ({
    ...current,
    rebinding: true,
    notice: null,
    error: null,
    plan: straighten ? { bind: true, straighten } : current.plan,
  }));
  const stop = trackStages(ctx, { bind: true, straighten }, 'skin');
  try {
    const result = await app.runUntyped('skin.bind', {
      meshes: autoRigBindMeshes(app, character.id),
      ...(opts.confirm ? { confirm: true } : {}),
    });
    if (result.status === 'failed' && result.error.code !== 'op-refused' && result.error.code !== 'cancelled') {
      ui.set((current) => ({ ...current, error: result.error.message }));
    }
    if (result.status === 'failed' && result.error.code === 'cancelled') {
      ui.set((current) => ({ ...current, notice: 'cancelled' }));
    }
    if (result.status !== 'finished') return false;
    // AR-R4-5: a full bind gives every part automatic weights again; the separate parts go rigid once more
    if (rigidPartsOn(app, session.getState())) await bindPartsRigidly(app, character.id);
    rememberBound(ctx, character.id);
    if (straighten && hasTposeRow(app, character.id)) {
      const straightened = await app.runUntyped('skel.pose.applyAsRest', { character: character.id, pose: 'tStance' });
      if (straightened.status === 'failed') {
        ui.set((current) => ({ ...current, error: messages().markers.rigFailed(straightened.error.message) }));
      } else rememberBound(ctx, character.id);
    }
    return true;
  } finally {
    stop();
    session.set({ busy: null });
    ui.set((current) => ({ ...current, rebinding: false, ...(straighten ? { plan: null } : {}) }));
  }
}

/** Whether the character's Validation holds `skel.tpose` under the wizard's profile. */
function hasTposeRow(app: EditorApp, character: CharacterId): boolean {
  return app.rig.loaded && app.rig.validation.rows(character, AUTORIG_PROFILE).some((row) => row.code === 'skel.tpose');
}
