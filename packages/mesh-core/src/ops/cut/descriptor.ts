// Descriptors of `mesh.cut` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { data } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const CUT: MeshOpDescriptor = {
  id: 'mesh.cut',
  label: 'Multi-Cut',
  kinds: ['vertex', 'edge', 'face'],
  params: [
    data(
      'points',
      'Points',
      {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind'],
          properties: {
            kind: { enum: ['edge', 'vertex'] },
            edge: { type: 'integer', minimum: 0 },
            t: { type: 'number', minimum: 0, maximum: 1 },
            vertex: { type: 'integer', minimum: 0 },
          },
        },
      },
      null,
      { bound: 'pointer' },
    ),
  ],
  flags: { adjustable: false, repeatable: false, topology: true, manifoldPreserving: true },
  symmetry: 'pointer',
};
