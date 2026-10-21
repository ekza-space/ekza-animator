// C8a (cores) / C8b (operators and UI) (constraint UI; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const CONSTRAINT_OPERATORS: readonly AnyOperator[] = [
  rigStub('rig.constraint.create', 'Constrain', {
    undo: true,
    adjustable: true,
    deferred: true,
    workspaces: ['rig', 'animate'],
    aliases: ['Child Of', 'Copy Location', 'Copy Rotation', 'Damped Track'],
  }),
  rigStub('rig.constraint.edit', 'Edit Constraint', { undo: true, deferred: true }),
  rigStub('rig.constraint.addTarget', 'Add Target', { undo: true, deferred: true }),
  rigStub('rig.constraint.removeTarget', 'Remove Target', { undo: true, deferred: true }),
  rigStub('rig.constraint.updateOffset', 'Update Offset', { undo: true, deferred: true }),
  rigStub('rig.constraint.clearOffset', 'Clear Offset', { undo: true, deferred: true }),
  rigStub('rig.constraint.bake', 'Bake to Keys', { undo: true, deferred: true }),
  rigStub('rig.constraint.mirror', 'Mirror Constraint', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.constraint.delete', 'Delete Constraint', { undo: true, repeatable: true, deferred: true }),
  rigStub('rig.constraint.repairAttrs', 'Repair Constraint Attributes', { undo: true, deferred: true }),
  rigStub('rig.constraint.poleVector', 'Pole Vector', { deferred: true }),
  rigStub('rig.space.add', 'Add Space', { undo: true, deferred: true }),
  rigStub('rig.space.switch', 'Switch Space', { undo: true, deferred: true }),
];
