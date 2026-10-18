// Breakdown conversion (M2A-SPEC §4.9 `key.convert`, §5.12; A4 implements it). A0 lands it as a stub.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const BREAKDOWN_OPERATORS: readonly AnyOperator[] = [
  stubOperator('key.convert', 'Convert Keys', {
    category: 'key',
    description: 'Turn the selected keys into breakdowns or back into keys.',
    undo: true,
  }),
];
