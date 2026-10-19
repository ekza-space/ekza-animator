// Selective revert and restore (MCP-SPEC §4.10, §5.13): `edit.revertSteps` (a forward step that restores older
// history steps' changes, compare-before-restore per merge unit, through doc `planRestore`) and
// `edit.restoreDocument` (user runs only: "Restore the project as it was before the agent", through doc
// `planSnapshotRestore`). D0 registers them as stubs that poll-fail "not available yet" (§3 rule 1); P1 replaces the
// definitions in this file. Nothing of this lives in `edit.ts` (M6a's B11 owns it).
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const EDIT = { category: 'edit', undo: true, internal: true } as const;

export const REVERT_OPERATORS: readonly AnyOperator[] = [
  stubOperator('edit.revertSteps', 'Revert Steps', {
    ...EDIT,
    description: 'Revert older history steps as one new step; fields changed since are kept and reported.',
  }),
  stubOperator('edit.restoreDocument', 'Restore Document', {
    ...EDIT,
    description: 'Make the document equal to an earlier snapshot in one undoable step.',
  }),
];
