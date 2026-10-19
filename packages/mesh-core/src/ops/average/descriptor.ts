// Descriptors of `mesh.averageVertices` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { fraction, int } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const AVERAGE_VERTICES: MeshOpDescriptor = {
  id: 'mesh.averageVertices',
  label: 'Average Vertices',
  kinds: ['vertex', 'edge', 'face'],
  params: [
    int('iterations', 'Iterations', 1, { min: 1, max: 20, primary: true }),
    fraction('strength', 'Strength', 0.5),
  ],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};
