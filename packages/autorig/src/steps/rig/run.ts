// Running the ③ compositions from the wizard (AUTORIG-SPEC §5.3 *Auto-rig ▸*, §5.4 progress, §4.5 exclusivity; D4; a
// lazy chunk shared by ② and ③). `runAutoRig` runs `autorig.rig {straighten}` — `straighten` is the session's start
// pose (§4.3: 'a' straightens; a re-run straightens only while the character still has its `skel.tpose` row) — and
// keeps `session.busy` for its whole duration, so the frame's undo/redo keys and buttons stay off and the progress
// sheet is up. The stages come from the operators: the history's new top step (Create Skeleton → skin, Bind Skin →
// straighten or check, Straighten to T-Pose → check) and the bind's own `session.busy.progress` (meshes done / meshes).
// Afterwards: the subject is the new character, ③ opens in review; a re-run of a bound skeleton asks M6b's "Rebind
// replaces painted weights" first; a bind cancelled from the sheet (`autorig.cancel`) leaves the skeleton and ③ says
// so with *Bind again*. Nothing here writes the document: every change is an operator run.
import type { CharacterId, MeshId } from '@ekza-studio/doc';
import { type EditorApp, quickRigOf, REBIND_CONFIRM } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import { AUTORIG_PROFILE, resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';
import type { AutoRigSession, AutoRigStage } from '../../types';
import { rigUi } from './ui';

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

/** The live meshes of a character (Bind Skin's targets). */
export function characterMeshes(app: EditorApp, character: CharacterId): MeshId[] {
  return app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.data !== null)
    .map((mesh) => mesh.id);
}

/** After a run: the subject names the character it made (Create Skeleton adopted the scene meshes). */
function adoptSubject(ctx: WizardContext, character: CharacterId | null): void {
  const subject = ctx.session.getState().subject;
  const resolved = character ?? resolveSubject(ctx.app.store, subject).character?.id ?? null;
  if (resolved !== null && resolved !== subject.character) {
    ctx.session.set({ subject: { character: resolved, meshes: subject.meshes } });
  }
}

/** *Auto-rig ▸* (§5.3): runs `autorig.rig` and moves to ③. Resolves when it ended (any outcome). */
export async function runAutoRig(ctx: WizardContext, opts: { readonly confirm?: boolean } = {}): Promise<void> {
  const { app, session } = ctx;
  const state = quickRigOf(app);
  if (state === null || session.getState().busy !== null) return;
  const ui = rigUi(ctx);
  const straighten = wantsStraighten(app, session.getState());
  const refitBound = state.refit !== null && app.store.query.meshesBoundTo(state.refit).length > 0;
  const plan = { bind: !refitBound, straighten };
  ui.set((current) => ({ ...current, plan, notice: null, error: null }));
  const stop = trackStages(ctx, plan);
  let result: Awaited<ReturnType<EditorApp['runUntyped']>>;
  try {
    result = await app.runUntyped('autorig.rig', { straighten, ...(opts.confirm === true ? { confirm: true } : {}) });
  } catch (error) {
    result = { status: 'failed', error: { code: 'internal', message: String(error) } };
  } finally {
    stop();
  }
  if (result.status === 'finished') {
    session.set({ busy: { stage: 'check', fraction: null } });
    const value = result.value as { readonly character: CharacterId };
    adoptSubject(ctx, value.character);
    // `check`: the C7 rows of the new rig (derived and cached; ③'s summary reads them again)
    if (app.rig.loaded) app.rig.validation.rows(value.character, AUTORIG_PROFILE);
    session.patch('rig', { sub: 'review', paintedSinceBind: false });
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
 * gets the shared `rebindSkin` question (the host's dialog), and the run itself ends without a step.
 */
export async function rebind(ctx: WizardContext, opts: { readonly confirm: boolean }): Promise<boolean> {
  const { app, session } = ctx;
  const character = resolveSubject(app.store, session.getState().subject).character;
  if (character === null || session.getState().busy !== null) return false;
  const ui = rigUi(ctx);
  ui.set((current) => ({ ...current, rebinding: true, notice: null, error: null }));
  const stop = trackStages(ctx, { bind: true, straighten: false }, 'skin');
  try {
    const result = await app.runUntyped('skin.bind', {
      meshes: characterMeshes(app, character.id),
      ...(opts.confirm ? { confirm: true } : {}),
    });
    if (result.status === 'failed' && result.error.code !== 'op-refused' && result.error.code !== 'cancelled') {
      ui.set((current) => ({ ...current, error: result.error.message }));
    }
    if (result.status === 'failed' && result.error.code === 'cancelled') {
      ui.set((current) => ({ ...current, notice: 'cancelled' }));
    }
    return result.status === 'finished';
  } finally {
    stop();
    session.set({ busy: null });
    ui.set((current) => ({ ...current, rebinding: false }));
  }
}
