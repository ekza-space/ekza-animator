// Accessibility helpers of the wizard chrome (AUTORIG-SPEC §8.2; D3): the step heading's id (the one `h1`, focused on
// every step change), focus moves that never scroll the panes, and the reduced-motion query the steps read before
// auto-playing anything.

/** The id of the current step's heading (`h1`, shown in the stepper). */
export const STEP_HEADING_ID = 'ar-step-title';

/** Moves the focus to the step heading (§8.2 "Focus is moved to the step heading on step change"). */
export function focusStepHeading(doc: Document = document): void {
  const heading = doc.getElementById(STEP_HEADING_ID);
  if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
}

/** `prefers-reduced-motion: reduce` (§8.2: no auto-play of the motion test, no animated transitions). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
