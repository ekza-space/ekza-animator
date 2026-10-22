// ②'s keyboard and pointer tracking (AUTORIG-SPEC §8.1, §5.3; D4; lazy with the step view). The frame's listener has
// already prevented the browser default (and Studio's binding) of the `markers.nudge` rows of `AUTORIG_KEYMAP`; this
// listener performs them: in the marker list ↑ / ↓ select the previous / next marker (and move the focus with it),
// elsewhere — and with Shift anywhere — the arrows nudge the selected marker 1 cm (Shift: 1 mm) in the two axes of the pane under the pointer —
// front: x and y, side: z and y (M6b's axis rule: never the hidden axis) — or of the last ortho pane used, through
// `skel.quickRig.setMarker` (U state; the preview follows). Screen directions follow the pane's camera, so → moves
// the marker to the right as seen in that pane. A pointer over a pane records it in the `markers` slice.
import type { Disposer } from '@ekza-studio/anim-core';
import { type EditorApp, QUICK_RIG_MARKERS, quickRigOf } from '@ekza-studio/editor-core';
import { type MarkerNudge, NUDGE_ACTION } from '../../keymap/steps/markers';
import type { WizardContext } from '../../shell/context';
import { bindingFor } from '../../shell/keys';
import { MARKER_PANE_IDS, nudgePane, paneKind, withPane } from './index';

type Vec3 = readonly [number, number, number];

/** The screen right and up of a pane's camera in world space, or null (the pane is not shown). */
function paneAxes(ctx: WizardContext, paneId: string): { readonly right: Vec3; readonly up: Vec3 } | null {
  const vm = ctx.host.ui.getState().viewport;
  const view = vm?.paneView(paneId) ?? null;
  if (view === null) return null;
  view.camera.updateMatrixWorld();
  const e = view.camera.matrixWorld.elements;
  return { right: [e[0] ?? 0, e[1] ?? 0, e[2] ?? 0], up: [e[4] ?? 0, e[5] ?? 0, e[6] ?? 0] };
}

const sign = (value: number, fallback: 1 | -1): 1 | -1 => (value > 1e-6 ? 1 : value < -1e-6 ? -1 : fallback);

/**
 * The marker point after a nudge in an ortho pane: front changes x (screen right) and y (screen up), side z and y;
 * the hidden axis is copied bit for bit. Pure (the axes are the pane camera's).
 */
export function nudged(
  point: Vec3,
  pane: 'front' | 'side',
  nudge: MarkerNudge,
  axes: { readonly right: Vec3; readonly up: Vec3 } | null,
): Vec3 {
  const up = sign(axes?.up[1] ?? 1, 1);
  const y = nudge.dy === 0 ? point[1] : point[1] + nudge.dy * nudge.step * up;
  if (pane === 'front') {
    const right = sign(axes?.right[0] ?? 1, 1);
    return [nudge.dx === 0 ? point[0] : point[0] + nudge.dx * nudge.step * right, y, point[2]];
  }
  const right = sign(axes?.right[2] ?? 1, 1);
  return [point[0], y, nudge.dx === 0 ? point[2] : point[2] + nudge.dx * nudge.step * right];
}

/** Nudges the selected marker (no-op without a selection or a placed marker). */
export async function nudgeMarker(ctx: WizardContext, nudge: MarkerNudge): Promise<void> {
  const state = quickRigOf(ctx.app);
  const name = state?.selected ?? null;
  if (state === null || name === null) return;
  const point = state.markers[name];
  if (point === undefined) return;
  const pane = nudgePane(ctx.session.getState().markers);
  const next = nudged(point, pane, nudge, paneAxes(ctx, MARKER_PANE_IDS[pane]));
  await ctx.app.runUntyped('skel.quickRig.setMarker', { name, point: next });
}

/** ↑ / ↓ in the list: the previous / next marker, selected and focused. */
async function stepSelection(app: EditorApp, dy: number): Promise<void> {
  const state = quickRigOf(app);
  if (state === null) return;
  const at = state.selected === null ? -1 : QUICK_RIG_MARKERS.indexOf(state.selected);
  const index =
    at < 0 ? (dy < 0 ? 0 : QUICK_RIG_MARKERS.length - 1) : Math.max(0, Math.min(QUICK_RIG_MARKERS.length - 1, at - dy));
  const name = QUICK_RIG_MARKERS[index];
  if (name === undefined) return;
  await app.runUntyped('skel.quickRig.pick', { marker: name });
  document.querySelector<HTMLElement>(`[data-testid="quickrig-marker-${name}"]`)?.focus();
}

/** Installs ②'s key listener and pointer tracking while the step view is mounted. */
export function installMarkerKeys(ctx: WizardContext): Disposer {
  const mac = ctx.app.keymap.platform === 'mac';
  const onKeyDown = (e: KeyboardEvent): void => {
    const session = ctx.session.getState();
    if (session.step !== 'markers' || session.busy !== null) return;
    if (ctx.app.session.getState().dialog !== null || ctx.host.ui.getState().confirm !== null) return;
    const binding = bindingFor(e, 'markers', mac);
    if (binding === null || !('action' in binding.run) || binding.run.action !== NUDGE_ACTION) return;
    e.preventDefault();
    const nudge = binding.run.args as MarkerNudge;
    const target = e.target as { closest?: (selector: string) => unknown } | null;
    const inList = typeof target?.closest === 'function' && target.closest('[data-testid="quickrig-markers"]') !== null;
    if (inList && nudge.dx === 0 && !e.shiftKey) {
      void stepSelection(ctx.app, nudge.dy);
      return;
    }
    void nudgeMarker(ctx, nudge);
  };
  const onPointer = (e: PointerEvent): void => {
    const target = e.target as { closest?: (selector: string) => Element | null } | null;
    const pane = typeof target?.closest === 'function' ? target.closest('[data-ekza-pane]') : null;
    const kind = paneKind(pane?.getAttribute('data-ekza-pane'));
    if (kind === null) return;
    const patch = withPane(ctx.session.getState().markers, kind);
    if (Object.keys(patch).length > 0) ctx.session.patch('markers', patch);
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
  window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('pointermove', onPointer, { capture: true });
    window.removeEventListener('pointerdown', onPointer, { capture: true });
  };
}
