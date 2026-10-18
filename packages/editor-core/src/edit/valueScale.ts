// M2A-SPEC §5.15.3 value scaling of keys: contract stub landed by A0 (§3 rule 1); A4 implements it.
import { EkzaError } from '@ekza-animator/anim-core';
import type { KeyId, Tx } from '@ekza-animator/doc';
import type { EditorApp, KeyEditResult } from '../types';

/** M2a: value scale of keys around `pivot` (display units); handles' dv scale with the factor (A4). */
export function scaleKeyValues(
  _app: EditorApp,
  _tx: Tx,
  _keys: readonly KeyId[],
  _pivot: number,
  _factor: number,
): KeyEditResult {
  throw new EkzaError('not-implemented', 'editor-core.scaleKeyValues');
}
