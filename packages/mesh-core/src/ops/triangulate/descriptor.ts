// Descriptors of `mesh.triangulate` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshOpDescriptor } from '../../types';

export const TRIANGULATE: MeshOpDescriptor = {
  id: 'mesh.triangulate',
  label: 'Triangulate',
  kinds: ['face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
