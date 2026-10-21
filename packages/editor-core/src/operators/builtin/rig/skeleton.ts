// C2 (kernel) / C3 (UI) (skeleton kernel; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const SKELETON_OPERATORS: readonly AnyOperator[] = [
  rigStub('skel.template.create', 'Skeleton Template', { undo: true, adjustable: true }),
  rigStub('skel.template.addMissing', 'Add Missing Bones', { undo: true }),
  rigStub('skel.joint.create', 'Create Joints', { undo: true, deferred: true, tool: 'jointTool' }),
  rigStub('skel.joint.duplicate', 'Duplicate Joints', {
    undo: true,
    adjustable: true,
    repeatable: true,
    deferred: true,
  }),
  rigStub('skel.joint.setRole', 'Set Joint Role', { undo: true, deferred: true }),
  rigStub('skel.socket.create', 'Create Socket', { undo: true, adjustable: true, deferred: true }),
  rigStub('skel.joint.insert', 'Insert Joints', { undo: true, adjustable: true, deferred: true, tool: 'insertJoint' }),
  rigStub('skel.bone.split', 'Split Bone', { undo: true, adjustable: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.remove', 'Remove Joints', { undo: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.delete', 'Delete Joint and Children', { undo: true, repeatable: true, deferred: true }),
  rigStub('skel.joint.reparent', 'Parent', { undo: true, deferred: true }),
  rigStub('skel.joint.unparent', 'Unparent', { undo: true, deferred: true }),
  rigStub('skel.joint.rename', 'Rename Joint', { undo: true }),
  rigStub('skel.joint.setHumanBone', 'Map Humanoid Bone', { undo: true }),
  rigStub('skel.joint.setSide', 'Set Side', { undo: true, deferred: true }),
  rigStub('skel.joint.move', 'Move', { undo: true, adjustable: true, internal: true }),
  rigStub('skel.joint.rotateRest', 'Rotate', { undo: true, adjustable: true, internal: true }),
  rigStub('skel.joint.setRest', 'Set Rest', { undo: true }),
  rigStub('skel.joint.orient', 'Orient Joint', {
    undo: true,
    adjustable: true,
    repeatable: true,
    aliases: ['Recalculate Roll'],
  }),
  rigStub('skel.joint.mirror', 'Mirror Joints', {
    undo: true,
    adjustable: true,
    repeatable: true,
    aliases: ['Symmetrize Bones'],
  }),
  rigStub('skel.joint.flex', 'Restore Rest Flexion', { undo: true, adjustable: true }),
  rigStub('skel.symmetry.set', 'Symmetry X', { undo: true }),
  rigStub('skel.pose.tStance', 'T-Stance', { deferred: true }),
  rigStub('skel.pose.applyAsRest', 'Apply Pose as Rest', { undo: true, deferred: true }),
  rigStub('select.joints', 'Select Joints', { selection: true }),
];
