// Descriptors of `mesh.flipTriangleEdge` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshOpDescriptor } from '../../types';

export const FLIP_TRIANGLE_EDGE: MeshOpDescriptor = {
  id: 'mesh.flipTriangleEdge',
  label: 'Flip Triangle Edge',
  kinds: ['edge', 'face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
