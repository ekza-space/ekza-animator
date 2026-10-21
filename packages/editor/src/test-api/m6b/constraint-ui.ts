// M6b test API, C8b group (M6B-SPEC §4.8, §0.5; C0 stub file, C8b fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type ConstraintUiTestApi = Pick<EkzaStudioTestApi, 'constraints'>;

export function constraintUiTestApi(_ctx: M6bTestApiContext): ConstraintUiTestApi {
  return {
    constraints: () => notImplemented('C8b', 'constraints'),
  };
}
