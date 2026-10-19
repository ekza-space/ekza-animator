// Reference image planes (M6A-SPEC §6.2, §5.26): B0a stubs, owned by B13.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const plane = { category: 'imagePlane', scope: 'model', workspaces: ['model'], undo: true } as const;

export const IMAGE_PLANE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('imagePlane.import', 'Import Image Plane', {
    ...plane,
    description: 'Adds a reference image to the front, side or top view.',
    extraArgs: ['camera', 'name', 'bytes'],
  }),
  stubOperator('imagePlane.set', 'Image Plane Settings', {
    ...plane,
    description: "Changes an image plane's offset, size, opacity, depth, lock or visibility.",
    extraArgs: ['id', 'patch'],
    internal: true,
  }),
  stubOperator('imagePlane.delete', 'Delete Image Plane', {
    ...plane,
    description: 'Removes a reference image plane.',
    extraArgs: ['id'],
  }),
];
