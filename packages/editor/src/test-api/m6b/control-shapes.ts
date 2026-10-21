// M6b test API, C9 group (M6B-SPEC §4.8, §0.5; C0 stub file, C9 fills it).
import type { EkzaStudioTestApi } from '../types';
import { type M6bTestApiContext, notImplemented } from './support';

export type ControlShapesTestApi = Pick<EkzaStudioTestApi, 'controlShape' | 'screenOfShapeCv'>;

export function controlShapesTestApi(_ctx: M6bTestApiContext): ControlShapesTestApi {
  return {
    controlShape: () => notImplemented('C9', 'controlShape'),
    screenOfShapeCv: () => notImplemented('C9', 'screenOfShapeCv'),
  };
}
