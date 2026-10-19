// Descriptors of `mesh.insertLoop` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { enumOf, fraction, int } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const INSERT_LOOP: MeshOpDescriptor = {
  id: 'mesh.insertLoop',
  label: 'Insert Edge Loop',
  kinds: ['edge'],
  params: [
    int('seedEdge', 'Seed Edge', null, { bound: 'selection', min: 0 }),
    enumOf(
      'mode',
      'Mode',
      [
        ['relative', 'Relative distance'],
        ['equal', 'Equal distance'],
        ['multiple', 'Multiple edge loops'],
      ],
      'relative',
    ),
    fraction('weight', 'Weight', 0.5, { primary: true }),
    int('divisions', 'Number of Loops', 2, { min: 1, max: 16 }),
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'pointer',
};
