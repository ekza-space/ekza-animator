// Descriptors of `mesh.slide` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { data, number } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const SLIDE: MeshOpDescriptor = {
  id: 'mesh.slide',
  label: 'Slide Edge',
  kinds: ['vertex', 'edge'],
  params: [
    number('percent', 'Percent', 0, { min: -1, max: 1, primary: true }),
    data('reference', 'Reference', { type: 'object' }, null, { bound: 'pointer' }),
  ],
  flags: { adjustable: true, repeatable: false, topology: false, manifoldPreserving: true },
  symmetry: 'pointer',
};
