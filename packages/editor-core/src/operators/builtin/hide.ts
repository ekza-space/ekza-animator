// Hide, show and isolate (M6A-SPEC §6.2, §5.6): B0a stubs, owned by B10. Hiding records a history selection part.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const HIDE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('view.hide', 'Hide', {
    category: 'view',
    description: 'Hides the selected (or unselected) objects or components.',
    scope: 'model',
    selection: true,
    extraArgs: ['target'],
    workspaces: ['model'],
  }),
  stubOperator('view.showAll', 'Show All', {
    category: 'view',
    description: 'Shows every hidden object and component.',
    scope: 'model',
    selection: true,
    workspaces: ['model'],
  }),
  stubOperator('view.isolate', 'Isolate Select', {
    category: 'view',
    description: 'Shows only the selection in the pane.',
    scope: 'model',
    extraArgs: ['paneId'],
    workspaces: ['model'],
  }),
];
