// English strings of the rig step (AUTORIG-SPEC §5.4, §6.1, §8.2–§8.4; D4 owns the table). Validation rows and their
// Fix labels are C7's texts.
import type { MessageTable } from '../index';

export const rig = {
  // the progress sheet
  sheetTitle: (name: string) => `Rigging ${name}`,
  stageSkeleton: 'Skeleton',
  stageSkeletonDone: (joints: number, preset: string) => `Skeleton — ${joints} joints (${preset}), IK legs, FK arms`,
  stageSkin: 'Skinning',
  stageSkinMeshes: (done: number, total: number) => `Skinning ${done} of ${total} ${total === 1 ? 'mesh' : 'meshes'} …`,
  stageStraighten: 'Straightening to a T-pose (A-pose)',
  stageCheck: 'Checking',
  cancel: 'Cancel',
  cancelled: 'Skeleton created; skinning cancelled',
  notBound: 'The skeleton is not bound to the mesh yet',
  bindAgain: 'Bind again',
  interrupted: 'Rigging was interrupted by another change',
  // review
  checkIt: 'Check it',
  motionTest: 'Motion test',
  motionOn: 'on',
  motionOff: 'off',
  playMotion: 'Play motion test',
  clipWalk: 'Walk',
  clipSword: 'Sword',
  clipDance: 'Dance',
  motionUnavailable: 'Animations could not be loaded — check the connection',
  fix: 'Fix',
  adjust: 'Adjust joints',
  markersAgain: 'Place the markers again',
  paint: 'Paint weights',
  showWeights: 'Show weights',
  allGood: 'All good',
  checking: 'Checking the rig…',
  offLine: 'An arm or shin is off its T-pose line — move the joint, or straighten the pose',
  warnings: 'Warnings',
  // adjust
  adjustTitle: 'Adjust joints',
  adjustHelp:
    'Select a joint in a view. W and drag: the joint and its children; hold D: this joint only; E: rotate its rest.',
  bindPose: 'Go to Bind Pose',
  done: 'Done',
  noJoint: 'No joint selected',
  jointAt: (name: string, x: string, y: string, z: string) => `${name}: x ${x} cm, y ${y} cm, z ${z} cm`,
  straightened: 'Weights are recomputed on the straightened pose',
  rebinding: 'Rebinding the skin…',
  // paint
  paintTitle: 'Paint weights',
  paintHelp: 'Pick a body part, then paint on the model. B and drag: brush size. One stroke is one undo step.',
  paintPhone: 'Painting needs a larger screen',
  // the footer
  hint: 'Looks wrong? Move markers, adjust or paint.',
  hintAdjust: 'Move the joints, then press Done.',
  hintPaint: 'Paint the weights, then press Done.',
  hintRigging: 'Rigging…',
} as const satisfies MessageTable;
