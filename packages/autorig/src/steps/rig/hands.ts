// ③ *Adjust joints* → *Done*: the hands follow their forearms (AUTORIG-SPEC §5.4, AS-AR-1 step 12; AR-D7-16; a lazy
// chunk of ③). Editor-core's `autorigFlow` (T5b) turns each hand's subtree (tail and fingers, about the wrist) by the
// same rotation its forearm made since *Adjust joints* opened: the bound meshes are unbound (`skin.unbind {confirm}`;
// Done rebinds right after), each turned hand is one `skel.joint.rotateRest {mode: 'subtree', pivot: wrist}`. Painted
// weights are kept instead (the hands do not follow; the rebind question decides about the weights).
import type { CharacterId } from '@ekza-studio/doc';
import { type ArmSnapshot, type EditorApp, handsFollowForearms as flowHandsFollow } from '@ekza-studio/editor-core';

export {
  type ArmSnapshot,
  armSnapshot,
  characterJoints,
  FOLLOW_EPSILON,
  type HandTurn,
  handTurns,
  turnBetween,
} from '@ekza-studio/editor-core';

/**
 * Turns the hands whose forearm turned since `before`: unbind, one rotate per hand. Returns whether anything ran
 * (Done's rebind follows either way). A refused step stops it; the steps made stay (each undoable).
 */
export function handsFollowForearms(app: EditorApp, character: CharacterId, before: ArmSnapshot): Promise<boolean> {
  return flowHandsFollow({ app, quiet: (op, args) => app.runUntyped(op, args) }, character, before);
}
