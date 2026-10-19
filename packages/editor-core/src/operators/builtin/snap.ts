// Sticky snapping toggles (M6A-SPEC §6.2): B0a stub, owned by B12a.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const SNAP_OPERATORS: readonly AnyOperator[] = [
  stubOperator('model.snap.toggle', 'Snap', {
    category: 'model',
    description: 'Toggles grid, vertex or increment snapping for transforms.',
    scope: 'model',
    extraArgs: ['kind'],
    workspaces: ['model'],
  }),
];
