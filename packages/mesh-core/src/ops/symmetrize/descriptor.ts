// Descriptors of `mesh.symmetrize` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { axis, distance, enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const SYMMETRIZE: MeshOpDescriptor = {
  id: 'mesh.symmetrize',
  label: 'Symmetrize',
  kinds: ['vertex'],
  params: [
    axis('axis', 'Axis', 'x'),
    enumOf(
      'keep',
      'Direction',
      [
        ['positive', 'Positive'],
        ['negative', 'Negative'],
      ],
      'positive',
    ),
    distance('tolerance', 'Tolerance', null, { min: 0 }),
  ],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'none',
};
