// Static model export (M6A-SPEC §6.2, §5.21–§5.22): B0a stub, owned by B8.
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const EXPORT_MODEL_OPERATORS: readonly AnyOperator[] = [
  stubOperator('file.exportModel', 'Export Model', {
    category: 'file',
    workspaces: ['model'],
    description: 'Exports the selected (or every) scene mesh as a static glTF binary.',
    extraArgs: ['objects', 'fileName', 'profile', 'colourOutput', 'materialPreset', 'dropTangents', 'validate'],
  }),
];
