// Make editable (M6A-SPEC §6.2, §5.21): B0a stub, owned by B8.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const MAKE_EDITABLE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('mesh.makeEditable', 'Make Editable', {
    category: 'mesh',
    scope: 'model',
    workspaces: ['model'],
    undo: true,
    description: "Turns a character's glTF mesh into an editable mesh record.",
    extraArgs: ['character', 'meshIndex'],
  }),
];
