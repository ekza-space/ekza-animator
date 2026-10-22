// Auto-Rig ③ Rig compositions (AUTORIG-SPEC §4.5, §5.4; D0 stubs, D4 replaces them): `autorig.rig {straighten?}`
// (Create Skeleton with the Quick Rig commit args, Bind Skin, and — only for an A-posed input — A0's Straighten to
// T-Pose; two or three undo steps) and `autorig.cancel` (the skin service's `cancel()` of a running bind; U).
import type { AnyOperator } from '../../define';
import { wizardStub } from './compose';

export const WIZARD_RIG_OPERATORS: readonly AnyOperator[] = [
  wizardStub('autorig.rig', 'Auto-Rig'),
  wizardStub('autorig.cancel', 'Cancel Auto-Rig'),
];
