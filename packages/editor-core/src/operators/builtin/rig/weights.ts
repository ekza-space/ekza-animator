// C6 (with the C5 MVP subset) (skin UI; M6B-SPEC §6, §0.6): the operators of this file, registered by C0 from their stubs (§3 rule 1)
// inside the lazy rig-workspace chunk. MVP operators (§0.6) poll-fail "not available yet" until their owner lands
// them; deferred ones poll-fail "Arrives after the MVP" and are internal (listed in no menu, palette or keymap).
import type { AnyOperator } from '../define';
import { rigStub } from './stub';

export const WEIGHT_OPERATORS: readonly AnyOperator[] = [
  rigStub('skin.weights.paint', 'Paint Stroke', { undo: true, internal: true, tool: 'paintSkinWeights' }),
  rigStub('skin.weights.flood', 'Flood', { undo: true, repeatable: true }),
  rigStub('skin.weights.set', 'Set Weights', { undo: true, adjustable: true }),
  rigStub('skin.weights.assign', 'Assign to Joint', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.rigidIslands', 'Rigid Islands', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.mirror', 'Mirror Skin Weights', { undo: true, adjustable: true, repeatable: true }),
  rigStub('skin.weights.transfer', 'Copy Skin Weights', { undo: true, adjustable: true, deferred: true }),
  rigStub('skin.weights.smooth', 'Smooth Skin Weights', { undo: true, adjustable: true, repeatable: true }),
  rigStub('skin.weights.hammer', 'Hammer Skin Weights', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.copyVertex', 'Copy Vertex Weights', { deferred: true }),
  rigStub('skin.weights.pasteVertex', 'Paste Vertex Weights', { undo: true, repeatable: true, deferred: true }),
  rigStub('skin.weights.prune', 'Prune Small Weights', { undo: true, adjustable: true, repeatable: true }),
  rigStub('skin.weights.normalize', 'Normalize Weights', { undo: true, adjustable: true, repeatable: true }),
  rigStub('skin.weights.move', 'Move Weights to Influences', {
    undo: true,
    adjustable: true,
    repeatable: true,
    deferred: true,
  }),
  rigStub('skin.palette.compact', 'Remove Unused Influences', { undo: true, repeatable: true }),
];
