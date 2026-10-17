// Mounted time sliders per EditorApp: the first one registers the slider's contributions (`time.selectBand`, the
// RMB menu items), the last one to unmount removes them, and the most recently used one is "focused" — the one
// `time.selectBand` and the e2e test API act on.
import type { Disposer, Frame } from '@ekza-animator/anim-core';
import { registerTimelineContributions, type TimeSliderController } from '@ekza-animator/curve-editor';
import type { EditorApp } from '@ekza-animator/editor-core';

interface Host {
  readonly sliders: Map<TimeSliderController, HTMLCanvasElement>;
  focused: TimeSliderController | null;
  unregister: Disposer | null;
}

const hosts = new WeakMap<EditorApp, Host>();

/** Tracks a mounted slider; the disposer forgets it. */
export function attachTimeSlider(app: EditorApp, slider: TimeSliderController, canvas: HTMLCanvasElement): Disposer {
  let host = hosts.get(app);
  if (host === undefined) {
    host = { sliders: new Map(), focused: null, unregister: null };
    hosts.set(app, host);
  }
  const current = host;
  current.sliders.set(slider, canvas);
  current.focused = slider;
  // Another owner (e.g. the shell) may have registered the operator already; then it keeps owning it.
  if (current.unregister === null && app.operators.get('time.selectBand') === undefined) {
    current.unregister = registerTimelineContributions(app, () => current.focused);
  }
  return () => {
    current.sliders.delete(slider);
    if (current.focused === slider) current.focused = [...current.sliders.keys()].at(-1) ?? null;
    if (current.sliders.size > 0) return;
    current.unregister?.();
    current.unregister = null;
    hosts.delete(app);
  };
}

/** Marks the slider the user interacts with as the focused one. */
export function focusTimeSlider(app: EditorApp, slider: TimeSliderController): void {
  const host = hosts.get(app);
  if (host?.sliders.has(slider) === true) host.focused = slider;
}

/** The focused time slider of `app` and its canvas, or null when no timeline panel is mounted. */
export function focusedTimeSlider(
  app: EditorApp,
): { readonly slider: TimeSliderController; readonly canvas: HTMLCanvasElement } | null {
  const host = hosts.get(app);
  const slider = host?.focused ?? null;
  const canvas = slider === null ? undefined : host?.sliders.get(slider);
  return slider === null || canvas === undefined ? null : { slider, canvas };
}

/**
 * Viewport CSS px of an active-clip frame on the focused time slider (vertical centre of the slider), for the e2e
 * test API's `screenOfFrame` (MVP-SPEC §4.8). Null without a mounted slider.
 */
export function screenOfTimelineFrame(app: EditorApp, frame: Frame): { readonly x: number; readonly y: number } | null {
  const surface = focusedTimeSlider(app);
  if (surface === null) return null;
  const rect = surface.canvas.getBoundingClientRect();
  return { x: rect.left + surface.slider.frameToX(frame), y: rect.top + rect.height / 2 };
}

/** Viewport CSS px of the key tick at `frame` (`screenOfTick`, §4.8); null when no shown key sits there. */
export function screenOfTimelineTick(app: EditorApp, frame: Frame): { readonly x: number; readonly y: number } | null {
  const surface = focusedTimeSlider(app);
  const point = surface?.slider.tickPoint(frame) ?? null;
  if (surface === null || point === null) return null;
  const rect = surface.canvas.getBoundingClientRect();
  return { x: rect.left + point.x, y: rect.top + point.y };
}
