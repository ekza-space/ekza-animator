// The Quick Rig markers tool (M6B-SPEC §0.2 steps 2–4, §0.4.2; C3): presses in the panes while Quick Rig is open.
//
// - Orthographic panes: a press on a marker (pick rule: the selected marker wins among overlapping ones, else the
//   nearest) drags it by the axis rule — front writes x/y, side z/y, top x/z, the hidden axis bit-equal, centre
//   markers on x = 0 — and every pointer frame refits the preview (`setQuickRigMarker`), so Create Skeleton commits
//   what is on screen. `Shift` ×0.1, `X` held snaps to the grid. A ghost (left mirror) is picked but never dragged. A
//   click without a drag selects; a click again on the same spot cycles through the markers there.
// - After Clear, a click on empty space in the front pane places the next missing marker (list order) at the click's
//   x/y, its depth by Snap to Projected Center through the meshes.
// - The perspective pane shows the markers read-only ("Drag markers in the front or side view").
// `Esc` during a drag restores the markers; nothing here writes the document.
import {
  type EditorApp,
  isCentreMarker,
  nextMissingMarker,
  pickQuickRigMarker,
  QUICK_RIG_MARKERS,
  type QuickRigState,
  quickRigOf,
  rigGeometry,
  setQuickRigMarker,
  type ToolPointerEvent,
} from '@ekza-studio/editor-core';
import { projectedCenter, type QuickRigMarker } from '@ekza-studio/rig';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { pointerRay, rayOnAxisPlane, type Vec3 } from '../../../rig/joints/pane';
import type { QuickRigMarkerOverlay } from '../../../rig/markers/overlay';
import {
  type Axis,
  axisRuleDrag,
  cycleMarker,
  hiddenAxisOf,
  isRepeatClick,
  MARKER_DRAG_PX,
  type MarkerPick,
  pickMarker,
} from './rules';

/** The hover hint of a marker in the perspective pane (§0.2 step 3). */
export const PERSP_MARKER_HINT = 'Drag markers in the front or side view';

/** Keys the markers tool reads while held (`X` grid snap). */
export interface HeldKeys {
  isHeld(code: string): boolean;
}

interface Press {
  readonly paneId: string;
  readonly x: number;
  readonly y: number;
  readonly hidden: Axis | null;
  readonly pick: MarkerPick | null;
  /** A press on empty space in the front pane while a marker is missing: a click places it. */
  readonly place: boolean;
  readonly start: QuickRigState;
  drag: { readonly marker: Vec3; readonly startHit: Vec3 } | null;
  moved: boolean;
}

export class QuickRigInput {
  private press: Press | null = null;
  private lastClick: { readonly paneId: string; readonly x: number; readonly y: number } | null = null;

  constructor(
    private readonly app: EditorApp,
    private readonly vm: Pick<ViewportManager, 'paneView' | 'paneState'>,
    private readonly overlay: QuickRigMarkerOverlay,
    private readonly keys: HeldKeys,
  ) {}

  get active(): boolean {
    return quickRigOf(this.app) !== null && this.app.session.getState().workspace === 'rig';
  }

  get dragging(): boolean {
    return this.press !== null && this.press.drag !== null;
  }

  private hiddenOf(paneId: string): Axis | null {
    return hiddenAxisOf(this.vm.paneState(paneId)?.preset ?? null);
  }

  pointerDown(e: ToolPointerEvent): boolean {
    if (e.button !== 0 || e.paneId === null || !this.active) return false;
    const state = quickRigOf(this.app) as QuickRigState;
    const hidden = this.hiddenOf(e.paneId);
    const pick = pickMarker(this.overlay.hits(e.paneId, e.x, e.y), state.selected, QUICK_RIG_MARKERS);
    const place = pick === null && hidden === 2 && nextMissingMarker(state.markers) !== null;
    if (pick === null && !place) return false;
    this.press = { paneId: e.paneId, x: e.x, y: e.y, hidden, pick, place, start: state, drag: null, moved: false };
    return true;
  }

