// A per-shell navigation override (AUTORIG-SPEC §8.1, D3): the shell that installs one (the Auto-Rig wizard's Simple
// navigation) is asked first on every press in a pane; a gesture it returns navigates exactly as a profile gesture
// would, null lets the press continue down the shipped order (the profile's Alt chords, marking menus, the M6b pointer
// layer, the tool). Not a `NavProfile` and never a preference: the user's profile stays as it is.
import type { NavGesture, NavPointerInput } from './profiles';

export type { NavGesture, NavPointerInput };

export interface NavigationOverride {
  /** The gesture of a press in `paneId` at `at` (pane CSS px), or null. */
  gesture(e: NavPointerInput, paneId: string, at: { readonly x: number; readonly y: number }): NavGesture | null;
}
