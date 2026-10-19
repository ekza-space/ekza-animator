// Descriptors of `mesh.targetWeld` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { data, enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const TARGET_WELD: MeshOpDescriptor = {
  id: 'mesh.targetWeld',
  label: 'Target Weld',
  kinds: ['vertex', 'edge'],
  params: [
    data('pairs', 'Pairs', { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 } } }, null, {
      bound: 'pointer',
    }),
    enumOf(
      'mode',
      'Target',
      [
        ['target', 'Target'],
        ['center', 'Center'],
      ],
      'target',
    ),
  ],
  flags: { adjustable: true, repeatable: false, topology: true, manifoldPreserving: false },
  symmetry: 'pointer',
};
