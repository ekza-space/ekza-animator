// ②'s step start (AUTORIG-SPEC §4.2, §5.3, §4.3; D4; a lazy chunk). After the frame's entry order (preview stopped,
// tool session ended, Rig & Skin, Object mode) it opens M6b's Quick Rig on the subject: the scene meshes of a new
// subject (`select.objects` then `skel.quickRig.start {meshes}`: the One-Click guess, the `'rig-markers'` layout) or,
// back from ③, the subject character's meshes (the M6b re-run: markers seeded from the joints, the template locked).
// A session already open on the same meshes is kept (the user's markers stay). When the subject skipped ① (*From
// Studio*), the input's pose is recorded here once, from the guess's arm angle (`startPose`, §4.3): 't' up to 5°, 'a'
// above. Every run is U state; nothing here writes the document.
import type { MeshId } from '@ekza-studio/doc';
import { type EditorApp, quickRigOf } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import { resolveSubject } from '../../progress';
import type { WizardContext } from '../../shell/context';
import type { AutoRigPoseClass, AutoRigSubject } from '../../types';
import { markersUi } from './ui';

/** §4.3: the pose class limit (the `skel.tpose` 5°; M6b's own A-pose notice fires above 15°). */
export const A_POSE_LIMIT = (5 * Math.PI) / 180;

export function poseClass(armAngle: number): AutoRigPoseClass {
  return { armAngle, kind: armAngle > A_POSE_LIMIT ? 'a' : 't' };
}

/** The meshes ② opens Quick Rig on: the subject character's (a re-run), else the subject's scene meshes. */
export function markerMeshes(
  app: EditorApp,
  subject: AutoRigSubject,
): { readonly meshes: readonly MeshId[]; readonly scene: boolean } {
  const resolved = resolveSubject(app.store, subject);
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

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Records the input's pose from the guess when the subject has none yet (a *From Studio* subject, §4.3). */
export function recordStartPose(ctx: WizardContext): void {
  const state = quickRigOf(ctx.app);
  if (ctx.session.getState().startPose !== null || state === null || state.refit !== null || state.guess === null) {
    return;
  }
  if (state.guess.failed !== null) return;
  ctx.session.set({ startPose: poseClass(state.guess.armAngle) });
}

export async function enterMarkers(ctx: WizardContext): Promise<void> {
  const { app } = ctx;
  const ui = markersUi(ctx);
  const { meshes, scene } = markerMeshes(app, ctx.session.getState().subject);
  if (meshes.length === 0) return;
  const open = quickRigOf(app);
  if (open !== null && sameIds(open.meshes, meshes)) {
    recordStartPose(ctx);
    return;
  }
  ui.set({ starting: true, error: null });
  try {
    if (scene) await app.runUntyped('select.objects', { ids: meshes, mode: 'replace' });
    const result = await app.runUntyped('skel.quickRig.start', { meshes });
    if (result.status === 'finished') {
      recordStartPose(ctx);
      ui.set({ starting: false, error: null });
      return;
    }
    const reason = result.status === 'cancelled' ? result.reason : result.error.message;
    ui.set({ starting: false, error: messages().markers.startFailed(reason) });
  } catch (error) {
    ui.set({ starting: false, error: messages().markers.startFailed(String(error)) });
  }
}
