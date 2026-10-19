// Descriptors of `mesh.quadrangulate` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { angle, bool } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const QUADRANGULATE: MeshOpDescriptor = {
  id: 'mesh.quadrangulate',
  label: 'Quadrangulate',
  kinds: ['face'],
  params: [
    angle('angle', 'Angle Threshold', 30, { min: 0, max: Math.PI, primary: true }),
    bool('keepHardEdges', 'Keep Hard Edges', true),
    bool('keepSeams', 'Keep Texture Borders', true),
    bool('keepMaterials', 'Keep Material Borders', true),
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
