// Tolerances by pointer type (STUDIO-TOUCH-SPEC §5.4, ST-8; T1). The mouse keeps Studio Pro's values; a finger and the
// pen get larger pick radii, slops and multi-tap windows. `PICK` (theme.ts) holds the tolerances of the pointer in use
// and every consumer reads it at call time (the control, joint and manipulator pickers, the select tools' cycle radius
// and marquee threshold), so a touch shell's input stage switches them per event (`usePointerTolerance`) and Studio
// Pro, which installs no stage, never runs this module.
import { PICK } from '../theme';

export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * §5.4 by pointer type: pick radius, drag slop, multi-tap window and multi-tap (double-tap and cycle) radius, in CSS px
 * and ms. The mouse's are Studio Pro's: PICK's radii (`pickPx` is its control radius), the Model select runtime's
 * double-click (500 ms, 4 px) and the 3 px slop the arbiter uses to tell a click from a drag.
 */
export const POINTER_TOLERANCE = {
  mouse: { pickPx: 6, slopPx: 3, multiTapMs: 500, multiTapPx: 4 },
  pen: { pickPx: 9, slopPx: 4, multiTapMs: 350, multiTapPx: 8 },
  touch: { pickPx: 22, slopPx: 10, multiTapMs: 450, multiTapPx: 24 },
} as const;

/** Studio Pro's PICK, captured before any switch (only this module writes PICK). */
const MOUSE_PICK = { ...PICK };
let inUse: PointerKind = 'mouse';

/** A DOM `pointerType` as a tolerance row ('' and unknown types are the mouse). */
export const pointerKind = (type: string): PointerKind => (type === 'pen' || type === 'touch' ? type : 'mouse');

/** The pointer whose tolerances PICK holds now. */
export const pointerInUse = (): PointerKind => inUse;

/**
 * Switches PICK to a pointer type's tolerances: the pick radii of controls, joints and manipulator handles, the cycle
 * radius (the multi-tap radius) and the marquee threshold (the slop). The mouse restores Studio Pro's values.
 */
export function usePointerTolerance(type: string): void {
  const kind = pointerKind(type);
  if (kind === inUse) return;
  inUse = kind;
  if (kind === 'mouse') {
    Object.assign(PICK, MOUSE_PICK);
    return;
  }
  const row = POINTER_TOLERANCE[kind];
  PICK.controlPx = row.pickPx;
  PICK.jointPx = row.pickPx;
  PICK.manipulatorPx = row.pickPx;
  PICK.cycleRadiusPx = row.multiTapPx;
  PICK.marqueeMinPx = row.slopPx;
}

/**
 * CSS px added to a fixed handle tolerance (the extrude cap's cubes, arrows and rings) for the pointer in use: 0 for
 * the mouse, the growth of the manipulator radius for a finger or the pen (their relative order is kept).
 */
export const handleGrowPx = (): number => PICK.manipulatorPx - MOUSE_PICK.manipulatorPx;
