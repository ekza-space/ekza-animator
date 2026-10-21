// C2 (skeleton kernel; M6B-SPEC §0.4.2 Quick Rig v2, §5.3 projected centre). C0: the marker lists (final) and stubs.
import { EkzaError } from '@ekza-studio/anim-core';
import type { TriangleBvh } from '@ekza-studio/mesh-core';
import type { QuickRigMarker, QuickRigMarkers, TemplateJoint } from '../types';

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

/** §0.4.2 fit. Missing markers take the template's proportions scaled to the bounds. Pure; preview = commit. */
export function fitTemplate(
  _template: readonly TemplateJoint[],
  _markers: QuickRigMarkers,
  _bvh: TriangleBvh,
  _opts: { readonly ground: number; readonly hingeBias: number /* 0.15 */; readonly flexion: number /* 2° */ },
): readonly TemplateJoint[] {
  throw new EkzaError('not-implemented', 'rig.fitTemplate');
}

/** §0.4.2 guess; null when no leg split or arm run is found. `aPose` = armAngle > 15°. */
export function guessMarkers(
  _bvh: TriangleBvh,
  _bounds: readonly [readonly number[], readonly number[]],
): { readonly markers: Required<QuickRigMarkers>; readonly armAngle: number; readonly aPose: boolean } | null {
  throw new EkzaError('not-implemented', 'rig.guessMarkers');
}

/** Snap to Projected Center (§5.3): the slab midpoint along the ray; null = no hit. */
export function projectedCenter(
  _bvh: TriangleBvh,
  _origin: readonly [number, number, number],
  _dir: readonly [number, number, number],
  _opts: { readonly mode: 'new' | 'reposition'; readonly depth?: number; readonly fallbackRadius: number },
): readonly [number, number, number] | null {
  throw new EkzaError('not-implemented', 'rig.projectedCenter');
}
