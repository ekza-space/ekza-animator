// Kernel op `mesh.applyTransform {matrix}` (M6A-SPEC §5.13, research 10 §4.19; owner B4; internal: the editor operator
// `mesh.freezeTransforms` and Bake Pivot run it, B12a). Positions p ← M·p, morph deltas by the linear part, custom
// normals by the inverse transpose (renormalized), every face reversed when det(M) < 0 so a mirrored freeze keeps
// outward winding. Refuses skinned meshes (`freeze.skinned`), non-matrices and singular matrices (`freeze.singular`:
// a zero scale would flatten the mesh). The selection is kept.
import type { ParamValues } from '@ekza-studio/anim-core';
import { SKIN_JOINTS, SKIN_WEIGHTS } from '../../layers/builtin';
import { refuse } from '../../refusal';
import { argsOf, keptSelection } from '../../subset/support';
import { applyMatrixToMesh, det3, isMatrix } from '../../subset/matrix';
import type { ComponentSelection, EditMesh, MeshOp, OpContext, OpResult, Refusal } from '../../types';
import { APPLY_TRANSFORM } from './descriptor';

function freezePoll(m: EditMesh): true | Refusal {
  if (m.layer(SKIN_JOINTS) !== undefined || m.layer(SKIN_WEIGHTS) !== undefined) {
    return refuse('freeze.skinned', 'Freezing would move a skinned mesh off its bones');
  }
  return true;
}

export const applyTransform: MeshOp = Object.freeze({
  ...APPLY_TRANSFORM,
  poll: (m: EditMesh) => freezePoll(m),
  run(m: EditMesh, sel: ComponentSelection | null, raw: ParamValues, _ctx: OpContext): OpResult | Refusal {
    const verdict = freezePoll(m);
    if (verdict !== true) return verdict;
    const args = argsOf(APPLY_TRANSFORM.params, raw);
    const matrix = args['matrix'];
    if (!isMatrix(matrix))
      return refuse('freeze.invalid-matrix', 'The transform must be 16 finite numbers (column-major 4×4)');
    const det = det3(matrix);
    const scale = Math.max(
      ...[0, 1, 2].map((c) =>
        Math.hypot(matrix[4 * c] as number, matrix[4 * c + 1] as number, matrix[4 * c + 2] as number),
      ),
    );
    if (!(Math.abs(det) > 1e-12 * Math.max(1, scale ** 3))) {
      return refuse('freeze.singular', 'Freezing a zero scale would flatten the mesh');
    }
    applyMatrixToMesh(m, matrix);
    return { selection: keptSelection(m, sel, sel?.kind ?? 'face'), warnings: [], resolvedArgs: args };
  },
});
