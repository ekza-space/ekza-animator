// M6b test API, C6 group (M6B-SPEC §4.8, §0.5; C0 stub file, C6 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type SkinUiTestApi = Pick<EkzaStudioTestApi, 'paint' | 'weightLabels' | 'componentEditor'>;

export function skinUiTestApi(_ctx: M6bTestApiContext): SkinUiTestApi {
  return {
    paint: () => notImplemented('C6', 'paint'),
    weightLabels: () => notImplemented('C6', 'weightLabels'),
    componentEditor: () => notImplemented('C6', 'componentEditor'),
  };
}
