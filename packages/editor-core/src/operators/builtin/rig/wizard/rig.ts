// Auto-Rig ③ Rig compositions (AUTORIG-SPEC §4.5, §5.4, §6.1; D4). Both are thin compositions in the rig-workspace
// chunk: no undo flag of their own, the inner operators record the steps.
//
// - `autorig.rig {straighten?}`: Create Skeleton (`skel.quickRig.commit` with `quickRigCommitArgs` of the open Quick
//   Rig session; refused with `quickRigCommitBlock`'s reason), then Bind Skin (`skin.bind` with the M6b defaults over
//   the new character's meshes; Skin mode opens, M6B-AF-1), then — **only** when the caller says the input was A-posed
//   (`straighten: true`; the Auto-Rig shell passes `session.startPose.kind === 'a'`, headless callers decide, default
//   false) — Straighten to T-Pose (`skel.pose.applyAsRest {character, pose: 'tStance'}`, A0). Two or three undo steps.
//   It never straightens because of the post-bind Validation: on a T-posed input a `skel.tpose` row means a joint
//   placement problem, which ③ shows with *Adjust joints* (§5.4).
//   The M6b re-run (② after ③: Quick Rig seeded from the joints, `refit` set): the commit refits the skeleton in place
//   and rebinds its bound meshes itself, so no second Bind Skin runs; a bound skeleton needs the M6b question first —
//   without `confirm: true` (an untyped extra argument, as the commit's own; for D7 to type in `OperatorMap`) the run
//   fails with the commit's `confirm-required` "Rebind replaces painted weights", and the shell asks and runs again.
//   While it runs, `session.busy` holds "Rigging…" (the bind shows its own "Binding skin…" with the meshes' fraction),
//   and §4.5's exclusivity rule stops it — "Rigging was interrupted by another change" — when the history changes
//   under it (an undo, a palette or MCP-bridge run) or the subject goes away; the steps already made stay.
// - `autorig.cancel`: aborts a running bind through the skin service's `cancel()` (M6B-C4-15; not on the contract
//   type, so the call stays in this chunk): the pending bind rejects with `cancelled`, the skeleton (the first step)
//   stays. U state, no step.
import { EkzaError } from '@ekza-studio/anim-core';
import type { CharacterId, MeshId, SkeletonId } from '@ekza-studio/doc';
import type { AutoRigRigResult, EditorApp, PollResult } from '../../../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from '../../define';
import { quickRigCommitArgs, quickRigCommitBlock, quickRigOf } from '../quickRigSession';
import { type CompositionStep, runComposition } from './compose';

/** The poll reason while no Quick Rig session is open (② places the markers). */
export const NO_MARKERS = 'Place the markers first (Quick Rig is not open)';
/** The poll reason of `autorig.cancel` when no bind is running. */
export const NOTHING_TO_CANCEL = 'No skinning is running';
/** `session.busy`'s label while `autorig.rig` runs (the bind shows its own). */
export const RIGGING_LABEL = 'Rigging…';

/** The prepared runs of an app: the second poll (after `prepare`) passes for them, although Quick Rig closed. */
const prepared = new WeakSet<EditorApp>();

function argsProblem(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  if (!isRecord(args)) return 'expects { straighten? }';
  if (args['straighten'] !== undefined && typeof args['straighten'] !== 'boolean') {
    return 'straighten must be true or false';
  }
  if (args['confirm'] !== undefined && typeof args['confirm'] !== 'boolean') return 'confirm must be true or false';
  return null;
}

const flag = (args: unknown, key: 'straighten' | 'confirm'): boolean => isRecord(args) && args[key] === true;

/** The meshes of a character that Bind Skin binds (live, with data). */
function characterMeshes(app: EditorApp, character: CharacterId): MeshId[] {
  return app.store.query
    .meshesOfOwner(character)
    .filter((mesh) => mesh.deleted === null && mesh.data !== null)
    .map((mesh) => mesh.id);
}

