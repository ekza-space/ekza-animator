// MeshSetOp `mesh.extract {separate, offset}` (M6A-SPEC §5.13; Maya Extract; owner B4; runner B7). Detaches the
// selected faces: their boundary vertices are duplicated so they form their own shell; with `separate` (default) the
// shell becomes a new record ("Extracted") with the input's placement and slots, else it stays in the mesh (and is the
// new face selection). `offset` insets the extracted faces' boundary (./subset/inset; `extract.offset-clamped`). The
// input keeps every other face, edge and vertex. Refusals: asset-backed inputs (M6a), no selected faces, every face
// selected with `separate` (nothing would stay).
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import { copySubset } from '../../subset/copy';
import { bitsOf, detachInPlace, insetData, removeFaces, selectedFaces } from '../../subset/setops';
import { argsOf, bool, guarded, num } from '../../subset/support';
import type { MeshSetInput, MeshSetOp, MeshSetOutput, MeshSetResult, OpContext, OpWarning, Refusal } from '../../types';
import { EXTRACT } from './descriptor';

function extractPoll(inputs: readonly MeshSetInput[], args: ParamValues): true | Refusal {
  if (inputs.some((input) => input.assetBacked)) {
    return refuse('extract.asset-backed', 'Faces of imported characters cannot be extracted yet; use Duplicate Face');
  }
  if (!inputs.some((input) => selectedFaces(input).length > 0)) {
    return refuse('extract.no-faces', 'Select the faces to extract');
  }
  // Only an input that gives up faces must keep some (a mesh without faces or selected faces is skipped).
  const takesAll = (input: MeshSetInput) => {
    const n = selectedFaces(input).length;
    return n > 0 && n === input.mesh.counts.faces;
  };
  if (bool(args, 'separate', true) && inputs.some(takesAll)) {
    return refuse('extract.all-faces', 'Extract needs some faces to stay: select fewer faces');
  }
  return true;
}

export const extract: MeshSetOp = Object.freeze({
  ...EXTRACT,
  poll: (inputs: readonly MeshSetInput[], args: ParamValues) => extractPoll(inputs, argsOf(EXTRACT.params, args)),
  run(
    inputs: readonly MeshSetInput[],
    raw: ParamValues,
    _ctx: Omit<OpContext, 'placement' | 'symmetry' | 'soft'>,
  ): MeshSetResult | Refusal {
    const args = argsOf(EXTRACT.params, raw);
    const verdict = extractPoll(inputs, args);
    if (verdict !== true) return verdict;
    const separateFaces = bool(args, 'separate', true);
    const offset = num(args, 'offset', 0);
    return guarded('extract.failed', 'The faces could not be extracted', () => {
      const outputs: MeshSetOutput[] = [];
      const warnings: OpWarning[] = [];
      let n = 0;
      for (const input of inputs) {
        const m = input.mesh;
        const faces = selectedFaces(input);
        if (faces.length === 0) continue;
        if (!separateFaces) {
          const detached = detachInPlace(m, faces, input.materials, offset, 'extract.offset-clamped', true);
          warnings.push(...detached.warnings);
          outputs.push({
            key: input.key,
            data: m.snapshot(),
            placement: input.placement,
            materials: input.materials,
            from: [input.key],
            selection: detached.selection,
            name: '',
          });
          continue;
        }
        const shell = insetData(copySubset(m, bitsOf(m.counts.faces, faces)).data, offset, 'extract.offset-clamped');
        warnings.push(...shell.warnings);
        removeFaces(m, faces);
        outputs.push({
          key: input.key,
          data: m.snapshot(),
          placement: input.placement,
          materials: input.materials,
          from: [input.key],
          selection: null,
          name: '',
        });
        outputs.push({
          key: `new:${n++}`,
          data: shell.data,
          placement: input.placement,
          materials: input.materials,
          from: [input.key],
          selection: null,
          name: 'Extracted',
        });
      }
      return { outputs, removed: [], warnings };
    });
  },
});
