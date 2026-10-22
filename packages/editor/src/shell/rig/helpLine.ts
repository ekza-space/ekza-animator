// Rig & Skin's help line (M6B-SPEC §0.2, §5.24; C3, C7; lazy rig shell): the Skeleton-mode and Quick Rig tool hints and
// the selection count — joints in Skeleton mode, controls and picked meshes otherwise (acceptance fix M6B-AF-7). Over a
// perspective pane Quick Rig says where markers drag (§0.2 step 3; M6B-AF-11).
import type { EditorApp, SessionState } from '@ekza-studio/editor-core';
import { PANEL } from '@ekza-studio/editor-core';
import { viewportManagerOf } from '@ekza-studio/viewport';
import type { RigHelp } from '../HelpLine';

/** Skeleton mode and Quick Rig hints, by viewport tool. */
export const SKELETON_HINT: Readonly<Record<string, string>> = {
  quickRig: 'Quick Rig: drag markers in the front (X/Y) or side (Z/Y) view · click again to cycle overlapping markers',
  quickRigPersp: 'Quick Rig: drag markers in the front or side view · this view only shows them',
  select: 'Click or marquee to select joints · W move · E rotate',
  move: 'Drag a joint: moves its children too · hold D to move the joint only',
  rotate: 'Drag a joint: rotates the rest (bound: a test pose) · hold D to re-orient the joint only',
  scale: 'Joints keep scale 1 (VRM/glTF)',
};

/** Whether a pane looks through a perspective camera (a view preset or a shot camera). */
function perspective(app: EditorApp, paneId: string | null): boolean {
  const pane = paneId === null ? null : (viewportManagerOf(app)?.paneState(paneId) ?? null);
  return pane !== null && (pane.cameraKind === 'shot' || pane.preset === 'persp');
}

export const rigHelpLine: RigHelp = (app: EditorApp, s: SessionState) => {
  if (s.workspace !== 'rig') return null;
  const hovered = s.hoveredPanel?.kind === PANEL.viewport ? s.hoveredPanel.paneId : null;
  const hint =
    s.rig.quickRig !== null
      ? SKELETON_HINT[perspective(app, hovered) ? 'quickRigPersp' : 'quickRig']
      : s.rig.mode === 'skeleton'
        ? SKELETON_HINT[s.tools.viewport]
        : undefined;
  const skeleton = s.rig.mode === 'skeleton';
  const count = skeleton ? s.selection.joints.length : s.selection.controls.length + s.selection.objects.length;
  return `${hint ?? ''}\u0001${count}\u0001${skeleton ? 'joint' : ''}`;
};
