// `app.capture` (M6A-SPEC §4.6, §5.10; one factory file per editor service, owned by B11 after B0a).
//
// B0a stub: never armed; `key` consumes nothing (the keymap is consulted as today) and `disarm` has nothing to do;
// arming and the card throw `EkzaError('not-implemented')`.
import { EkzaError } from '@ekza-animator/anim-core';
import type { NumericCaptureApi, NumericCaptureState } from '../../types';

const IDLE: NumericCaptureState = Object.freeze({ armed: null, field: null, text: null });

export function createCapture(): NumericCaptureApi {
  return {
    get state() {
      return IDLE;
    },
    arm() {
      throw new EkzaError('not-implemented', 'editor-core.NumericCaptureApi.arm');
    },
    disarm() {
      // Never armed.
    },
    key: () => false,
    openCard() {
      throw new EkzaError('not-implemented', 'editor-core.NumericCaptureApi.openCard');
    },
  };
}
