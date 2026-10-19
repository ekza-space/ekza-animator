// Descriptors of `mesh.bridge` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { data, int, number } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const BRIDGE: MeshOpDescriptor = {
  id: 'mesh.bridge',
  label: 'Bridge',
  kinds: ['edge', 'face'],
  params: [
    int('divisions', 'Divisions', 0, { min: 0, max: 32, primary: true }),
    int('twist', 'Twist', 0),
    int('offset', 'Offset', 0),
    number('taper', 'Taper', 1, { min: 0.01, max: 10 }),
    data('loops', 'Loops', { type: 'array', items: { type: 'array', items: { type: 'integer', minimum: 0 } } }, null, {
      bound: 'selection',
    }),
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'pointer',
};
