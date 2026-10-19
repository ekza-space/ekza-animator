// Descriptors of `mesh.separate` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshSetOpDescriptor } from '../../types';

export const SEPARATE: MeshSetOpDescriptor = {
  id: 'mesh.separate',
  label: 'Separate',
  arity: 'one',
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
};
