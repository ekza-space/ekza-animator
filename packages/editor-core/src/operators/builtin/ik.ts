// Limb IK operators (M2A-SPEC §4.9 `rig.*` IK rows, §5.6–§5.7; A2 implements them on A1's rig functions). A0 lands
// them as stubs that poll-fail with "not available yet".
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const IK_OPERATORS: readonly AnyOperator[] = [
  stubOperator('rig.addLimbIk', 'Add Limb IK', {
    category: 'rig',
    description: 'Add IK controls and two-bone IK to the limbs of a humanoid rig (your animation stays unchanged).',
    undo: true,
    structural: true,
  }),
  stubOperator('rig.ikFk.switch', 'Switch IK/FK', {
    category: 'rig',
    description: "Switch a limb between IK and FK, matching the other side's pose first.",
    undo: true,
  }),
  stubOperator('rig.ikFk.match', 'Match IK/FK', {
    category: 'rig',
    description: 'Set the IK or FK controls of a limb from the pose of the other side.',
    undo: true,
  }),
  stubOperator('rig.ikFk.matchRange', 'Match Range', {
    category: 'rig',
    description: 'Match the IK or FK controls of a limb over a frame range and key them.',
    undo: true,
  }),
  stubOperator('rig.setFootParams', 'Edit Foot Pivots', {
    category: 'rig',
    description: "Set a leg's foot-roll pivot distances and break angle.",
    undo: true,
    structural: true,
  }),
];
