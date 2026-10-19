// Pivots and object transforms (M6A-SPEC §6.2, §5.13, §5.15): B0a stubs, owned by B12a.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const pivot = { category: 'mesh', scope: 'model', workspaces: ['model'], undo: true } as const;

export const PIVOT_OPERATORS: readonly AnyOperator[] = [
  stubOperator('model.pivot.editToggle', 'Edit Pivot', {
    category: 'model',
    scope: 'model',
    workspaces: ['model'],
    description: 'Moves the pivot instead of the object or components.',
  }),
  stubOperator('mesh.pivot.set', 'Set Pivot', {
    ...pivot,
    description: 'Sets the rotate/scale pivot of a mesh or group.',
    extraArgs: ['id', 'pivot'],
  }),
  stubOperator('mesh.pivot.center', 'Center Pivot', {
    ...pivot,
    description: 'Moves the pivot to the centre of the bounds.',
    extraArgs: ['ids'],
  }),
  stubOperator('mesh.pivot.bottomCenter', 'Bottom Center Pivot', {
    ...pivot,
    description: 'Moves the pivot to the bottom centre of the bounds.',
    extraArgs: ['ids'],
  }),
  stubOperator('mesh.pivot.reset', 'Reset Pivot', {
    ...pivot,
    description: 'Moves the pivot back to the object origin.',
    extraArgs: ['ids'],
  }),
  stubOperator('mesh.pivot.bake', 'Bake Pivot', {
    ...pivot,
    description: 'Makes the pivot the object origin without moving the mesh.',
    extraArgs: ['ids'],
  }),
  stubOperator('mesh.resetTransforms', 'Reset Transformations', {
    ...pivot,
    description: 'Resets the object transforms of the selection.',
    extraArgs: ['ids'],
  }),
  stubOperator('mesh.freezeTransforms', 'Freeze Transformations', {
    ...pivot,
    description: 'Bakes the object transforms into the mesh data.',
    adjustable: true,
    repeatable: true,
    extraArgs: ['ids', 'translate', 'rotate', 'scale'],
    aliases: ['Apply Transform'],
  }),
  stubOperator('scene.object.transform', 'Move', {
    ...pivot,
    category: 'scene',
    description: 'Commits object moves, rotations and scales in Model.',
    extraArgs: ['ids', 'placements'],
    internal: true,
  }),
];
