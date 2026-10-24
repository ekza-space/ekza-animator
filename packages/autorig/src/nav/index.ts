// Simple navigation (AUTORIG-SPEC §8.1; D3): the per-shell arbitration the Auto-Rig shell installs through the
// ViewportManager's `setNavigationOverride` hook while it is mounted — in the persp pane a left drag on empty space
// orbits, a right (or middle) drag pans, the wheel zooms (the profile's wheel, unchanged); ortho panes never orbit; a
// press the active tool claims (a manipulator, a joint, a control, the mesh under a painting or marker tool, or a
// claim a step registers) goes to the tool; `Alt` + mouse falls through to the user's profile (Alt+drag navigation
// keeps working). On a touch screen two fingers pan and pinch-zoom (`./touch`, a lazy chunk loaded only where touch
// points exist).
// Not a `NavProfile` value and never a preference: the user's Studio `navProfile` is never written, and the
// disposer removes the override (shell unmount), so Studio after a switch navigates with the user's own profile.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, VIEWPORT_TOOL } from '@ekza-studio/editor-core';
import type { NavGesture, NavigationOverride, NavPointerInput, ViewportManager } from '@ekza-studio/viewport';

/** What the arbitration needs of a pane press. */
export interface SimplePress {
  readonly ortho: boolean;
  /** Whether the active tool (or a step) claims the press point. */
  claimed(): boolean;
}

/** §8.1's table as a pure function: the gesture of a press, or null for the tool / the profile. */
export function simpleGesture(e: NavPointerInput, press: SimplePress): NavGesture | null {
  if (e.altKey) return null; // the profile's Alt chords (Alt+drag navigation) keep working
  if (e.button === 1 || e.button === 2) return 'track';
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || press.ortho) return null;
  return press.claimed() ? null : 'tumble';
}

/** A step's own claim (e.g. ②'s markers in the persp pane): true when the press at (x, y) of the pane is its. */
export type NavigationClaim = (paneId: string, x: number, y: number) => boolean;

const claims = new WeakMap<EditorApp, Set<NavigationClaim>>();

/** Registers a step's claim while it is mounted (the disposer removes it). */
export function addNavigationClaim(app: EditorApp, claim: NavigationClaim): Disposer {
  let set = claims.get(app);
  if (set === undefined) {
    set = new Set();
    claims.set(app, set);
  }
  set.add(claim);
  return () => {
    claims.get(app)?.delete(claim);
  };
}

/** Viewport tools whose presses on the mesh are theirs (painting, placing markers). */
const MESH_TOOLS: ReadonlySet<string> = new Set([VIEWPORT_TOOL.paintSkinWeights, VIEWPORT_TOOL.quickRigMarker]);

type Viewport = Pick<
  ViewportManager,
  'setNavigationOverride' | 'paneState' | 'pickCandidates' | 'isOverMesh' | 'paneAt'
>;

/** Whether the active tool or a step claims a press (§8.1 "a tool that claims the press wins"). */
export function toolClaims(app: EditorApp, vm: Viewport, paneId: string, x: number, y: number): boolean {
  if (vm.pickCandidates(paneId, x, y).some((hit) => hit.kind !== 'mesh')) return true;
  if (MESH_TOOLS.has(app.session.getState().tools.viewport) && vm.isOverMesh(paneId, x, y)) return true;
  for (const claim of claims.get(app) ?? []) if (claim(paneId, x, y)) return true;
  return false;
}

/** Whether the device has touch points (two-finger navigation then loads with the override). */
const touchDevice = (): boolean => typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;

/**
 * Installs the Simple override on a viewport (and, on a touch device, the two-finger handler); the disposer removes
 * them. The shell installs one override at a time (the controller disposes the previous one first), so the disposer
 * clears the hook unconditionally.
 */
export function installSimpleNavigation(app: EditorApp, vm: Viewport): Disposer {
  // a gesture the two-finger handler forces for its synthetic presses
  const forced: { gesture: NavGesture | null } = { gesture: null };
  const override: NavigationOverride = {
    gesture(e, paneId, at) {
      if (forced.gesture !== null) return forced.gesture;
      const preset = vm.paneState(paneId)?.preset ?? 'persp';
      return simpleGesture(e, {
        ortho: preset !== 'persp',
        claimed: () => toolClaims(app, vm, paneId, at.x, at.y),
      });
    },
  };
  vm.setNavigationOverride(override);
  let installed = true;
  let offTouch: Disposer | null = null;
  if (touchDevice()) {
    void import('./touch').then(
      (touch) => {
        if (installed) offTouch = touch.installTouchNavigation(vm, forced);
      },
      () => {
        // offline after a redeploy: one finger still orbits; two-finger pan/pinch is back on the next mount
      },
    );
  }
  return () => {
    if (!installed) return;
    installed = false;
    offTouch?.();
    offTouch = null;
    vm.setNavigationOverride(null);
  };
}
