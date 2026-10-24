// Navigation profiles (research 09 §5.1, MVP-SPEC §4.11.16): which pointer chords and wheel gestures tumble, track
// or dolly. Profiles change bindings only, never the camera maths (NavigationController).
import type { NavProfile } from '@ekza-studio/editor-core';

export type NavGesture = 'tumble' | 'track' | 'dolly';

export interface NavPointerInput {
  readonly button: number;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * The drag gesture a pointer-down starts, or null when it belongs to the active tool. Every profile keeps the DCC
 * Alt+LMB/MMB/RMB (tumble/track/dolly); the one-button profile (M1-stretch) adds Option+Cmd+LMB track and
 * Option+Ctrl+LMB dolly.
 */
export function pointerGesture(profile: NavProfile, e: NavPointerInput): NavGesture | null {
  if (!e.altKey) return null;
  if (e.button === 0) {
    if (profile === 'oneButton') {
      if (e.metaKey) return 'track';
      if (e.ctrlKey) return 'dolly';
    }
    return 'tumble';
  }
  if (e.button === 1) return 'track';
  if (e.button === 2) return 'dolly';
  return null;
}

export interface NavWheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

/** A wheel gesture: tumble/track by (dx, dy) CSS px, or dolly by `amount` (positive = closer, e^−amount). */
export type WheelAction =
  | { readonly kind: 'tumble' | 'track'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'dolly'; readonly amount: number };

/** Mouse wheel notch (~100 px) → about 14 % closer. */
const WHEEL_DOLLY_PER_PX = 0.0015;
/** Trackpad pinch (`wheel` + `ctrlKey`, small deltas) is more sensitive. */
const PINCH_DOLLY_PER_PX = 0.01;

/**
 * Mouse profiles: the wheel dollies (a pinch, `wheel` + Ctrl, too). Trackpad: two-finger scroll tumbles, Shift +
 * scroll tracks, pinch or Cmd + scroll dollies (research 09 §5.1).
 */
export function wheelAction(profile: NavProfile, e: NavWheelInput, pageHeightPx: number): WheelAction {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? Math.max(pageHeightPx, 1) : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (e.ctrlKey) return { kind: 'dolly', amount: -dy * PINCH_DOLLY_PER_PX };
  if (profile === 'trackpad') {
    if (e.metaKey) return { kind: 'dolly', amount: -dy * PINCH_DOLLY_PER_PX };
    if (e.shiftKey) return { kind: 'track', dx: -dx, dy: -dy };
    return { kind: 'tumble', dx: -dx, dy: -dy };
  }
  return { kind: 'dolly', amount: -dy * WHEEL_DOLLY_PER_PX };
}

/**
 * M6a pointer platform rule (b) (M6A-SPEC §5.17; B9): the MMB stand-in. In the `trackpad` and `oneButton`
 * profiles an `Alt+Shift`+LMB press in a Model viewport pane is an MMB press for the tools (`button 1`, Alt and Shift
 * cleared; Ctrl stays, so `Ctrl+Alt+Shift`+LMB is Ctrl+MMB): the MMB rule, `B`+MMB radius, Target Weld centre, Slide
 * and the virtual slider work without a middle button. Animate and the `dcc` profile keep Alt+LMB as tumble.
 */
export function isMmbStandIn(profile: NavProfile, workspace: string, e: NavPointerInput): boolean {
  return (
    workspace === 'model' &&
    (profile === 'trackpad' || profile === 'oneButton') &&
    e.button === 0 &&
    e.altKey &&
    e.shiftKey
  );
}
