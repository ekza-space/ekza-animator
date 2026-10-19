// M6a test API, B12a group (M6A-SPEC §4.8): symmetry maps and soft-selection weights.
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type ModelTransformToolsTestApi = Pick<EkzaAnimatorTestApi, 'symmetry' | 'softWeights'>;

export function modelTransformToolsTestApi(_ctx: M6aTestApiContext): ModelTransformToolsTestApi {
  return {
    symmetry: () => notImplemented('B12a', 'symmetry'),
    softWeights: () => notImplemented('B12a', 'softWeights'),
  };
}
