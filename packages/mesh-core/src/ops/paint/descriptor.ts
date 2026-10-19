// Descriptors of `mesh.paint`, `mesh.paint.fillShell`, `mesh.paint.remap` (M6A-SPEC §6.1; kernel owner B13). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { INTS, data, int } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const PAINT: MeshOpDescriptor = {
  id: 'mesh.paint',
  label: 'Assign Colour',
  kinds: ['face'],
  params: [
    int('slot', 'Swatch Slot', 0, { min: 0, max: 65_534, primary: true }),
    data('faces', 'Faces', INTS, null, { bound: 'pointer' }),
  ],
  flags: { adjustable: false, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const PAINT_FILL_SHELL: MeshOpDescriptor = {
  id: 'mesh.paint.fillShell',
  label: 'Fill Shell',
  kinds: ['face'],
  params: [
    int('slot', 'Swatch Slot', 0, { min: 0, max: 65_534 }),
    data('face', 'Face', { type: 'integer', minimum: 0 }, null, { bound: 'pointer' }),
  ],
  flags: { adjustable: false, repeatable: false, topology: false, manifoldPreserving: true },
  symmetry: 'pointer',
};

export const PAINT_REMAP: MeshOpDescriptor = {
  id: 'mesh.paint.remap',
  label: 'Replace Swatch',
  kinds: 'object',
  params: [int('from', 'From Slot', 0, { min: 0, max: 65_534 }), int('to', 'To Slot', 0, { min: 0, max: 65_534 })],
  flags: { adjustable: false, repeatable: false, topology: false, manifoldPreserving: true, whole: true },
  symmetry: 'none',
};
