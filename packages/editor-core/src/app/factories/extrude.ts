// `app.extrude` (M6A-SPEC §4.6, §5.8; one factory file per editor service, owned by B12b after B0a).
//
// B0a stub: no extrude session ever exists, so gestures transform components normally (`beginAbsorb` → null),
// `edit.undo`/`edit.redo` find nothing to step (`stepBack`/`stepForward` → false) and `T` reopens nothing.
import { EkzaError } from '@ekza-animator/anim-core';
import type { ExtrudeSessionApi } from '../../types';

export function createExtrude(): ExtrudeSessionApi {
  return {
    state: null,
    beginAbsorb: () => null,
    end() {
      // No session.
    },
    stepBack: () => false,
    stepForward: () => false,
    reopen: () => false,
    setManipSpace() {
      throw new EkzaError('not-implemented', 'editor-core.ExtrudeSessionApi.setManipSpace');
    },
  };
}
