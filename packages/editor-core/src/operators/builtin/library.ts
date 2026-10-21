// C12 (clip library; M6B-SPEC §0.4.7, §0.6): `library.open`, `.preview`, `.stop` (U state) and `.useClip` (undoable,
// one step). C0 stubs, registered from the lazy clip-library chunk (`app.library.load()`).
import type { AnyOperator } from './define';
import { stubOperator } from './stub';

export const LIBRARY_OPERATORS: readonly AnyOperator[] = [
  stubOperator('library.open', 'Clip Library', {
    category: 'library',
    description: 'Opens the Clip Library panel (M6B-SPEC §0.4.7)',
    workspaces: ['animate', 'rig'],
  }),
  stubOperator('library.preview', 'Preview Clip', {
    category: 'library',
    description: 'Plays a library clip on the character without writing the document (M6B-SPEC §0.4.7)',
    workspaces: ['animate', 'rig'],
    internal: true,
  }),
  stubOperator('library.stop', 'Stop Preview', {
    category: 'library',
    description: 'Stops the clip preview (M6B-SPEC §0.4.7)',
    workspaces: ['animate', 'rig'],
  }),
  stubOperator('library.useClip', 'Use Clip', {
    category: 'library',
    description: 'Brings a library clip into the document as an editable clip (M6B-SPEC §0.4.7)',
    workspaces: ['animate', 'rig'],
    undo: true,
    internal: true,
  }),
];
