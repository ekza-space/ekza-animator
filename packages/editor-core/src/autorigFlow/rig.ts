// ③ rig, bind and straighten (AUTORIG-SPEC §5.3 *Auto-rig ▸*, §5.4, §4.5, §6.1; AR-D8-8, AR-R4-3, AR-R4-5; moved
// from Auto-Rig ②/③ by T5b; STUDIO-TOUCH-SPEC §12.2 step 4 *Rig it*). `runRig` runs `autorig.rig` with the argument
// rules both shells share: `straighten` from the recorded start pose (an A-posed input straightens; a re-run only
// while the character still has its `skel.tpose` row), `rigidParts` from the person's choice or the part count, and
// `confirm` when nothing was painted since the flow's own bind (the refit's rebind loses nothing, so M6b's question is
// not asked). It follows the composition's stages for the shell's progress (the history's new top step and the bind's
// own `session.busy.progress`), measures a straighten's stretch, and afterwards names the new character as the
// subject. A bound re-run without `confirm` comes back as `confirm-required` (the shell asks M6b's question and runs
// again with `confirm`); a bind cancelled from the progress (`cancelRig`) leaves the skeleton. `rebindSkin` is the
// plain Bind Skin of *Bind again* and *Done* after *Adjust joints* (the rigid parts again, a straighten when asked).
// Nothing here writes the document: every change is an operator run.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import { quickRigOf } from '../operators/builtin/rig/quickRigSession';
import { autoRigBindMeshes, autoRigRefitBound } from '../operators/builtin/rig/wizard/targets';
import { rigidPartBinds } from '../rig/validation/limbs';
import type { EditorApp } from '../types';
import { type AutoRigFlowHost, type AutoRigFlowState, runMessage } from './host';
import { watchStraighten } from './straighten';
import { AUTORIG_FLOW_PROFILE, flowCharacterId, resolveAutoRigSubject } from './subject';

/** The undo labels of the inner steps (M6b's and A0's operators). */
export const AUTORIG_RIG_LABELS = {
  create: 'Create Skeleton',
  refit: 'Refit Skeleton',
  bind: 'Bind Skin',
  straighten: 'Straighten to T-Pose',
} as const;

/** `skin.bind`'s busy label (M6B-C4-15). */
export const BINDING_LABEL = 'Binding skin…';

/** `autorig.rig`'s stop message (§4.5 exclusivity; the composition's `COMPOSITION_INTERRUPTED`, in the rig chunk). */
export const RIG_INTERRUPTED = 'Rigging was interrupted by another change';

/** What a run of `autorig.rig` will do: bind (no refit of a bound skeleton) and straighten. */
export interface AutoRigRigPlan {
  readonly bind: boolean;
  readonly straighten: boolean;
}

/** A stage of the running composition (the shells' progress). */
export type AutoRigRigStage = 'skeleton' | 'skin' | 'straighten' | 'check';

/** Reports a stage and the bind's fraction (meshes done / meshes, null = indeterminate). */
export type OnRigStage = (stage: AutoRigRigStage, fraction: number | null) => void;

/** The next stage after a step label appeared on top of the history. */
export function stageAfter(label: string | undefined, plan: AutoRigRigPlan): AutoRigRigStage | null {
  if (label === AUTORIG_RIG_LABELS.create || label === AUTORIG_RIG_LABELS.refit) {
    return plan.bind ? 'skin' : plan.straighten ? 'straighten' : 'check';
  }
  if (label === AUTORIG_RIG_LABELS.bind) return plan.straighten ? 'straighten' : 'check';
  if (label === AUTORIG_RIG_LABELS.straighten) return 'check';
  return null;
}

/** Whether the character's Validation holds `skel.tpose` under the flow's profile. */
export function hasTposeRow(app: EditorApp, character: CharacterId): boolean {
  return (
    app.rig.loaded && app.rig.validation.rows(character, AUTORIG_FLOW_PROFILE).some((row) => row.code === 'skel.tpose')
  );
}

