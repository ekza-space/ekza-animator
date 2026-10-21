// C2 (skeleton kernel; M6B-SPEC §0.4.2 Quick Rig v2, §5.3 projected centre): the marker lists, the fit, the One-Click
// guess, the start checks (CR-AR-3), the re-run seeding and Snap to Projected Center.
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import { placeTemplate, skeletonTemplate } from '../templates';
import type { QuickRigMarker, QuickRigMarkers, SkeletonPreset, TemplateJoint } from '../types';
import { fitTemplate } from './fit';
import { GUESS } from './guess';
import { projectedCenterOf } from './raster';

export {
  type JointLookup,
  markersFromJoints,
  type QuickRigStartChecks,
  quickRigStartChecks,
  START_CHECKS,
} from './checks';
export { FIT, fitTemplate, frontCentreZ, frontExtent } from './fit';
export { GUESS, guessMarkers } from './guess';
export { type Raster, rasterize, rowRuns } from './raster';

/** Centre markers (on x = 0), in list order (the pick rule's tie order, §0.4.2). */
export const QUICK_RIG_CENTRE_MARKERS: readonly QuickRigMarker[] = Object.freeze(['headTop', 'chin', 'pelvis']);
/** Side markers (the character's right side, x < 0), in list order. */
export const QUICK_RIG_SIDE_MARKERS: readonly QuickRigMarker[] = Object.freeze([
  'shoulder',
  'elbow',
  'wrist',
  'knee',
  'ankle',
  'toe',
]);

/** Snap to Projected Center (§5.3): the slab midpoint along the ray; null = no hit. */
export function projectedCenter(
  bvh: TriangleBvh,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  opts: { readonly mode: 'new' | 'reposition'; readonly depth?: number; readonly fallbackRadius: number },
): readonly [number, number, number] | null {
  return projectedCenterOf(bvh, origin, dir, opts);
}

/**
 * Quick Rig's fit as the preview and Create Skeleton run it (§0.4.2): the preset's template sized by the head-top
 * marker (else the triangles' bounds) on the ground, fitted to the markers with the guess's hinge bias. Pure.
 */
export function fitQuickRig(
  preset: SkeletonPreset,
  markers: QuickRigMarkers,
  bvh: TriangleBvh,
  opts: { readonly ground: number; readonly flexion: number },
): readonly TemplateJoint[] {
  const [lo, hi] = bvh.bounds();
  const top = markers.headTop;
  const height = top !== undefined && top[1] > opts.ground ? top[1] - opts.ground : hi[1] - lo[1];
  const template = placeTemplate(skeletonTemplate(preset, { height, proportions: 'standard', flexion: opts.flexion }), [
    0,
    opts.ground,
    0,
  ]);
  return fitTemplate(template, markers, bvh, {
    ground: opts.ground,
    hingeBias: GUESS.hingeBias,
    flexion: opts.flexion,
  });
}
