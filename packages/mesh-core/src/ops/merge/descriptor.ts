// Descriptors of `mesh.merge`, `mesh.mergeToCenter`, `mesh.mergeByDistance` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { bool, distance } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const MERGE: MeshOpDescriptor = {
  id: 'mesh.merge',
  label: 'Merge',
  kinds: ['vertex', 'edge', 'face'],
  params: [
    distance('distance', 'Threshold', 0.001, { min: 0, primary: true }),
    bool('alwaysMergeTwo', 'Always Merge for Two Vertices', true),
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};

export const MERGE_TO_CENTER: MeshOpDescriptor = {
  id: 'mesh.mergeToCenter',
  label: 'Merge to Center',
  kinds: ['vertex', 'edge', 'face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false },
  symmetry: 'expand',
};

export const MERGE_BY_DISTANCE: MeshOpDescriptor = {
  id: 'mesh.mergeByDistance',
  label: 'Merge by Distance',
  kinds: 'object',
  params: [distance('distance', 'Distance', 0.0001, { min: 0, primary: true })],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: false, whole: true },
  symmetry: 'none',
};
