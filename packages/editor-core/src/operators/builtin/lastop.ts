// Last tool and the Last-op card (M6A-SPEC §6.2, §5.7): B0a stubs, owned by B11.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const LASTOP_OPERATORS: readonly AnyOperator[] = [
  stubOperator('tool.last', 'Last Tool', {
    category: 'tool',
    description: 'Re-activates the last viewport tool.',
    scope: 'model',
    workspaces: ['model'],
  }),
  stubOperator('view.lastOpCard', 'Adjust Last Operation', {
    category: 'view',
    description: "Opens the Last-op card with the last operation's parameters.",
    scope: 'model',
    extraArgs: ['expand', 'focusPrimary'],
    workspaces: ['model'],
    aliases: ['Redo Last', 'Adjust Last Operation'],
  }),
];
