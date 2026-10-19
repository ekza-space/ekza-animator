// Descriptors of `mesh.applyTransform` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { NUMBERS, data } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const APPLY_TRANSFORM: MeshOpDescriptor = {
  id: 'mesh.applyTransform',
  label: 'Apply Transform',
  kinds: 'object',
  params: [data('matrix', 'Matrix', NUMBERS, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])],
  flags: { adjustable: false, repeatable: false, topology: true, manifoldPreserving: true, whole: true },
  symmetry: 'none',
};
