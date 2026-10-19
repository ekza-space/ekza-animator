// MeshSetOp `mesh.duplicateFaces {separate, offset}` (M6A-SPEC §5.13; Maya Duplicate Face; owner B4; runner B7).
// Copies the selected faces (`copySubset`): with `separate` (default) as a new record ("Duplicated") with the input's
// placement and slots, else as a new shell in the same mesh (the new face selection). `offset` insets the copy's
// boundary (`duplicate.offset-clamped`). On an asset-backed mesh it is the one MeshSetOp allowed in M6a: it makes an
// authored static copy without skin and morph layers (`duplicate.static-copy`); the in-place variant would change the
// asset's topology and is refused.
import type { ParamValues } from '@ekza-animator/anim-core';
import { refuse } from '../../refusal';
import { copySubset } from '../../subset/copy';
import { bitsOf, detachInPlace, insetData, selectedFaces } from '../../subset/setops';
import { argsOf, bool, guarded, num } from '../../subset/support';
import type { MeshSetInput, MeshSetOp, MeshSetOutput, MeshSetResult, OpContext, OpWarning, Refusal } from '../../types';
import { DUPLICATE_FACES } from './descriptor';

function duplicatePoll(inputs: readonly MeshSetInput[], args: ParamValues): true | Refusal {
  if (!inputs.some((input) => selectedFaces(input).length > 0)) {
    return refuse('duplicate.no-faces', 'Select the faces to duplicate');
  }
  if (args['separate'] === false && inputs.some((input) => input.assetBacked)) {
    return refuse(
      'duplicate.asset-backed',
      'Meshes of imported characters keep their topology: duplicate the faces as a separate mesh',
    );
  }
  return true;
}

/** Static copies of asset-backed meshes drop skin and morph layers. */
function staticLayers(input: MeshSetInput): 'all' | string[] {
  if (!input.assetBacked) return 'all';
  return input.mesh
    .layers()
    .map((layer) => layer.def.name)
    .filter((name) => !name.startsWith('skin.') && !name.startsWith('morph:'));
}

export const duplicateFaces: MeshSetOp = Object.freeze({
  ...DUPLICATE_FACES,
  poll: (inputs: readonly MeshSetInput[], args: ParamValues) =>
    duplicatePoll(inputs, argsOf(DUPLICATE_FACES.params, args)),
  run(
    inputs: readonly MeshSetInput[],
    raw: ParamValues,
    _ctx: Omit<OpContext, 'placement' | 'symmetry' | 'soft'>,
  ): MeshSetResult | Refusal {
    const args = argsOf(DUPLICATE_FACES.params, raw);
    const verdict = duplicatePoll(inputs, args);
    if (verdict !== true) return verdict;
    const separateFaces = bool(args, 'separate', true);
    const offset = num(args, 'offset', 0);
    return guarded('duplicate.failed', 'The faces could not be duplicated', () => {
      const outputs: MeshSetOutput[] = [];
      const warnings: OpWarning[] = [];
      let n = 0;
      for (const input of inputs) {
        const m = input.mesh;
        const faces = selectedFaces(input);
        if (faces.length === 0) continue;
        if (!separateFaces) {
          const copy = detachInPlace(m, faces, input.materials, offset, 'duplicate.offset-clamped', false);
          warnings.push(...copy.warnings);
          outputs.push({
            key: input.key,
            data: m.snapshot(),
            placement: input.placement,
            materials: input.materials,
            from: [input.key],
            selection: copy.selection,
            name: '',
          });
          continue;
        }
        const layers = staticLayers(input);
        if (layers !== 'all') {
          warnings.push({
            code: 'duplicate.static-copy',
            message: 'The copy is a static authored mesh: skin and expressions were left out',
          });
        }
        const copy = insetData(
          copySubset(m, bitsOf(m.counts.faces, faces), { layers }).data,
          offset,
          'duplicate.offset-clamped',
        );
        warnings.push(...copy.warnings);
        outputs.push({
          key: `new:${n++}`,
          data: copy.data,
          placement: input.placement,
          materials: input.materials,
          from: [input.key],
          selection: null,
          name: 'Duplicated',
        });
      }
      return { outputs, removed: [], warnings };
    });
  },
});
