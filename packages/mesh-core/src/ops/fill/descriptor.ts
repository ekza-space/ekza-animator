// Descriptors of `mesh.fillHole` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshOpDescriptor } from '../../types';

export const FILL_HOLE: MeshOpDescriptor = {
  id: 'mesh.fillHole',
  label: 'Fill Hole',
  kinds: ['vertex', 'edge', 'face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};
