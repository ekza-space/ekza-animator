// Primitive creation (M6A-SPEC §6.2, §5.16): B0a stubs with the final §6.3 parameters, owned by B7 (B1 kernel; the
// reference kernel builds cube, plane and cylinder until `READY.b1`).
import { PRIMITIVE_PARAMS } from '@ekza-animator/mesh-core/descriptors';
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const create = {
  category: 'mesh',
  scope: 'model',
  workspaces: ['model'],
  undo: true,
  adjustable: true,
  repeatable: true,
} as const;

export const CREATE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('mesh.create.cube', 'Cube', {
    ...create,
    description: 'Creates a polygon cube at the origin.',
    params: PRIMITIVE_PARAMS.cube,
    aliases: ['Box'],
  }),
  stubOperator('mesh.create.sphere', 'Sphere', {
    ...create,
    description: 'Creates a polygon sphere at the origin.',
    params: PRIMITIVE_PARAMS.sphere,
    aliases: ['UV Sphere'],
  }),
  stubOperator('mesh.create.cylinder', 'Cylinder', {
    ...create,
    description: 'Creates a polygon cylinder at the origin.',
    params: PRIMITIVE_PARAMS.cylinder,
  }),
  stubOperator('mesh.create.cone', 'Cone', {
    ...create,
    description: 'Creates a polygon cone at the origin.',
    params: PRIMITIVE_PARAMS.cone,
  }),
  stubOperator('mesh.create.plane', 'Plane', {
    ...create,
    description: 'Creates a polygon plane at the origin.',
    params: PRIMITIVE_PARAMS.plane,
    aliases: ['Grid'],
  }),
  stubOperator('mesh.create.torus', 'Torus', {
    ...create,
    description: 'Creates a polygon torus at the origin.',
    params: PRIMITIVE_PARAMS.torus,
  }),
];