const rig = defineOperator<'autorig.rig', AutoRigRigResult>({
  id: 'autorig.rig',
  label: 'Auto-Rig',
  description:
    'Creates the skeleton from the Quick Rig markers, binds the skin and, for an A-posed input, straightens it to a ' +
    'T-pose (§4.5).',
  category: 'autorig',
  scope: 'global',
  poll({ app }, args): PollResult {
    const problem = argsProblem(args);
    if (problem !== null) return fail(problem);
    // after `prepare` (the composition closed Quick Rig)
    if (prepared.has(app)) return OK;
    const state = quickRigOf(app);
    if (state === null) return fail(NO_MARKERS);
    const block = quickRigCommitBlock(state);
    return block === null ? OK : fail(block);
  },
  async prepare({ app }, args): Promise<AutoRigRigResult> {
    const state = quickRigOf(app);
    if (state === null) throw new EkzaError('op-refused', NO_MARKERS);
    const block = quickRigCommitBlock(state);
    if (block !== null) throw new EkzaError('op-refused', block);
    const straighten = flag(args, 'straighten');
    const commitArgs = { ...quickRigCommitArgs(state), ...(flag(args, 'confirm') ? { confirm: true } : {}) };
    // The M6b re-run: the commit refits in place and rebinds the skeleton's bound meshes itself.
    const refitBound =
      state.refit !== null && app.store.query.meshesBoundTo(state.refit).some((mesh) => mesh.deleted === null);

    let character: CharacterId | null = null;
    let committed = false;
    const busy = (): void => {
      if (app.session.getState().busy === null)
        app.session.setState({ busy: { label: RIGGING_LABEL, progress: null } });
    };
    // Every step after the commit: the subject is the new character from then on (its id comes with the commit's
    // value, read by the step's args; the step right after the commit is covered by the history check).
    const after = (): void => {
      committed = true;
      busy();
    };
    const made = (values: readonly unknown[]): CharacterId => {
      const value = values[0] as { readonly character: CharacterId; readonly skeleton: SkeletonId };
      character = value.character;
      return value.character;
    };
    const steps: CompositionStep[] = [{ id: 'skel.quickRig.commit', args: commitArgs, before: busy }];
    if (!refitBound) {
      steps.push({
        id: 'skin.bind',
        before: after,
        args: (values: readonly unknown[]) => ({ meshes: characterMeshes(app, made(values)) }),
      });
    }
    if (straighten) {
      steps.push({
        id: 'skel.pose.applyAsRest',
        before: after,
        args: (values: readonly unknown[]) => ({ character: made(values), pose: 'tStance' }),
      });
    }
    const alive = (): boolean =>
      committed
        ? character === null || app.store.get('characters', character) !== undefined
        : state.meshes.some((id) => app.store.get('meshes', id) !== undefined);

    busy();
    let result: AutoRigRigResult;
    try {
      const outcome = await runComposition(app, steps, { alive });
      if (outcome.status === 'interrupted') throw new EkzaError('op-refused', outcome.message);
      if (outcome.status === 'failed') throw new EkzaError(outcome.code, outcome.message);
      const value = outcome.values[0] as { readonly character: CharacterId; readonly skeleton: SkeletonId };
      result = { character: value.character, skeleton: value.skeleton, straightened: straighten };
    } finally {
      if (app.session.getState().busy?.label === RIGGING_LABEL) app.session.setState({ busy: null });
    }
    prepared.add(app);
    return result;
  },
  apply({ app }, _args, result) {
    prepared.delete(app);
    return result;
  },
});

/** The skin service's cancel (implemented in `rig/skinService.ts`; the contract type has none). */
function skinService(app: EditorApp): { readonly pending: number; cancel(): void } | null {
  if (!app.rig.loaded) return null;
  const service = app.rig.skin as unknown as Partial<{
    readonly pending: number;
    cancel(): void;
  }>;
  return typeof service.cancel === 'function' ? (service as { readonly pending: number; cancel(): void }) : null;
}

const cancel = defineOperator<'autorig.cancel'>({
  id: 'autorig.cancel',
  label: 'Cancel Auto-Rig',
  description: 'Stops a running Bind Skin: the skeleton made before it stays (§5.4).',
  category: 'autorig',
  scope: 'global',
  poll({ app }) {
    const service = skinService(app);
    return service !== null && (service.pending > 0 || app.session.getState().busy !== null)
      ? OK
      : fail(NOTHING_TO_CANCEL);
  },
  apply({ app }) {
    skinService(app)?.cancel();
  },
});

export const WIZARD_RIG_OPERATORS: readonly AnyOperator[] = [rig, cancel];
