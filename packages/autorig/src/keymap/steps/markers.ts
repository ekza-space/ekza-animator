// Key bindings of the markers step (AUTORIG-SPEC §8.1; D4 owns the list). The frame's key listener prevents the
// browser default (and Studio's binding) of every row here; `G` runs its operator there. The `markers.nudge` rows are
// handled by ②'s own listener (`steps/markers/keys.ts`): in the marker list ↑ / ↓ select the previous / next marker,
// elsewhere the arrows nudge the selected marker 1 cm (Shift: 1 mm) in the two axes of the pane under the pointer, or
// of the last ortho pane used (`skel.quickRig.setMarker`), so ② is usable without dragging (WCAG 2.5.7).
import type { AutoRigKeyBinding } from '../index';

const ARROWS = [
  ['ArrowLeft', -1, 0],
  ['ArrowRight', 1, 0],
  ['ArrowUp', 0, 1],
  ['ArrowDown', 0, -1],
] as const;

/** A nudge: screen right (`dx`) and up (`dy`) in steps of `step` metres. */
export interface MarkerNudge {
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
  readonly step: number;
}

export const NUDGE_ACTION = 'markers.nudge' as const;

export const markersKeys: readonly AutoRigKeyBinding[] = [
  ...ARROWS.flatMap(([code, dx, dy]) =>
    [false, true].map(
      (shift): AutoRigKeyBinding => ({
        chord: { code, ...(shift ? { shift: true } : {}) },
        run: { action: NUDGE_ACTION, args: { dx, dy, step: shift ? 0.001 : 0.01 } satisfies MarkerNudge },
        steps: ['markers'],
      }),
    ),
  ),
  { chord: { code: 'KeyG' }, run: { op: 'skel.quickRig.guess' }, steps: ['markers'] },
];
