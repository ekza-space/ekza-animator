// M6b test API, C7 group (M6B-SPEC §4.8, §0.5; C0 stub file, C7 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type RigShellTestApi = Pick<EkzaStudioTestApi, 'rigState' | 'validation' | 'rigCompiles'>;

export function rigShellTestApi(_ctx: M6bTestApiContext): RigShellTestApi {
  return {
    rigState: () => notImplemented('C7', 'rigState'),
    validation: () => notImplemented('C7', 'validation'),
    rigCompiles: () => notImplemented('C7', 'rigCompiles'),
  };
}
