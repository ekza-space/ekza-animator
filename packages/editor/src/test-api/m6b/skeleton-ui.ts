// M6b test API, C3 group (M6B-SPEC §4.8, §0.5; the skeleton UI): page CSS px of joints, bones and Quick Rig markers in
// a pane (null while not drawn there or off the pane), Snap to Projected Center under a page point, and Quick Rig's
// state (markers, moved, selected, template, the live preview, the A-pose flag).
import { quickRigOf } from '@ekza-studio/editor-core';
import type { QuickRigMarker } from '@ekza-studio/rig';
import { viewportRigOf } from '@ekza-studio/viewport';
import type { EkzaStudioTestApi } from '../types';
import type { M6bTestApiContext } from './support';

export type SkeletonUiTestApi = Pick<
  EkzaStudioTestApi,
  'screenOfJoint' | 'screenOfBone' | 'projectedCenter' | 'quickRig' | 'screenOfMarker'
>;

export function skeletonUiTestApi(ctx: M6bTestApiContext): SkeletonUiTestApi {
  const { app } = ctx.shell;
  const page = (paneId: string, point: { x: number; y: number } | null): { x: number; y: number } | null => {
    const rect = ctx.shell.ui.getState().viewport?.paneRect(paneId) ?? null;
    return point === null || rect === null ? null : { x: rect.x + point.x, y: rect.y + point.y };
  };
  const runtime = () => {
    ctx.sync();
    return viewportRigOf(app);
  };
  return {
    screenOfJoint: (joint, paneId) => page(paneId, runtime()?.screenOfJoint(joint, paneId) ?? null),
    screenOfBone: (joint, child, paneId, t) => page(paneId, runtime()?.screenOfBone(joint, child, paneId, t) ?? null),
    screenOfMarker: (marker, side, paneId) =>
      page(paneId, runtime()?.screenOfMarker(marker as QuickRigMarker, side, paneId) ?? null),
    projectedCenter(paneId, x, y) {
      const rect = ctx.shell.ui.getState().viewport?.paneRect(paneId) ?? null;
      const rig = runtime();
      if (rect === null || rig === null) return null;
      const point = rig.projectedCenter(paneId, x - rect.x, y - rect.y);
      return point === null ? null : [point[0], point[1], point[2]];
    },
    quickRig() {
      ctx.sync();
      const state = quickRigOf(app);
      if (state === null) return null;
      const markers: Record<string, number[]> = {};
      for (const [name, point] of Object.entries(state.markers)) {
        if (point !== undefined) markers[name] = [point[0], point[1], point[2]];
      }
      return {
        markers,
        moved: [...state.moved],
        selected: state.selected,
        preset: state.preset,
        preview:
          state.preview === null
            ? null
            : state.preview.map((joint) => ({
                key: joint.key,
                position: [joint.position[0], joint.position[1], joint.position[2]],
              })),
        aPose: state.guess === null ? null : state.guess.aPose,
      };
    },
  };
}
