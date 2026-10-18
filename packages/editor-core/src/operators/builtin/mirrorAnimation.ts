// Mirror animation (M2A-SPEC §4.9 `pose.mirrorAnimation`, §5.14; A4 implements it). A0 lands it as a stub.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const MIRROR_ANIMATION_OPERATORS: readonly AnyOperator[] = [
  stubOperator('pose.mirrorAnimation', 'Mirror Animation', {
    category: 'pose',
    description:
      'Mirror the animation of the controls (flip, left to right or right to left), optionally half a cycle later.',
    undo: true,
  }),
];
