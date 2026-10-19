// Palettes and swatches (M6A-SPEC §6.2, §5.19): B0a stubs, owned by B13.
import type { OperatorMap } from '../args';
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

const palette = <K extends keyof OperatorMap>(
  id: K,
  label: string,
  description: string,
  extraArgs: readonly string[] = [],
  opts: { readonly undo?: boolean; readonly internal?: boolean } = {},
): AnyOperator =>
  stubOperator(id, label, {
    category: 'palette',
    scope: 'model',
    workspaces: ['model'],
    description,
    undo: opts.undo ?? true,
    ...(opts.internal === true ? { internal: true } : {}),
    ...(extraArgs.length === 0 ? {} : { extraArgs }),
  });

export const PALETTE_OPERATORS: readonly AnyOperator[] = [
  palette('palette.ensureDefault', 'Default Palette', 'Creates the default palette when the project has none.', [], {
    internal: true,
  }),
  palette('palette.create', 'New Palette', 'Creates an empty palette.', ['name']),
  palette('palette.duplicate', 'Duplicate Palette', 'Copies a palette with its swatches.', ['palette']),
  palette('palette.rename', 'Rename Palette', 'Renames a palette.', ['palette', 'name']),
  palette('palette.addSwatch', 'Add Swatch', 'Adds a colour to a palette.', ['palette', 'srgb', 'name']),
  palette('palette.setSwatch', 'Edit Swatch', "Changes a swatch's colour or name.", ['swatch', 'srgb', 'name']),
  palette('palette.removeSwatch', 'Remove Swatch', 'Removes a swatch (its slot is never reused).', ['swatch']),
  palette('palette.assign', 'Assign Palette', 'Makes a palette the colour source of meshes.', ['meshes', 'palette']),
  palette('palette.replaceSwatch', 'Replace Swatch', 'Repaints every face of one swatch with another.', [
    'palette',
    'from',
    'to',
    'meshes',
  ]),
  palette('palette.setActive', 'Active Swatch', 'Picks the swatch Assign Colour paints with.', ['swatch'], {
    undo: false,
  }),
  stubOperator('select.mesh.bySwatch', 'Select by Swatch', {
    category: 'select',
    scope: 'model',
    workspaces: ['model'],
    selection: true,
    description: 'Selects the faces painted with a swatch (default: the active swatch).',
    extraArgs: ['slot'],
  }),
];
