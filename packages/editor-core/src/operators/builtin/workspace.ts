// Workspace and shell operators (M6A-SPEC §6.2, §5.17, §5.18): B0a stubs, owned by B9.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const WORKSPACE_OPERATORS: readonly AnyOperator[] = [
  stubOperator('workspace.set', 'Switch Workspace', {
    category: 'workspace',
    description: 'Switches the workspace (Model, Rig & Skin, Animate, Review); the document, selection and time stay.',
    extraArgs: ['workspace'],
  }),
  stubOperator('view.shading', 'Shading', {
    category: 'view',
    description: "Sets a viewport pane's shading: wireframe, shaded, colours or lit.",
    extraArgs: ['mode', 'paneId'],
  }),
  stubOperator('view.display.set', 'Set Display', {
    category: 'view',
    description: "Sets any of a viewport pane's display flags.",
    extraArgs: ['patch', 'paneId'],
  }),
  stubOperator('ui.commandPalette', 'Command Palette', {
    category: 'ui',
    description: 'Searches every operator of the current workspace and runs one.',
  }),
  stubOperator('ui.markingMenu', 'Marking Menu', {
    category: 'ui',
    description: 'Opens a marking menu at the pointer.',
    extraArgs: ['menu'],
    internal: true,
  }),
];
