// C9 (control shapes; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const SHAPE_OPERATORS: readonly AnyOperator[] = [
  rigStub('rig.shape.replace', 'Replace Shape', {
    undo: true,
    repeatable: true,
    deferred: true,
    aliases: ['Custom Shape'],
  }),
  rigStub('rig.shape.set', 'Control Shape', { undo: true, adjustable: true, deferred: true }),
  rigStub('rig.shape.transform', 'Transform Shape', { undo: true, internal: true, deferred: true }),
  rigStub('rig.shape.editPoints', 'Edit Shape Points', { undo: true, internal: true, deferred: true }),
  rigStub('rig.shape.mirror', 'Mirror Shape', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.shape.copy', 'Copy Shape', { deferred: true }),
  rigStub('rig.shape.paste', 'Paste Shape', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.shape.reset', 'Reset Shape', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.shape.sizeFromMesh', 'Size from Mesh', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.shape.cvMode', 'Edit CVs', { deferred: true }),
];
