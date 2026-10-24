// Where the selection is on screen (STUDIO-TOUCH-SPEC §4.1, §6.1, AS-ST-18): the Halo, the breadcrumb and the Echo chips
// sit beside this box, never over it. Pane CSS px (the single pane fills the frame, so they are the frame's px too).
// Controls give their own screen points; a scene mesh its projected bounds; anything else (components, joints) the
// box around the press that selected it, which lies on the selection.
import { quatRotateVec3 } from '@ekza-studio/anim-core';
import type { MeshId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { Box, Point } from '@ekza-studio/ui/touch';
import type { ViewportManager } from '@ekza-studio/viewport';
import { PANE } from '../shell/stage';

/** Padding around control points (a control's shape reaches beyond its pick point). */
const CONTROL_PAD = 28;
/** Half the box around a press point (a finger's contact plus the picked part). */
const PRESS_HALF = 36;

function union(a: Box | null, b: Box): Box {
  return a === null
    ? b
    : {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
      };
}

/** A scene mesh's local bounds, placed in the world (the 8 corners); null while its data is not resident. */
function meshCorners(app: EditorApp, id: MeshId): (readonly [number, number, number])[] | null {
  const record = app.store.get('meshes', id);
  const position = app.meshes.get(id)?.data()?.position;
  if (record === undefined || position === undefined || position.length < 3) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const value = position[i + k] as number;
      if (value < (lo[k] as number)) lo[k] = value;
      if (value > (hi[k] as number)) hi[k] = value;
    }
  }
  const { t, q, s } = record.placement;
  const corners: (readonly [number, number, number])[] = [];
  for (let i = 0; i < 8; i++) {
    const local: [number, number, number] = [
      ((i & 1 ? hi[0] : lo[0]) as number) * s[0],
      ((i & 2 ? hi[1] : lo[1]) as number) * s[1],
      ((i & 4 ? hi[2] : lo[2]) as number) * s[2],
    ];
    const w = quatRotateVec3(q, local);
    corners.push([w[0] + t[0], w[1] + t[1], w[2] + t[2]]);
  }
  return corners;
}

const around = (p: Point, half: number): Box => ({
  left: p.x - half,
  top: p.y - half,
  right: p.x + half,
  bottom: p.y + half,
});

/** The selection's box in pane px, clamped to the pane; null when nothing selected shows. */
export function selectionBox(
  app: EditorApp,
  vm: Pick<ViewportManager, 'controlScreenPoint' | 'project' | 'paneRect'> | null,
  anchor: Point | null,
): Box | null {
  const s = app.session.getState();
  const rect = vm?.paneRect(PANE) ?? null;
  let box: Box | null = null;
  if (vm !== null && s.selection.controls.length > 0) {
    for (const control of s.selection.controls.slice(-24)) {
      const p = vm.controlScreenPoint(PANE, control);
      if (p !== null) box = union(box, around(p, CONTROL_PAD));
    }
  }
  if (box === null && vm !== null && s.model.componentMode === 'object' && s.selection.objects.length > 0) {
    for (const id of s.selection.objects.slice(-8)) {
      for (const corner of meshCorners(app, id as MeshId) ?? []) {
        const p = vm.project(PANE, corner);
        if (p !== null) box = union(box, around(p, 2));
      }
    }
  }
  if (box === null && anchor !== null) box = around(anchor, PRESS_HALF);
  if (box === null) return null;
  if (rect === null) return box;
  const left = Math.max(0, Math.min(rect.w, box.left));
  const top = Math.max(0, Math.min(rect.h, box.top));
  return {
    left,
    top,
    right: Math.max(left, Math.min(rect.w, box.right)),
    bottom: Math.max(top, Math.min(rect.h, box.bottom)),
  };
}

/** Whether two boxes overlap (AS-ST-18: no floater intersects the selection). */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
