// C1 (character runtime; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const CHARACTER_OPERATORS: readonly AnyOperator[] = [
  rigStub('mesh.importStatic', 'Import Static Model…', { undo: true }),
  rigStub('char.fromModel', 'Character from Selection', { undo: true }),
  rigStub('char.adopt', 'Add to Character', { undo: true }),
];
