// MeshSetOp `mesh.separate` (M6A-SPEC §5.13; DCC-standard Separate; owner B4; runner B7). One output per shell (faces
// connected through shared vertices), each keeping the input's placement and material slots: the shell with the lowest
// face index stays in the input record, the others become new records named after the input ("<name> 2", "3"…: the runner numbers them). Loose
// vertices and wire edges belong to no shell and are dropped (`separate.loose-dropped`). Several inputs separate one
// by one. Refusals: asset-backed inputs (M6a), a mesh with a single shell.
import type { ParamValues } from '@ekza-studio/anim-core';
import { refuse } from '../../refusal';
import { copySubset } from '../../subset/copy';
import { bitsOf, shells } from '../../subset/setops';
import { argsOf, faceCorners } from '../../subset/support';
import type { MeshSetInput, MeshSetOp, MeshSetOutput, MeshSetResult, OpContext, OpWarning, Refusal } from '../../types';
import { SEPARATE } from './descriptor';

function separatePoll(inputs: readonly MeshSetInput[]): true | Refusal {
  if (inputs.length === 0) return refuse('separate.no-mesh', 'Select a mesh to separate');
  if (inputs.some((input) => input.assetBacked)) {
    return refuse('separate.asset-backed', 'Meshes of imported characters cannot be separated yet');
  }
  if (!inputs.some((input) => shells(input.mesh).length > 1)) {
    return refuse('separate.single-shell', 'The mesh is one piece: nothing to separate');
  }
  return true;
}

export const separate: MeshSetOp = Object.freeze({
  ...SEPARATE,
  poll: (inputs: readonly MeshSetInput[]) => separatePoll(inputs),
  run(
    inputs: readonly MeshSetInput[],
    raw: ParamValues,
    _ctx: Omit<OpContext, 'placement' | 'symmetry' | 'soft'>,
  ): MeshSetResult | Refusal {
    const verdict = separatePoll(inputs);
    if (verdict !== true) return verdict;
    argsOf(SEPARATE.params, raw);
    const outputs: MeshSetOutput[] = [];
    const warnings: OpWarning[] = [];
    let n = 0;
    for (const input of inputs) {
      const m = input.mesh;
      const pieces = shells(m);
      if (pieces.length < 2) continue;
      const used = new Uint8Array(m.counts.points);
      for (let f = 0; f < m.counts.faces; f++) for (const c of faceCorners(m, f)) used[m.cornerVert(c)] = 1;
      const loose = used.reduce((count, u) => count + (u === 0 ? 1 : 0), 0);
      let wire = 0;
      for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 0) wire++;
      if (loose + wire > 0) {
        warnings.push({
          code: 'separate.loose-dropped',
          message: 'Loose vertices and edges belong to no shell and were dropped',
          count: loose + wire,
        });
      }
      pieces.forEach((faces, i) => {
        outputs.push({
          key: i === 0 ? input.key : `new:${n++}`,
          data: copySubset(m, bitsOf(m.counts.faces, faces)).data,
          placement: input.placement,
          materials: input.materials,
          from: [input.key],
          selection: null,
          name: '', // the input's name: the runner numbers new records "<name> 2", "3"… (§5.13)
        });
      });
    }
    if (outputs.length === 0) return refuse('separate.single-shell', 'The mesh is one piece: nothing to separate');
    return { outputs, removed: [], warnings };
  },
});
