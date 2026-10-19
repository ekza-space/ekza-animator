// Descriptors of `mesh.spinEdge` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const SPIN_EDGE: MeshOpDescriptor = {
  id: 'mesh.spinEdge',
  label: 'Spin Edge',
  kinds: ['edge'],
  params: [
    enumOf(
      'direction',
      'Direction',
      [
        ['forward', 'Forward'],
        ['back', 'Backward'],
      ],
      'forward',
    ),
  ],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