  pointerMove(e: ToolPointerEvent): void {
    const press = this.press;
    if (press === null) return;
    if (!press.moved && Math.hypot(e.x - press.x, e.y - press.y) < MARKER_DRAG_PX) return;
    press.moved = true;
    const pick = press.pick;
    if (pick === null || pick.ghost || press.hidden === null) return;
    const view = this.vm.paneView(press.paneId);
    if (view === null) return;
    if (press.drag === null) {
      const marker = press.start.markers[pick.name];
      if (marker === undefined) return;
      const startHit = rayOnAxisPlane(pointerRay(view, press.x, press.y), press.hidden, marker[press.hidden]);
      if (startHit === null) return;
      press.drag = { marker, startHit };
    }
    const { marker, startHit } = press.drag;
    const hit = rayOnAxisPlane(pointerRay(view, e.x, e.y), press.hidden, marker[press.hidden]);
    if (hit === null) return;
    const grid = this.keys.isHeld('KeyX') ? this.app.prefs.getState().modeling.gridStep : null;
    const next = axisRuleDrag(marker, startHit, hit, press.hidden, {
      centre: isCentreMarker(pick.name),
      scale: e.shift ? 0.1 : 1,
      snap: grid,
    });
    setQuickRigMarker(this.app, pick.name, next);
  }

  pointerUp(e: ToolPointerEvent): void {
    const press = this.press;
    this.press = null;
    if (press === null) return;
    if (press.drag !== null || press.moved) return;
    if (press.place) {
      this.place(press, e);
      this.lastClick = null;
      return;
    }
    const pick = press.pick;
    if (pick === null) return;
    const state = quickRigOf(this.app);
    const repeat = isRepeatClick(this.lastClick, press.paneId, press.x, press.y);
    pickQuickRigMarker(this.app, repeat ? cycleMarker(pick.set, state?.selected ?? null) : pick.name);
    this.lastClick = { paneId: press.paneId, x: press.x, y: press.y };
  }

  cancel(): void {
    const press = this.press;
    this.press = null;
    if (press?.drag === null || press === null) return;
    // Esc during a drag: the markers (and preview) as they were at the press.
    if (quickRigOf(this.app) === null) return;
    const rig = this.app.session.getState().rig;
    this.app.session.setState({ rig: { ...rig, quickRig: press.start } });
  }

  /** The perspective pane's hint over a marker, else null (the runtime shows it as the canvas tooltip). */
  hoverHint(paneId: string, x: number, y: number): string | null {
    if (!this.active || this.hiddenOf(paneId) !== null) return null;
    const state = quickRigOf(this.app) as QuickRigState;
    return pickMarker(this.overlay.hits(paneId, x, y), state.selected, QUICK_RIG_MARKERS) === null
      ? null
      : PERSP_MARKER_HINT;
  }

  /** The marker under a pane point (hover highlight), or null. */
  markerAt(paneId: string, x: number, y: number): QuickRigMarker | null {
    if (!this.active) return null;
    const state = quickRigOf(this.app) as QuickRigState;
    return pickMarker(this.overlay.hits(paneId, x, y), state.selected, QUICK_RIG_MARKERS)?.name ?? null;
  }

  /** Click-to-place (§0.2 step 2): the next missing marker at the click's x/y, its depth by projected centre. */
  private place(press: Press, e: ToolPointerEvent): void {
    const state = quickRigOf(this.app);
    const view = this.vm.paneView(press.paneId);
    if (state === null || view === null) return;
    const name = nextMissingMarker(state.markers);
    if (name === null) return;
    const ray = pointerRay(view, e.x, e.y);
    const onPlane = rayOnAxisPlane(ray, 2, 0);
    if (onPlane === null) return;
    let z = 0;
    try {
      const geometry = rigGeometry(this.app, this.app.store, state.meshes);
      const H = Math.max(geometry.height, 0.1);
      const hit = projectedCenter(geometry.bvh, ray.origin, ray.dir, { mode: 'new', fallbackRadius: 0.05 * H });
      z = hit === null ? (geometry.bounds[0][2] + geometry.bounds[1][2]) / 2 : hit[2];
    } catch {
      // A mesh is loading: the marker goes on z = 0 and can be moved in the side view.
    }
    // Side markers belong to the character's right (x < 0): a click on the left half places the mirror.
    const x = isCentreMarker(name) ? 0 : -Math.abs(onPlane[0]);
    setQuickRigMarker(this.app, name, [x === 0 ? 0 : x, onPlane[1], z]);
  }
}
