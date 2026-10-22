// English strings of the markers step (AUTORIG-SPEC §5.3, §6.1, §8.1–§8.4; D4 owns the table). M6b's own texts (the
// marker names, the start checks, the A-pose notice, a failed guess) come from its operators and the Quick Rig body.
import type { MessageTable } from '../index';

export const markers = {
  intro: 'Drag each marker onto the body: the front view moves it sideways and up, the side view sets its depth.',
  symmetry: 'Left side mirrors the right',
  // the pane labels (§5.3 wireframe)
  paneFront: 'FRONT · drag ↔ ↕',
  paneSide: 'SIDE · depth ↕',
  panePersp: '3D · orbit',
  // the phone / tablet pane switch (§8.3)
  paneSwitch: 'View',
  front: 'Front',
  side: 'Side',
  persp: '3D',
  // the body pictogram (Cascadeur's diagram, L1)
  pictogram: 'Where the selected marker belongs',
  pictogramNone: 'Select a marker in the list to see where it belongs',
  selectedAt: (name: string, x: string, y: string, z: string) => `${name}: x ${x} cm, y ${y} cm, z ${z} cm`,
  // fingers (Mixamo's skeleton LOD)
  fingers: 'Fingers',
  fingersNone: 'None',
  fingersMitten: 'Thumb + 1',
  fingersAll: 'All five',
  fingersMinimal: 'Minimal skeleton (no shoulders, no toes)',
  fingersLocked: 'Changing fingers rebuilds the skeleton — Start over',
  joints: (count: number, fingers: string) => `${count} joints — fingers: ${fingers.toLowerCase()}`,
  // notices added to M6b's (§5.3, §6.1)
  aPoseAuto: 'Auto-rig straightens it for you.',
  notHumanoid:
    'This does not look like a person standing. Auto-Rig makes humanoid (VRM) skeletons. You can still place the ' +
    'markers by hand.',
  closed: 'The markers are closed.',
  reopen: 'Place markers again',
  starting: 'Placing the markers…',
  startFailed: (message: string) => `The markers could not be placed: ${message}`,
  rerun: 'Moving a marker refits the skeleton in place; painted weights are recomputed.',
  // the footer
  autoRig: 'Auto-rig',
  hint: 'Drag the markers, or select one and nudge it with the arrow keys (Shift: 1 mm).',
  hintSelected: (name: string) => `${name}: drag it in FRONT or SIDE, or nudge it with the arrow keys.`,
  rebindTitle: 'Rebind the skin?',
  rebindConfirm: 'Rebind',
  rigFailed: (message: string) => `Auto-rig failed: ${message}`,
  // ②'s own undo (AR-D8-3): what Undo / Redo name
  historyLabel: 'Marker Move',
} as const satisfies MessageTable;
