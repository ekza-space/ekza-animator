// Descriptors of `mesh.harden`, `mesh.soften`, `mesh.setNormalAngle`, `mesh.reverse`, `mesh.conform` (M6A-SPEC §6.1; kernel owner B4). Eager: plain data, no kernel code.
// Final id, label, kinds, params, flags and symmetry class: params change only by a contract PR (§11.1 op freeze).
import { angle } from '../../paramKit';
import type { MeshOpDescriptor } from '../../types';

export const HARDEN: MeshOpDescriptor = {
  id: 'mesh.harden',
  label: 'Harden Edge',
  kinds: ['edge'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const SOFTEN: MeshOpDescriptor = {
  id: 'mesh.soften',
  label: 'Soften Edge',
  kinds: ['edge'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const SET_NORMAL_ANGLE: MeshOpDescriptor = {
  id: 'mesh.setNormalAngle',
  label: 'Set Normal Angle',
  kinds: ['edge'],
  params: [angle('angle', 'Angle', 30, { min: 0, max: Math.PI, primary: true })],
  flags: { adjustable: true, repeatable: true, topology: false, manifoldPreserving: true },
  symmetry: 'expand',
};

export const REVERSE: MeshOpDescriptor = {
  id: 'mesh.reverse',
  label: 'Reverse',
  kinds: ['face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'expand',
};

export const CONFORM: MeshOpDescriptor = {
  id: 'mesh.conform',
  label: 'Conform',
  kinds: ['face'],
  params: [],
  flags: { adjustable: false, repeatable: true, topology: true, manifoldPreserving: true },
  symmetry: 'none',
};
