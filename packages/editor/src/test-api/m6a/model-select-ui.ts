// M6a test API, B10 group (M6A-SPEC §4.8): component modes, selections, picking positions, HUD, Mesh Check, panes.
import type { EkzaAnimatorTestApi } from '../types';
import { type M6aTestApiContext, notImplemented } from './support';

export type ModelSelectUiTestApi = Pick<
  EkzaAnimatorTestApi,
  'model' | 'screenOfVertex' | 'screenOfEdge' | 'screenOfFace' | 'hud' | 'meshCheck' | 'paneObjects'
>;

export function modelSelectUiTestApi(_ctx: M6aTestApiContext): ModelSelectUiTestApi {
  return {
    model: () => notImplemented('B10', 'model'),
    screenOfVertex: () => notImplemented('B10', 'screenOfVertex'),
    screenOfEdge: () => notImplemented('B10', 'screenOfEdge'),
    screenOfFace: () => notImplemented('B10', 'screenOfFace'),
    hud: () => notImplemented('B10', 'hud'),
    meshCheck: () => notImplemented('B10', 'meshCheck'),
    paneObjects: () => notImplemented('B10', 'paneObjects'),
  };
}
