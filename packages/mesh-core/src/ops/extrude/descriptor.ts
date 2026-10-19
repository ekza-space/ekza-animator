// Descriptors of `mesh.extrude` (M6A-SPEC §6.1; kernel owner B3). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { SMOOTHING_ANGLE, angle, bool, distance, enumOf, int, number } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const EXTRUDE: MeshOpDescriptor = {
  id: 'mesh.extrude',
  label: 'Extrude',
  kinds: ['face', 'edge'],
  params: [
    distance('localTranslateX', 'Local Translate X', 0),
    distance('localTranslateY', 'Local Translate Y', 0),
    distance('localTranslateZ', 'Local Translate Z', 0, { primary: true }),
    angle('localRotateX', 'Local Rotate X', 0),
    angle('localRotateY', 'Local Rotate Y', 0),
    angle('localRotateZ', 'Local Rotate Z', 0),
    number('localScaleX', 'Local Scale X', 1, { min: 0 }),
    number('localScaleY', 'Local Scale Y', 1, { min: 0 }),
    number('localScaleZ', 'Local Scale Z', 1, { min: 0 }),
    distance('offset', 'Offset', 0, { min: 0 }),
    distance('thickness', 'Thickness', 0),
    int('divisions', 'Divisions', 1, { min: 1, max: 32 }),
    bool('keepFacesTogether', 'Keep Faces Together', true),
    enumOf(
      'space',
      'Space',
      [
        ['local', 'Local'],
        ['world', 'World'],
      ],
      'local',
    ),
    SMOOTHING_ANGLE,
  ],
  flags: { adjustable: true, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};
