// M2A-SPEC §3 rule 1: every new M2a operator is registered from A0 on as a stub that resolves and poll-fails with
// "not available yet" (menus show it disabled, keymaps and scripts get a clean `cancelled` result); the owning work
// package replaces the definition in the same file.
import { EkzaError } from '@ekza-animator/anim-core';
import { GLOBAL_SCOPE, type KeyScope, type OperatorCategory } from '../../types';
import type { OperatorMap } from '../args';
import { type AnyOperator, defineOperator, fail } from './define';

/** The poll reason of every M2a operator stub. */
export const NOT_AVAILABLE_YET = 'not available yet';

export function stubOperator<K extends keyof OperatorMap>(
  id: K,
  label: string,
  opts: {
    readonly category: OperatorCategory;
    readonly description: string;
    readonly scope?: KeyScope;
    readonly undo?: boolean;
    readonly structural?: boolean;
    readonly internal?: boolean;
  },
): AnyOperator {
  const flags = {
    ...(opts.undo === true ? { undo: true } : {}),
    ...(opts.structural === true ? { structural: true } : {}),
    ...(opts.internal === true ? { internal: true } : {}),
  };
  return defineOperator<K>({
    id,
    label,
    description: opts.description,
    category: opts.category,
    scope: opts.scope ?? GLOBAL_SCOPE,
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
    poll: () => fail(NOT_AVAILABLE_YET),
    apply: () => {
      throw new EkzaError('not-implemented', `operator ${id}`);
    },
  });
}
