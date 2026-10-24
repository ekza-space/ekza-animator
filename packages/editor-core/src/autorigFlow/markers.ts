// ② markers and the guess (AUTORIG-SPEC §5.3, §4.3; moved from Auto-Rig ② by T5b; STUDIO-TOUCH-SPEC §12.2 steps
// 2–3). M6b's Quick Rig opens on the subject: the scene meshes of a new subject (`select.objects` then
// `skel.quickRig.start {meshes}`: the One-Click guess places the nine markers) or the subject character's meshes (the
// M6b re-run: markers seeded from the joints, the template locked). A session already open on the same meshes is
// kept (the person's markers stay). When the subject skipped ① (*From Studio*), the input's pose is recorded here once,
// from the guess's arm angle (`startPose`: 't' up to 5°, 'a' above), so ③ straightens exactly when ① would have said.
// The finger detail is Quick Rig's preset (`skel.quickRig.setPreset`). Every run is U state.
import type { MeshId } from '@ekza-studio/doc';
import { quickRigOf } from '../operators/builtin/rig/quickRigSession';
import type { AutoRigPoseClass, AutoRigSubject, EditorApp } from '../types';
import type { AutoRigFlowHost } from './host';
import { resolveAutoRigSubject } from './subject';

/** §4.3: the pose class limit (the `skel.tpose` 5°; M6b's own A-pose notice fires above 15°). */
export const AUTORIG_A_POSE_LIMIT = (5 * Math.PI) / 180;

/** The pose class of an arm angle (radians below horizontal). */
export function armPoseClass(armAngle: number): AutoRigPoseClass {
  return { armAngle, kind: armAngle > AUTORIG_A_POSE_LIMIT ? 'a' : 't' };
}

/**
 * The skeleton detail (§5.3 *Fingers*; STUDIO-TOUCH-SPEC §12.2 step 1): Quick Rig's presets. `thumb` is the default
 * (Thumb + 1, OMOBA's requirement); `minimal` has no shoulders and toes.
 */
export const AUTORIG_FINGER_PRESETS = {
  none: 'core21',
  thumb: 'standard33',
  all: 'full52',
  minimal: 'lite17',
} as const;
export type AutoRigFingers = keyof typeof AUTORIG_FINGER_PRESETS;

/** The meshes ② opens Quick Rig on: the subject character's (a re-run), else the subject's scene meshes. */
export function markerMeshes(
  app: EditorApp,
  subject: AutoRigSubject,
): { readonly meshes: readonly MeshId[]; readonly scene: boolean } {
  const resolved = resolveAutoRigSubject(app.store, subject);
  const character = resolved.character;
  if (character !== null) {
    if (character.source.kind !== 'model') return { meshes: [], scene: false };
    const meshes = app.store.query
      .meshesOfOwner(character.id)
      .filter((mesh) => mesh.deleted === null)
      .map((mesh) => mesh.id);
    return { meshes, scene: false };
  }
  return { meshes: resolved.meshes, scene: true };
}

/** The start pose the open guess gives a subject that has none yet (a *From Studio* subject, §4.3), else null. */
export function guessedStartPose(host: Pick<AutoRigFlowHost, 'app' | 'state'>): AutoRigPoseClass | null {
  const state = quickRigOf(host.app);
  if (host.state.get().startPose !== null || state === null || state.refit !== null || state.guess === null) {
    return null;
  }
  if (state.guess.failed !== null) return null;
  return armPoseClass(state.guess.armAngle);
}

/** Records the input's pose from the guess when the subject has none yet (§4.3). */
export function recordStartPose(host: Pick<AutoRigFlowHost, 'app' | 'state'>): void {
  const pose = guessedStartPose(host);
  if (pose !== null) host.state.set({ startPose: pose });
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export type AutoRigMarkersOutcome =
  /** Nothing to place markers on (no subject, or an asset character). */
  | { readonly status: 'none' }
  /** Quick Rig was already open on these meshes (the person's markers stay). */
  | { readonly status: 'kept' }
  /** Quick Rig opened; `scene`: on the scene meshes of a new subject (the shell frames its marker panes). */
  | { readonly status: 'started'; readonly scene: boolean }
  | { readonly status: 'failed'; readonly reason: string };

/**
 * Opens Quick Rig on the subject (§5.3; the step start of ②, Halo's *Rig it* card). `starting` is called right before
 * Quick Rig starts (not for `none` and `kept`): the shell shows that it is opening.
 */
export async function openMarkers(host: AutoRigFlowHost, starting?: () => void): Promise<AutoRigMarkersOutcome> {
  const { app } = host;
  const { meshes, scene } = markerMeshes(app, host.state.get().subject);
  if (meshes.length === 0) return { status: 'none' };
  const open = quickRigOf(app);
  if (open !== null && sameIds(open.meshes, meshes)) {
    recordStartPose(host);
    return { status: 'kept' };
  }
  starting?.();
  try {
    if (scene) await host.quiet('select.objects', { ids: meshes, mode: 'replace' });
    const result = await host.quiet('skel.quickRig.start', { meshes });
    if (result.status === 'finished') {
      recordStartPose(host);
      return { status: 'started', scene };
    }
    return { status: 'failed', reason: result.status === 'cancelled' ? result.reason : result.error.message };
  } catch (error) {
    return { status: 'failed', reason: String(error) };
  }
}

/** The finger detail (§5.3): Quick Rig's preset, when it differs (the person's choice; refused on a locked re-run). */
export async function chooseFingers(host: AutoRigFlowHost, fingers: AutoRigFingers): Promise<boolean> {
  const preset = AUTORIG_FINGER_PRESETS[fingers];
  const state = quickRigOf(host.app);
  if (state === null) return false;
  if (state.preset === preset) return true;
  return (await host.run('skel.quickRig.setPreset', { preset })).status === 'finished';
}
