// ②'s step start (AUTORIG-SPEC §4.2, §5.3, §4.3; D4; a lazy chunk). After the frame's entry order (preview stopped,
// tool session ended, Rig & Skin, Object mode) it opens M6b's Quick Rig on the subject — editor-core's `autorigFlow`
// (T5b, shared with Halo's *Rig it* card): the scene meshes of a new subject (`select.objects` then
// `skel.quickRig.start {meshes}`: the One-Click guess) or, back from ③, the subject character's meshes (the M6b
// re-run); a session already open on the same meshes is kept, and a subject that skipped ① (*From Studio*) records its
// start pose from the guess (§4.3). This module keeps ②'s transient state and frames the panes. Nothing here writes the
// document.
import type { MeshId } from '@ekza-studio/doc';
import {
  type AutoRigPoseClass,
  type AutoRigSubject,
  armPoseClass,
  AUTORIG_A_POSE_LIMIT,
  type EditorApp,
  markerMeshes as flowMarkerMeshes,
  openMarkers,
  recordStartPose as flowRecordStartPose,
} from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import { flowHost } from '../model/flowHost';
import { markersUi } from './ui';
import './strings';

/** §4.3: the pose class limit (the `skel.tpose` 5°; M6b's own A-pose notice fires above 15°). */
export const A_POSE_LIMIT = AUTORIG_A_POSE_LIMIT;

export function poseClass(armAngle: number): AutoRigPoseClass {
  return armPoseClass(armAngle);
}

/** The meshes ② opens Quick Rig on: the subject character's (a re-run), else the subject's scene meshes. */
export function markerMeshes(
  app: EditorApp,
  subject: AutoRigSubject,
): { readonly meshes: readonly MeshId[]; readonly scene: boolean } {
  return flowMarkerMeshes(app, subject);
}

const MARKER_PANES = ['pane-front', 'pane-side', 'pane-persp'] as const;

/**
 * Frames ②'s three panes on the whole body once their layout settled (two frames): wide T-posed bodies and A-posed
 * arms stood cropped in the narrow front pane and the 3D pane (AR-D9-11; Rig & Skin's `A` frames the scene meshes
 * before a character exists).
 */
async function frameMarkerPanes(app: EditorApp): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  for (const paneId of MARKER_PANES) await app.runUntyped('view.frame', { what: 'all', paneId });
}

/** Records the input's pose from the guess when the subject has none yet (a *From Studio* subject, §4.3). */
export function recordStartPose(ctx: WizardContext): void {
  flowRecordStartPose(flowHost(ctx));
}

export async function enterMarkers(ctx: WizardContext): Promise<void> {
  const ui = markersUi(ctx);
  const opened = await openMarkers(flowHost(ctx), () => ui.set({ starting: true, error: null }));
  switch (opened.status) {
    case 'none':
    case 'kept':
      return;
    case 'started':
      ui.set({ starting: false, error: null });
      if (opened.scene) await frameMarkerPanes(ctx.app);
      return;
    case 'failed':
      ui.set({ starting: false, error: messages().markers.startFailed(opened.reason) });
  }
}
