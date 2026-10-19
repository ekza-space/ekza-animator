// Descriptors of `mesh.mirror` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { SMOOTHING_ANGLE, axis, bool, distance, enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const MIRROR: MeshOpDescriptor = {
  id: 'mesh.mirror',
  label: 'Mirror',
  kinds: 'object',
  params: [
    axis('axis', 'Mirror Axis', 'x'),
    enumOf(
      'keep',
      'Direction',
      [
        ['positive', 'Positive'],
        ['negative', 'Negative'],
      ],
      'positive',
    ),
    enumOf(
      'position',
      'Mirror Axis Position',
      [
        ['object', 'Object'],
        ['world', 'World'],
      ],
      'object',
    ),
    bool('cutMesh', 'Cut Geometry', true),
    enumOf(
      'mergeMode',
      'Border',
      [
        ['merge', 'Merge border vertices'],
        ['none', 'Do not merge'],
      ],
      'merge',
    ),
    distance('mergeThreshold', 'Merge Threshold', 0.001, { min: 0, primary: true }),
    bool('flipUVs', 'Flip UVs', false),
    SMOOTHING_ANGLE,
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true, whole: true },
  symmetry: 'none',
};
