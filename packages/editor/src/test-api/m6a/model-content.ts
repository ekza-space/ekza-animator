// M6a test API, B13 group (M6A-SPEC §4.8): palettes, the active swatch and image planes.
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type ModelContentTestApi = Pick<EkzaAnimatorTestApi, 'palettes' | 'activeSwatch' | 'imagePlanes'>;

export function modelContentTestApi(_ctx: M6aTestApiContext): ModelContentTestApi {
  return {
    palettes: () => notImplemented('B13', 'palettes'),
    activeSwatch: () => notImplemented('B13', 'activeSwatch'),
    imagePlanes: () => notImplemented('B13', 'imagePlanes'),
  };
}
