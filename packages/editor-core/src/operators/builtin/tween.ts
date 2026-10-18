// The one-shot tween (M2A-SPEC §4.9 `key.tween`, §5.13; A4 implements it). A0 lands it as a stub.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const TWEEN_OPERATORS: readonly AnyOperator[] = [
  stubOperator('key.tween', 'Tween', {
    category: 'key',
    description: 'Tween, blend to a neighbour, ease, push/pull or blend to the default, on the pose or selected keys.',
    undo: true,
  }),
];
