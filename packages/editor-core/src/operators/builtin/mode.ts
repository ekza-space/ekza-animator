// Component modes and hilite (M6A-SPEC §6.2, §5.6): B0a stubs, owned by B10.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const MODE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('select.mode', 'Selection Mode', {
    category: 'select',
    description: 'Switches between object mode and the vertex, edge and face component modes.',
    scope: 'model',
    extraArgs: ['mode'],
    workspaces: ['model'],
  }),
  stubOperator('model.hilite', 'Hilite Meshes', {
    category: 'model',
    description: 'Adds, replaces or removes the meshes whose components are edited.',
    scope: 'model',
    extraArgs: ['meshes', 'mode'],
    workspaces: ['model'],
    internal: true,
  }),
];
