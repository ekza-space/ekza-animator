// Auto-Rig ④ Animations composition (AUTORIG-SPEC §4.5, §5.5.4; D0 stub, D5 replaces it): `autorig.clip.add
// {character, clip, params, replace?}` = C12's Use Clip with the clip parameters applied by the §5.5.3 data route
// (one undo step).
import type { AnyOperator } from '../../define';
import { wizardStub } from './compose';

export const WIZARD_CLIP_OPERATORS: readonly AnyOperator[] = [wizardStub('autorig.clip.add', 'Add Animation')];
