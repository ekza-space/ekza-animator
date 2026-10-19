// Descriptors of `mesh.uv.planar`, `mesh.uv.box`, `mesh.uv.cylindrical` (M6A-SPEC §6.1; kernel owner B5). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { axis, bool, data, enumOf } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const UV_PLANAR: MeshOpDescriptor = {
  id: 'mesh.uv.planar',
  label: 'Planar Mapping',
  kinds: ['face'],
  params: [
    enumOf(
      'axis',
      'Project from',
      [
        ['x', 'X axis'],
        ['y', 'Y axis'],
        ['z', 'Z axis'],
        ['camera', 'Camera'],
      ],
      'y',
    ),
    bool('fit', 'Keep Image Ratio (fit 0–1)', true),
    data('camera', 'Camera', { type: 'object' }, null),
  ],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const UV_BOX: MeshOpDescriptor = {
  id: 'mesh.uv.box',
  label: 'Automatic Mapping',
  kinds: ['face'],
  params: [bool('fit', 'Keep Image Ratio (fit 0–1)', true)],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const UV_CYLINDRICAL: MeshOpDescriptor = {
  id: 'mesh.uv.cylindrical',
  label: 'Cylindrical Mapping',
  kinds: ['face'],
  params: [axis('axis', 'Axis', 'y'), bool('fit', 'Keep Image Ratio (fit 0–1)', true)],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};
