// Descriptors of `mesh.delete`, `mesh.deleteEdgeVertex` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import type { MeshOpDescriptor } from '../../types';

export const DELETE: MeshOpDescriptor = {
  id: 'mesh.delete',
  label: 'Delete',
  kinds: ['vertex', 'edge', 'face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};

export const DELETE_EDGE_VERTEX: MeshOpDescriptor = {
  id: 'mesh.deleteEdgeVertex',
  label: 'Delete Edge/Vertex',
  kinds: ['vertex', 'edge'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};
