// Descriptors of `mesh.inset` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { SMOOTHING_ANGLE, bool, distance } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const INSET: MeshOpDescriptor = {
  id: 'mesh.inset',
  label: 'Inset',
  kinds: ['face'],
  params: [
    distance('offset', 'Offset', 0.05, { min: 0, primary: true }),
    distance('depth', 'Depth', 0),
    bool('individual', 'Individual', false),
    bool('evenOffset', 'Even Offset', true),
    bool('clamp', 'Clamp', true),
    SMOOTHING_ANGLE,
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
