// Descriptors of `mesh.connect` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { fraction } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const CONNECT: MeshOpDescriptor = {
  id: 'mesh.connect',
  label: 'Connect',
  kinds: ['vertex', 'edge'],
  params: [fraction('weight', 'Weight', 0.5, { primary: true })],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
