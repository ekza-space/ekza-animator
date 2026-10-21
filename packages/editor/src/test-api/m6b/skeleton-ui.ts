// M6b test API, C3 group (M6B-SPEC §4.8, §0.5; C0 stub file, C3 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type SkeletonUiTestApi = Pick<
  EkzaStudioTestApi,
  'screenOfJoint' | 'screenOfBone' | 'projectedCenter' | 'quickRig' | 'screenOfMarker'
>;

export function skeletonUiTestApi(_ctx: M6bTestApiContext): SkeletonUiTestApi {
  return {
    screenOfJoint: () => notImplemented('C3', 'screenOfJoint'),
    screenOfBone: () => notImplemented('C3', 'screenOfBone'),
    projectedCenter: () => notImplemented('C3', 'projectedCenter'),
    quickRig: () => notImplemented('C3', 'quickRig'),
    screenOfMarker: () => notImplemented('C3', 'screenOfMarker'),
  };
}
