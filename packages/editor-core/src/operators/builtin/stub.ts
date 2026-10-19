// M2A-SPEC §3 rule 1 (and M6A-SPEC §3 rule 1): every new operator is registered from the foundation package on as a
// stub that resolves and poll-fails with "not available yet" (menus show it disabled, keymaps and scripts get a clean
// `cancelled` result); the owning work package replaces the definition in the same file.
import type { ParamDef } from '@ekza-animator/anim-core';
import { EkzaError } from '@ekza-animator/anim-core';
import { GLOBAL_SCOPE, type KeyScope, type OperatorCategory, type ToolId, type WorkspaceId } from '../../types';
import type { OperatorMap } from '../args';
import { type AnyOperator, defineOperator, fail } from './define';

/** The poll reason of every operator stub. */
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
    // ---------- M6a (M6A-SPEC §4.6): the final metadata, so menus, the palette and cards read it from day one ----------
    readonly adjustable?: boolean;
    readonly repeatable?: boolean;
    readonly selection?: boolean;
    readonly params?: readonly ParamDef[];
    readonly extraArgs?: readonly string[];
    readonly tool?: ToolId;
    readonly workspaces?: readonly WorkspaceId[];
    readonly aliases?: readonly string[];
    /** Poll reason (default "not available yet"). */
    readonly reason?: string;
  },
): AnyOperator {
  const flags = {
    ...(opts.undo === true ? { undo: true } : {}),
    ...(opts.structural === true ? { structural: true } : {}),
    ...(opts.internal === true ? { internal: true } : {}),
    ...(opts.adjustable === true ? { adjustable: true } : {}),
    ...(opts.repeatable === true ? { repeatable: true } : {}),
    ...(opts.selection === true ? { selection: true } : {}),
  };
  const reason = opts.reason ?? NOT_AVAILABLE_YET;
  return defineOperator<K>({
    id,
    label,
    description: opts.description,
    category: opts.category,
    scope: opts.scope ?? GLOBAL_SCOPE,
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
    ...(opts.params === undefined ? {} : { params: opts.params }),
    ...(opts.extraArgs === undefined ? {} : { extraArgs: opts.extraArgs }),
    ...(opts.tool === undefined ? {} : { tool: opts.tool }),
    ...(opts.workspaces === undefined ? {} : { workspaces: opts.workspaces }),
    ...(opts.aliases === undefined ? {} : { aliases: opts.aliases }),
    poll: () => fail(reason),
    apply: () => {
      throw new EkzaError('not-implemented', `operator ${id}`);
    },
  });
}
