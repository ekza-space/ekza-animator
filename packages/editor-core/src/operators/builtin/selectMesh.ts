// Component and object selection (M6A-SPEC §6.2, §5.6): B0a stubs, owned by B10. Selection gestures carry
// `flags.selection`: in workspaces with `undoSelection` they record a history selection part, never a doc step.
import type { OperatorMap } from '../args';
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const select = <K extends keyof OperatorMap>(
  id: K,
  label: string,
  description: string,
  extraArgs: readonly string[] = [],
  aliases?: readonly string[],
): AnyOperator =>
  stubOperator(id, label, {
    category: 'select',
    description,
    scope: 'model',
    selection: true,
    workspaces: ['model'],
    ...(extraArgs.length === 0 ? {} : { extraArgs }),
    ...(aliases === undefined ? {} : { aliases }),
  });

export const SELECT_MESH_OPERATORS: readonly AnyOperator[] = [
  select('select.components', 'Select Components', 'Selects components of a mesh (click and marquee).', [
    'mesh',
    'kind',
    'indices',
    'mode',
  ]),
  select('select.mesh.loop', 'Select Loop', 'Selects the edge or face loop through a component.', [
    'mesh',
    'kind',
    'component',
    'gesture',
  ]),
  select('select.mesh.ring', 'Select Ring', 'Selects the edge ring through the selected edges.', ['mesh', 'component']),
  select('select.mesh.grow', 'Grow Selection', 'Grows the component selection by one ring of neighbours.'),
  select('select.mesh.shrink', 'Shrink Selection', 'Shrinks the component selection by one ring.'),
  select('select.mesh.border', 'Select Border', 'Selects the border edges of the selected region.'),
  select('select.mesh.shell', 'Select Shell', 'Selects every component connected to the selection.', [], ['Linked']),
  select('select.mesh.all', 'Select All Components', 'Selects every component of the hilited meshes.'),
  select('select.mesh.invert', 'Invert Selection', 'Inverts the component selection of the hilited meshes.'),
  select('select.mesh.none', 'Deselect Components', 'Clears the component selection.'),
  select('select.mesh.convert', 'Convert Selection', 'Converts the selection to vertices, edges or faces.', [
    'to',
    'mode',
  ]),
  select('select.mesh.matching', 'Select Matching', 'Selects the components a Mesh Check problem reports.', [
    'mesh',
    'code',
  ]),
  select('select.objects', 'Select Objects', 'Selects meshes and groups in Model.', ['ids', 'all', 'mode']),
  stubOperator('select.mesh.pickWalk', 'Pick Walk Components', {
    category: 'select',
    description: 'Walks the component selection to a neighbour.',
    scope: 'model',
    extraArgs: ['direction'],
    workspaces: ['model'],
    reason: 'Component pick-walk arrives later',
  }),
];
