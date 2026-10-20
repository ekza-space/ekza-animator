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
      // 'first' (acceptance fix round 1, DECISIONS-OPEN §J): the result keeps the lead's object origin, so an Object X
      // symmetry plane on the lead stays on its seam ('center' moved the origin to the bounds centre and silently
      // broke mirrored tools).
      'first',
    ),
  ],
  flags: { adjustable: true, repeatable: false, topology: true, manifoldPreserving: true },
};
