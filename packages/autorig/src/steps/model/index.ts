// ① Model step (AUTORIG-SPEC §5.2; D0 stub, D3 owns it): the step UI, the intake checks and fixes, the `model` slice
// and its reducers. D0 lands only the slice's default.
import type { AutoRigModelSlice } from '../../types';

export const MODEL_SLICE: AutoRigModelSlice = { parts: null, heavyConfirmed: false };
