// Kernel mesh operators (M6A-SPEC §6.1): every `mesh.*` op registered from its **descriptor** (eager; no kernel code)
// with its final label, params, flags and pass-through args, as a stub that poll-fails "not available yet". B11
// registers them through `meshOperator`/`meshSetOperator` (`editor-core/src/mesh/operator.ts`) as their kernels land.
import { MESH_OP_DESCRIPTORS, MESH_SET_OP_DESCRIPTORS } from '@ekza-animator/mesh-core/descriptors';
import { MESH_EXTRA_ARGS } from '../../../mesh/operator';
import type { OperatorMap } from '../../args';
import type { AnyOperator } from '../define';
import { stubOperator } from '../stub';

type MeshOperatorId = Extract<keyof OperatorMap, `mesh.${string}`>;

function stub(desc: {
  readonly id: string;
  readonly label: string;
  readonly params: (typeof MESH_OP_DESCRIPTORS)[string]['params'];
  readonly flags: { readonly adjustable: boolean; readonly repeatable: boolean };
}): AnyOperator {
  return stubOperator(desc.id as MeshOperatorId, desc.label, {
    category: 'mesh',
    description: `${desc.label} (polygon modeling).`,
    scope: 'model',
    undo: true,
    adjustable: desc.flags.adjustable,
    repeatable: desc.flags.repeatable,
    params: desc.params,
    extraArgs: MESH_EXTRA_ARGS,
    workspaces: ['model'],
  });
}

/** Every §6.1 MeshOp and set-op, in descriptor order. */
export const MESH_OPERATORS: readonly AnyOperator[] = [
  ...Object.values(MESH_OP_DESCRIPTORS).map(stub),
  ...Object.values(MESH_SET_OP_DESCRIPTORS).map(stub),
];
