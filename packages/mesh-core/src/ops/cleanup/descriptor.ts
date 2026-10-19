// Descriptors of `mesh.cleanup` (M6A-SPEC §6.1; kernel owner B5). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { bool, enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const CLEANUP: MeshOpDescriptor = {
  id: 'mesh.cleanup',
  label: 'Cleanup',
  kinds: 'object',
  params: [
    enumOf(
      'fix',
      'Fix',
      [
        ['select', 'Select matching'],
        ['deleteLamina', 'Delete lamina faces'],
        ['collapse', 'Collapse degenerate'],
        ['conform', 'Conform normals'],
        ['triangulate', 'Triangulate'],
        ['dissolve', 'Dissolve stray vertices'],
        ['deleteLoose', 'Delete loose geometry'],
      ],
      'select',
      { primary: true },
    ),
    bool('selectOnly', 'Select Matching Only', true),
  ],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: false, whole: true },
  symmetry: 'none',
};
