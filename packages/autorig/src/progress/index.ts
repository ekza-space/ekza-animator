// Derived wizard progress (AUTORIG-SPEC §4.3; D0 stub, D3 implements it): `done`, `reachable` and `blocked` per step
// as a pure function of the document, the C7 checklist (`rigChecklist`, the Validation rows incl. `xform.*`) and the
// session — never stored, so reloads, undo and Studio edits keep it right.
import { EkzaError } from '@ekza-studio/anim-core';
import type { AutoRigProgressFn } from '../types';

export const autoRigProgress: AutoRigProgressFn = () => {
  throw new EkzaError('not-implemented', 'autoRigProgress (AUTORIG-SPEC §4.3, D3)');
};
