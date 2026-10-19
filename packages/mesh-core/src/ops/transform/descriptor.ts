// Descriptors of `mesh.transformComponents` (M6A-SPEC §6.1; kernel owner B2). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { NUMBERS, angle, data, distance, enumOf, number } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const TRANSFORM_COMPONENTS: MeshOpDescriptor = {
  id: 'mesh.transformComponents',
  label: 'Move',
  kinds: ['vertex', 'edge', 'face'],
  params: [
    distance('translateX', 'Translate X', 0),
    distance('translateY', 'Translate Y', 0),
    distance('translateZ', 'Translate Z', 0),
    angle('rotateX', 'Rotate X', 0),
    angle('rotateY', 'Rotate Y', 0),
    angle('rotateZ', 'Rotate Z', 0),
    number('scaleX', 'Scale X', 1),
    number('scaleY', 'Scale Y', 1),
    number('scaleZ', 'Scale Z', 1),
    data('pivot', 'Pivot', NUMBERS, null, { bound: 'selection' }),
    data('orientation', 'Orientation', NUMBERS, null, { bound: 'selection' }),
    enumOf(
      'space',
      'Space',
      [
        ['world', 'World'],
        ['object', 'Object'],
        ['component', 'Component'],
      ],
      'world',
    ),
  ],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};
