// Descriptors of `mesh.offsetLoop` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { bool, fraction } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const OFFSET_LOOP: MeshOpDescriptor = {
  id: 'mesh.offsetLoop',
  label: 'Offset Edge Loop',
  kinds: ['edge'],
  params: [
    fraction('offset', 'Offset', 0.25, { min: 0.01, max: 0.49, primary: true }),
    bool('deleteEnds', 'Delete Edges at the Ends', true),
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
