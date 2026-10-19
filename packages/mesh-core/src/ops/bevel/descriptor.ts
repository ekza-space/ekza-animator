// Descriptors of `mesh.bevel` (M6A-SPEC §6.1; kernel owner B5). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { SMOOTHING_ANGLE, bool, distance, fraction, int, number } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const BEVEL: MeshOpDescriptor = {
  id: 'mesh.bevel',
  label: 'Bevel',
  kinds: ['edge', 'face'],
  params: [
    fraction('fraction', 'Fraction', 0.5, { primary: true, description: '× ½ the shortest adjacent edge (Maya)' }),
    bool('offsetAsFraction', 'Offset as Fraction', true),
    distance('offset', 'Offset', 0.05, { min: 0 }),
    int('segments', 'Segments', 1, { min: 1, max: 3 }),
    bool('chamfer', 'Chamfer', true),
    number('roundness', 'Roundness', 0.5, { min: 0, max: 1 }),
    bool('clamp', 'Clamp', true),
    bool('hardenBorders', 'Harden Borders', true),
    SMOOTHING_ANGLE,
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
