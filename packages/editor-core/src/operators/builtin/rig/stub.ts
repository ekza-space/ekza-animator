// The stub definitions of the Rig & Skin operators (M6B-SPEC §3 rule 1, §0.6; C0, closed): each owner replaces its
// rows in its own file with the real definition. Category = the id's first segment; key scope 'rig' and workspace
// ['rig'] unless the row says otherwise (§6 lists every operator in the rig-workspace chunk, §2.1).
import type { KeyScope, ToolId, WorkspaceId } from '../../../types';
import type { OperatorMap } from '../../args';
import type { AnyOperator } from '../define';
import { stubOperator } from '../stub';

/** The poll reason of the §6 operators the MVP does not build (§0.3, §0.6). */
export const ARRIVES_AFTER_MVP = 'Arrives after the MVP';

export function rigStub(
  id: keyof OperatorMap,
  label: string,
  opts: {
    readonly undo?: boolean;
    readonly adjustable?: boolean;
    readonly repeatable?: boolean;
    readonly internal?: boolean;
    readonly selection?: boolean;
    /** A §6 operator the MVP defers: poll-fails "Arrives after the MVP" and is listed nowhere (internal). */
    readonly deferred?: boolean;
    readonly tool?: ToolId;
    readonly scope?: KeyScope;
    readonly workspaces?: readonly WorkspaceId[];
    readonly aliases?: readonly string[];
    readonly reason?: string;
  },
): AnyOperator {
  const deferred = opts.deferred === true;
  return stubOperator(id, label, {
    category: id.slice(0, id.indexOf('.')),
    description: `${label} (M6B-SPEC §6)`,
    scope: opts.scope ?? 'rig',
    workspaces: opts.workspaces ?? ['rig'],
    ...(opts.undo === true ? { undo: true } : {}),
    ...(opts.adjustable === true ? { adjustable: true } : {}),
    ...(opts.repeatable === true ? { repeatable: true } : {}),
    ...(opts.internal === true || deferred ? { internal: true } : {}),
    ...(opts.selection === true ? { selection: true } : {}),
    ...(opts.tool === undefined ? {} : { tool: opts.tool }),
    ...(opts.aliases === undefined ? {} : { aliases: opts.aliases }),
    ...(deferred ? { reason: ARRIVES_AFTER_MVP } : opts.reason === undefined ? {} : { reason: opts.reason }),
  });
}
