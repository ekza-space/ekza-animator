// Scene objects: groups, parenting, duplicates, deletion and mesh attributes (M6A-SPEC §6.2, §5.13): B0a stubs,
// owned by B13.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const scene = { category: 'scene', scope: 'model', workspaces: ['model'], undo: true } as const;

export const SCENE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('scene.group', 'Group', {
    ...scene,
    description: 'Groups the selected objects under a new transform node.',
    extraArgs: ['ids'],
  }),
  stubOperator('scene.parent', 'Parent', {
    ...scene,
    description: 'Parents the selected objects to the last selected one.',
    extraArgs: ['ids', 'parent'],
  }),
  stubOperator('scene.unparent', 'Unparent', {
    ...scene,
    description: 'Moves the selected objects to the top level, keeping their world placement.',
    extraArgs: ['ids'],
  }),
  stubOperator('scene.duplicate', 'Duplicate', {
    ...scene,
    description: 'Duplicates the selected objects.',
    repeatable: true,
    extraArgs: ['ids'],
  }),
  stubOperator('scene.delete', 'Delete Objects', {
    ...scene,
    description: 'Deletes the selected objects.',
    extraArgs: ['ids'],
  }),
  stubOperator('scene.rename', 'Rename', {
    ...scene,
    description: 'Renames a mesh or group.',
    extraArgs: ['id', 'name'],
    internal: true,
  }),
  stubOperator('mesh.setAttributes', 'Mesh Attributes', {
    ...scene,
    category: 'mesh',
    description: "Changes a mesh's name, faceting, colour output, material, budget, grip or palette.",
    extraArgs: ['mesh', 'patch'],
    internal: true,
  }),
];
