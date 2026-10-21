// M6b test API, C1 group (M6B-SPEC §4.8, §0.5; C0 stub file, C1 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type CharacterRuntimeTestApi = Pick<
  EkzaStudioTestApi,
  'skeleton' | 'skeletonDesc' | 'containerVersion' | 'posedPositions'
>;

export function characterRuntimeTestApi(_ctx: M6bTestApiContext): CharacterRuntimeTestApi {
  return {
    skeleton: () => notImplemented('C1', 'skeleton'),
    skeletonDesc: () => notImplemented('C1', 'skeletonDesc'),
    containerVersion: () => notImplemented('C1', 'containerVersion'),
    posedPositions: () => notImplemented('C1', 'posedPositions'),
  };
}
