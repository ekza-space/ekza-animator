// MeshSetOp `mesh.combine {pivot}` (M6A-SPEC §5.13; owner B4; runner B7). Appends every other input into the first
// (the lead, first selected) with `appendMesh`, each input's geometry moved into the result's space: `pivot` 'first'
// (the lead's placement, the default: its object origin and symmetry plane stay put), 'center' (the centre of the
// combined world bounds, unrotated, unit scale) or 'origin' (identity). An input whose transform into the result has a negative determinant (Maya's mirror route:
// duplicate, scale X −1, Combine) is appended with reversed winding, so it faces outward. Material slots unite by
// identity key, morph layers by name, joint palettes by joint id. Refusals: fewer than two meshes, asset-backed inputs
// (M6a), different palettes (`combine.palette-mismatch`, "assign it first") or skeletons (`combine.skeleton-mismatch`).
// The other inputs are removed.
import { mat4Invert, mat4Multiply, type ParamValues, type ReadonlyXf } from '@ekza-studio/anim-core';
import { refuse } from '../../refusal';
import { appendMeshMatrix } from '../../subset/append';
import { applyMatrixToMesh, matrixOf, transformPoint } from '../../subset/matrix';
import { argsOf, guarded, str } from '../../subset/support';
import type { MeshSetInput, MeshSetOp, MeshSetResult, OpContext, Refusal } from '../../types';
import { COMBINE } from './descriptor';

function combinePoll(inputs: readonly MeshSetInput[]): true | Refusal {
  if (inputs.length < 2) return refuse('combine.needs-two', 'Combine needs two or more meshes');
  if (inputs.some((input) => input.assetBacked)) {
    return refuse(
      'combine.asset-backed',
      'Meshes of imported characters cannot be combined yet; Duplicate Face makes an authored copy',
    );
  }
  const palettes = new Set(inputs.map((input) => input.palette).filter((p) => p !== null));
  if (palettes.size > 1) return refuse('combine.palette-mismatch', 'Combine needs one palette: assign it first');
  if (new Set(inputs.map((input) => input.skeleton)).size > 1) {
    return refuse('combine.skeleton-mismatch', 'Combine needs meshes bound to the same skeleton');
  }
  return true;
}

const OUT = new Float64Array(3);

/** World bounds of every input's vertices. */
function worldBounds(inputs: readonly MeshSetInput[]): [number[], number[]] | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const input of inputs) {
    const P = matrixOf(input.placement);
    const p = input.mesh.position;
    for (let v = 0; v < input.mesh.counts.points; v++) {
      transformPoint(P, p[3 * v] as number, p[3 * v + 1] as number, p[3 * v + 2] as number, OUT);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, OUT[k] as number);
        max[k] = Math.max(max[k] as number, OUT[k] as number);
      }
    }
  }
  return Number.isFinite(min[0]) ? [min, max] : null;
}

export const combine: MeshSetOp = Object.freeze({
  ...COMBINE,
  poll: (inputs: readonly MeshSetInput[]) => combinePoll(inputs),
  run(
    inputs: readonly MeshSetInput[],
    raw: ParamValues,
    _ctx: Omit<OpContext, 'placement' | 'symmetry' | 'soft'>,
  ): MeshSetResult | Refusal {
    const verdict = combinePoll(inputs);
    if (verdict !== true) return verdict;
    const args = argsOf(COMBINE.params, raw);
    const pivot = str<string>(args, 'pivot', 'first');
    const lead = inputs[0] as MeshSetInput;
    let placement: ReadonlyXf = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    if (pivot === 'first') placement = lead.placement;
    else if (pivot === 'center') {
      const bounds = worldBounds(inputs);
      if (bounds !== null) {
        const [min, max] = bounds;
        placement = {
          t: [0, 1, 2].map((k) => ((min[k] as number) + (max[k] as number)) / 2 + 0) as [number, number, number],
          q: [0, 0, 0, 1],
          s: [1, 1, 1],
        };
      }
    }
    const inverse = mat4Invert(matrixOf(placement));
    if (inverse === null) return refuse('combine.placement', 'The first mesh has a zero scale');
    const keys = guarded('combine.failed', 'The meshes could not be combined', () => {
      const a = lead.mesh;
      if (pivot !== 'first') applyMatrixToMesh(a, mat4Multiply(inverse, matrixOf(lead.placement)));
      const united = [...lead.materials];
      for (const input of inputs.slice(1)) {
        const data = input.mesh.snapshot();
        const matrix = mat4Multiply(inverse, matrixOf(input.placement));
        const { result } = appendMeshMatrix(a, data, matrix, [united, input.materials]);
        result.materialSlots.forEach((slot, s) => {
          const key = input.materials[s];
          if (key !== undefined && slot >= united.length) united[slot] = key;
        });
      }
      return united;
    });
    if ('refused' in keys) return keys;
    return {
      outputs: [
        {
          key: lead.key,
          data: lead.mesh.snapshot(),
          placement,
          materials: keys,
          from: inputs.map((input) => input.key),
          selection: null,
          name: '',
        },
      ],
      removed: inputs.slice(1).map((input) => input.key),
      warnings: [],
    };
  },
});
