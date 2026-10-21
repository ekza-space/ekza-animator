// M6b test API, C6 (C5 subset) group (M6B-SPEC §4.8, §0.5; C0 stub file, C6 (C5 subset) fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type WeightsKernelTestApi = Pick<EkzaStudioTestApi, 'weights'>;

export function weightsKernelTestApi(_ctx: M6bTestApiContext): WeightsKernelTestApi {
  return {
    weights: () => notImplemented('C6 (C5 subset)', 'weights'),
  };
}
