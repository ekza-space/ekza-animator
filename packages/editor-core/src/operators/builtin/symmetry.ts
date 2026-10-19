// Modeling symmetry (M6A-SPEC §6.2, §5.14): B0a stub, owned by B12a.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const SYMMETRY_OPERATORS: readonly AnyOperator[] = [
  stubOperator('model.symmetry.set', 'Symmetry', {
    category: 'model',
    description: 'Sets the symmetry mode, tolerance and seam rule of the hilited or selected meshes.',
    scope: 'model',
    extraArgs: ['meshes', 'mode', 'tolerance', 'preserveSeam'],
    workspaces: ['model'],
  }),
];