/** Whether a straighten is due (§4.3, §4.5): an A-posed input; on a re-run only while `skel.tpose` is still there. */
export function wantsStraighten(app: EditorApp, state: Pick<AutoRigFlowState, 'startPose' | 'subject'>): boolean {
  if (state.startPose?.kind !== 'a') return false;
  const quickRig = quickRigOf(app);
  if (quickRig === null || quickRig.refit === null) return true;
  const character = resolveAutoRigSubject(app.store, state.subject).character;
  if (character === null || !app.rig.loaded) return true;
  return hasTposeRow(app, character.id);
}

/**
 * *Separate parts move rigidly* (AR-R4-5): the person's choice, else on for a multi-part subject (the ticked parts, or
 * the character's meshes) and off for one mesh.
 */
export function rigidPartsOn(app: EditorApp, state: Pick<AutoRigFlowState, 'rigidParts' | 'subject'>): boolean {
  if (state.rigidParts !== null) return state.rigidParts;
  const character = resolveAutoRigSubject(app.store, state.subject).character;
  const meshes = character === null ? state.subject.meshes.length : autoRigBindMeshes(app, character.id).length;
  return meshes > 1;
}

/**
 * Binds the separate parts that reach two limbs again: rigidly to their best joint, a limb part over its own limb's
 * joints (one Bind Skin per mask, `rigidPartBinds`). False when one did not finish.
 */
export async function bindPartsRigidly(
  host: Pick<AutoRigFlowHost, 'app' | 'quiet'>,
  character: CharacterId,
): Promise<boolean> {
  for (const group of rigidPartBinds(host.app, character)) {
    const result = await host.quiet('skin.bind', {
      meshes: group.meshes,
      ...(group.rigid ? { method: 'rigid-islands' } : {}),
      joints: group.joints,
      confirm: true,
    });
    if (result.status !== 'finished') return false;
  }
  return true;
}

/**
 * Follows a running composition: the stage from the history's new top step, the fraction from the bind's own busy
 * state while skinning. Reports the initial stage at once; the disposer stops it.
 */
