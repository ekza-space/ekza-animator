// Autosave and crash recovery (M2A-SPEC §4.9 `file.recover`, `file.discardRecovery`, `file.autosaveNow`, §5.20; A5
// implements them). A0 lands them as stubs.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const AUTOSAVE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('file.recover', 'Recover…', {
    category: 'file',
    description: 'Open an autosaved project that was not saved before its page closed.',
  }),
  stubOperator('file.discardRecovery', 'Discard Recovery', {
    category: 'file',
    description: 'Delete an autosaved recovery slot.',
  }),
  stubOperator('file.autosaveNow', 'Save Recovery Point', {
    category: 'file',
    description: 'Write the autosave slot now.',
    internal: true,
  }),
];
