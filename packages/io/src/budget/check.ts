// WP-4 stub: final signature (MVP-SPEC §7 WP-4, §4.11.14); throws until budgets land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { GlbContainer, InputBudget, LintIssue } from '../types';

/** Budgets + structure. */
export function checkInputBudget(_c: GlbContainer, _budget?: InputBudget): readonly LintIssue[] {
  throw new EkzaError('not-implemented', 'io.checkInputBudget');
}
