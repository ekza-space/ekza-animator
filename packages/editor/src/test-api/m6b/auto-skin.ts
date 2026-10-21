// M6b test API, C4 group (M6B-SPEC §4.8, §0.5; C0 stub file, C4 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type AutoSkinTestApi = Pick<EkzaStudioTestApi, 'skin'>;

export function autoSkinTestApi(_ctx: M6bTestApiContext): AutoSkinTestApi {
  return {
    skin: () => notImplemented('C4', 'skin'),
  };
}
