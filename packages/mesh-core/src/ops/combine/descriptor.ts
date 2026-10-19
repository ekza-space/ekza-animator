// Descriptors of `mesh.combine` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { enumOf } from '../../paramKit';
import type { MeshSetOpDescriptor } from '../../types';

export const COMBINE: MeshSetOpDescriptor = {
  id: 'mesh.combine',
  label: 'Combine',
  arity: 'many',
  params: [
    enumOf(
      'pivot',
      'Pivot',
      [
        ['center', 'Center'],
        ['first', 'First selected'],
        ['origin', 'Origin'],
      ],
      'center',
    ),
  ],
  flags: { adjustable: true, repeatable: false, topology: true, manifoldPreserving: true },
};
