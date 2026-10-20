// Descriptors of `mesh.extract` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { bool, distance } from '../../paramKit';
import type { MeshSetOpDescriptor } from '../../types';

export const EXTRACT: MeshSetOpDescriptor = {
  id: 'mesh.extract',
  label: 'Extract',
  arity: 'one',
  params: [bool('separate', 'Separate Extracted Faces', true), distance('offset', 'Offset', 0, { primary: true })],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: false },
};
