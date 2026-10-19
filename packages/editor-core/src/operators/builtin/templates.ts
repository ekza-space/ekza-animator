// Starting templates and live primitive parameters (M6A-SPEC §6.2, §5.16): B0a stubs, owned by B13.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const TEMPLATE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('mesh.create.template', 'New From Template', {
    category: 'mesh',
    scope: 'model',
    workspaces: ['model'],
    undo: true,
    description: 'Creates a prop, handheld item or humanoid starting setup.',
    extraArgs: ['template'],
  }),
  stubOperator('mesh.primitive.set', 'Primitive Parameters', {
    category: 'mesh',
    scope: 'model',
    workspaces: ['model'],
    undo: true,
    description: "Changes a live primitive's parameters (until a component edit freezes them).",
    extraArgs: ['mesh', 'params'],
    internal: true,
  }),
];
