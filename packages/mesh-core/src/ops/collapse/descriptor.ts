// Descriptors of `mesh.collapse` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshOpDescriptor } from '../../types';

export const COLLAPSE: MeshOpDescriptor = {
  id: 'mesh.collapse',
  label: 'Collapse',
  kinds: ['edge', 'face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};
