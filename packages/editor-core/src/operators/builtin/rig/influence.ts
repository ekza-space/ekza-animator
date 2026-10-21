// C6 (skin UI; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const INFLUENCE_OPERATORS: readonly AnyOperator[] = [
  rigStub('skin.influence.setActive', 'Set Active Influence', { internal: true }),
  rigStub('skin.influence.hold', 'Hold Influence', {}),
  rigStub('skin.influence.holdAll', 'Hold All Influences', {}),
  rigStub('skin.influence.releaseAll', 'Release All Holds', {}),
  rigStub('skin.influence.walk', 'Walk Influences', { internal: true }),
  rigStub('skin.influence.pickDominant', 'Pick Dominant Influence', { internal: true }),
  rigStub('skin.paint.mode', 'Paint Mode', { internal: true }),
  rigStub('skin.paint.set', 'Brush Settings', { internal: true }),
  rigStub('skin.paint.mirrorToggle', 'Mirror Stroke', {}),
  rigStub('skin.paint.sample', 'Sample Weight', { internal: true }),
  rigStub('skin.testRotate.toggle', 'Test Rotate', {}),
];