export function followRigStages(
  app: EditorApp,
  plan: AutoRigRigPlan,
  onStage: OnRigStage,
  initial: AutoRigRigStage = 'skeleton',
): Disposer {
  let stage: AutoRigRigStage = initial;
  const write = (): void => {
    const busy = app.session.getState().busy;
    onStage(stage, stage === 'skin' && busy?.label === BINDING_LABEL ? busy.progress : null);
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
 * Whether a re-rig (a refit that rebinds) skips M6b's rebind question (AR-D8-8): nothing was painted since the flow's
 * own bind — the flag is clear and the bound meshes are the revisions that bind wrote.
 */
export function rebindUnasked(
  plan: Pick<AutoRigRigPlan, 'bind'>,
  painted: boolean,
  boundKey: string | null,
  nowKey: string | null,
): boolean {
  return !plan.bind && !painted && boundKey !== null && boundKey === nowKey;
}

/** Records the weights the flow's own bind wrote (a later re-rig with these weights asks nothing). */
export function rememberBound(host: Pick<AutoRigFlowHost, 'app' | 'state'>, character: CharacterId | null): void {
  host.state.set({ boundKey: weightsKey(host.app, character) });
}

/** After a run: the subject names the character it made (Create Skeleton adopted the scene meshes). */
export function adoptRiggedSubject(host: Pick<AutoRigFlowHost, 'app' | 'state'>, character: CharacterId | null): void {
  const subject = host.state.get().subject;
  const resolved = character ?? resolveAutoRigSubject(host.app.store, subject).character?.id ?? null;
  if (resolved !== null && resolved !== subject.character) {
    host.state.set({ subject: { character: resolved, meshes: subject.meshes } });
  }
}

/** The plan and the arguments `autorig.rig` runs with now (null while Quick Rig is closed). */
export function rigRunArgs(
  host: Pick<AutoRigFlowHost, 'app' | 'state'>,
  opts: { readonly confirm?: boolean } = {},
): {
  readonly plan: AutoRigRigPlan;
  readonly args: { readonly straighten: boolean; readonly rigidParts: boolean; readonly confirm?: true };
} | null {
  const { app } = host;
  const quickRig = quickRigOf(app);
  if (quickRig === null) return null;
  const state = host.state.get();
  const straighten = wantsStraighten(app, state);
  // the operator's own rule (`autoRigRefitBound`): a refit of a bound skeleton rebinds inside the commit
  const plan: AutoRigRigPlan = { bind: !autoRigRefitBound(app, quickRig.refit), straighten };
  // AR-D8-8: weights exactly as the flow's own bind wrote them (nothing painted since, here or in Studio) lose nothing
  // in the refit's rebind, so M6b's "Rebind replaces painted weights" is not asked
  const unpainted = rebindUnasked(plan, state.paintedSinceBind, state.boundKey, weightsKey(app, flowCharacterId(host)));
  return {
    plan,
    args: {
      straighten,
      rigidParts: rigidPartsOn(app, state),
      ...(opts.confirm === true || unpainted ? { confirm: true as const } : {}),
    },
  };
}

export type AutoRigRigOutcome =
  /** Quick Rig is not open: nothing ran. */
  | { readonly status: 'skipped' }
  | { readonly status: 'finished'; readonly character: CharacterId; readonly plan: AutoRigRigPlan }
  /** A bound re-run needs M6b's "Rebind replaces painted weights" answer: ask, then run again with `confirm`. */
  | { readonly status: 'confirm-required'; readonly message: string; readonly plan: AutoRigRigPlan }
  /** The bind was cancelled (`cancelRig`): the skeleton stays. */
  | { readonly status: 'cancelled'; readonly plan: AutoRigRigPlan }
  /** The history changed under the composition (§4.5): the steps already made stay. */
  | { readonly status: 'interrupted'; readonly message: string; readonly plan: AutoRigRigPlan }
  | { readonly status: 'failed'; readonly code: string; readonly message: string; readonly plan: AutoRigRigPlan };

export interface AutoRigRigOptions {
  /** The person answered M6b's rebind question (*Rebind*). */
  readonly confirm?: boolean;
  /** The composition's stages (the shell's progress sheet or story line). */
  readonly onStage?: OnRigStage;
  /** Called with the plan before `autorig.rig` runs (the shell shows the stages it will go through). */
  readonly onPlan?: (plan: AutoRigRigPlan) => void;
  /** Awaited after a finished run, before the checks are read (the wizard paints the `check` stage for a frame). */
  readonly beforeChecks?: () => Promise<void>;
}

/** *Auto-rig ▸* / *Rig it* (§5.3, §4.5): `autorig.rig` with the shared argument rules; see the header. */
export async function runRig(host: AutoRigFlowHost, opts: AutoRigRigOptions = {}): Promise<AutoRigRigOutcome> {
  const { app } = host;
  const planned = rigRunArgs(host, opts);
  if (planned === null) return { status: 'skipped' };
  const { plan, args } = planned;
  opts.onPlan?.(plan);
  const stop = followRigStages(app, plan, opts.onStage ?? (() => {}));
  const straightened = watchStraighten(
    app,
    () => flowCharacterId(host),
    (value) => host.state.set({ straightened: value }),
  );
  let result: Awaited<ReturnType<EditorApp['runUntyped']>>;
  try {
    result = await host.quiet('autorig.rig', args);
    await straightened.done();
  } catch (error) {
    result = { status: 'failed', error: { code: 'internal', message: String(error) } };
  } finally {
    stop();
    straightened.stop();
  }
  if (result.status === 'finished') {
    opts.onStage?.('check', null);
    const value = result.value as { readonly character: CharacterId };
    adoptRiggedSubject(host, value.character);
    await opts.beforeChecks?.();
    // `check`: the C7 rows of the new rig are derived (and cached: the shells' summaries read them again)
    if (app.rig.loaded) app.rig.validation.rows(value.character, AUTORIG_FLOW_PROFILE);
    host.state.set({ paintedSinceBind: false });
    rememberBound(host, value.character);
    return { status: 'finished', character: value.character, plan };
  }
  const code = result.status === 'failed' ? result.error.code : 'poll';
  const message = runMessage(result);
  if (code === 'confirm-required') return { status: 'confirm-required', message, plan };
  // the steps already made stay (each undoable): a skeleton made before the stop is the subject
  adoptRiggedSubject(host, null);
  if (code === 'cancelled') return { status: 'cancelled', plan };
  if (message === RIG_INTERRUPTED) return { status: 'interrupted', message, plan };
  return { status: 'failed', code, message, plan };
}

/** Cancels a running bind (`autorig.cancel`, only while skinning): the skeleton made before it stays. */
export function cancelRig(host: Pick<AutoRigFlowHost, 'quiet'>): void {
  void host.quiet('autorig.cancel');
}

export type AutoRigRebindOutcome =
  /** No subject character. */
  | { readonly status: 'skipped' }
  /** The bind was refused (the rebind question declined) or failed: `message` for a failure worth showing. */
  | { readonly status: 'failed'; readonly code: string; readonly message: string }
  | { readonly status: 'cancelled' }
  /** Bound (with the rigid parts again); `straightenError` when the straighten that followed failed. */
  | { readonly status: 'finished'; readonly straightenError: string | null };

export interface AutoRigRebindOptions {
  /** Rerun with the stored arguments without M6b's question (nothing painted since the last bind). */
  readonly confirm: boolean;
  /** Straighten to T-Pose after the bind while `skel.tpose` is there (*Bind again* on an A-posed input). */
  readonly straighten?: boolean;
  readonly onStage?: OnRigStage;
}

/**
 * A plain Bind Skin of the subject character (*Bind again* after a cancel, *Done* after *Adjust joints*):
 * `confirm: true` reruns with the stored arguments without M6b's question; without it a bound mesh gets the shared
 * `rebindSkin` question (the host's dialog). A finished bind binds the separate parts rigidly again when that is on,
 * and with `straighten` is followed by Straighten to T-Pose (`skel.pose.applyAsRest {character, pose: 'tStance'}`,
 * A0) while the character still has its `skel.tpose` row — the same steps as the first run's. *Done* after *Adjust
 * joints* never straightens (a `skel.tpose` row there is the joints' placement, §5.4).
 */
export async function rebindSkin(host: AutoRigFlowHost, opts: AutoRigRebindOptions): Promise<AutoRigRebindOutcome> {
  const { app } = host;
  const character = resolveAutoRigSubject(app.store, host.state.get().subject).character;
  if (character === null) return { status: 'skipped' };
  const straighten = opts.straighten === true;
  const stop = followRigStages(app, { bind: true, straighten }, opts.onStage ?? (() => {}), 'skin');
  try {
    const result = await host.quiet('skin.bind', {
      meshes: autoRigBindMeshes(app, character.id),
      ...(opts.confirm ? { confirm: true } : {}),
    });
    if (result.status === 'failed' && result.error.code === 'cancelled') return { status: 'cancelled' };
    if (result.status !== 'finished') {
      return {
        status: 'failed',
        code: result.status === 'failed' ? result.error.code : 'poll',
        message: runMessage(result),
      };
    }
    // AR-R4-5: a full bind gives every part automatic weights again; the separate parts go rigid once more
    if (rigidPartsOn(app, host.state.get())) await bindPartsRigidly(host, character.id);
    rememberBound(host, character.id);
    let straightenError: string | null = null;
    if (straighten && hasTposeRow(app, character.id)) {
      const straightened = await host.quiet('skel.pose.applyAsRest', { character: character.id, pose: 'tStance' });
      if (straightened.status === 'failed') straightenError = straightened.error.message;
      else rememberBound(host, character.id);
    }
    return { status: 'finished', straightenError };
  } finally {
    stop();
  }
}
