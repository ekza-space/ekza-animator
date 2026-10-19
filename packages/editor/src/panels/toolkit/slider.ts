// The virtual slider of an operator parameter (M6A-SPEC §8.6, §7 "drag speed"; B11): a horizontal drag on a field's
// label (LMB after 3 px, or an MMB press) changes the value by the shipped per-pixel rate (`paramSliderRate`), with
// the M2a modifier rule read at every move: `Shift` ×0.1 slower, `Mod` ×10 faster. Values integrate the increments
// and stay inside the param's hard limits (ints round). Pointer capture keeps the drag on the label; `Esc` cancels.
import type { ParamDef } from '@ekza-animator/anim-core';
import { clampParamValue, type EditorApp, paramSliderRate, virtualSliderFactor } from '@ekza-animator/editor-core';

/** LMB drags on a label start after this many CSS px (the Channel Box rule). */
export const LABEL_DRAG_PX = 3;

export interface ParamSlide {
  /** Ends the drag: `commit` keeps the value, otherwise the start value comes back. */
  finish(commit: boolean): void;
  /** True once the drag ended. */
  readonly done: boolean;
}

export interface ParamSlideHandlers {
  /** A new value while dragging (live preview; no document writes). */
  update(value: number): void;
  /** The drag ended with this value (`commit` false: cancelled, the value is the start value). */
  end(value: number, commit: boolean): void;
}

/**
 * Starts a slider drag from `press` on `element` (call after the LMB threshold or at once for MMB). `initialDx` is the
 * motion already made before the drag started (applied with the press's modifiers).
 */
export function startParamSlide(
  app: EditorApp,
  def: ParamDef,
  start: number,
  element: HTMLElement,
  press: {
    readonly pointerId: number;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
  handlers: ParamSlideHandlers,
  initialDx = 0,
): ParamSlide {
  const rate = paramSliderRate(def, app.prefs.getState().virtualSlider);
  const mac = app.keymap.platform === 'mac';
  const modOf = (e: { readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean => (mac ? e.metaKey : e.ctrlKey);
  const listeners = new AbortController();
  const win = element.ownerDocument.defaultView ?? window;
  let raw = start + initialDx * rate * virtualSliderFactor({ shift: press.shiftKey, mod: modOf(press) });
  let value = clampParamValue(def, raw).value;
  let lastX: number | null = null;
  let done = false;
  try {
    element.setPointerCapture(press.pointerId);
  } catch {
    // Synthetic presses in tests have no active pointer to capture.
  }
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    listeners.abort();
    try {
      element.releasePointerCapture(press.pointerId);
    } catch {
      // Already released.
    }
    handlers.end(commit ? value : start, commit);
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerId !== press.pointerId) return;
    const dx = event.movementX !== 0 || lastX === null ? event.movementX : event.clientX - lastX;
    lastX = event.clientX;
    if (dx === 0) return;
    raw += dx * rate * virtualSliderFactor({ shift: event.shiftKey, mod: modOf(event) });
    const next = clampParamValue(def, raw).value;
    if (next === value) return;
    value = next;
    handlers.update(value);
  };
  const opts = { signal: listeners.signal };
  win.addEventListener('pointermove', move, opts);
  win.addEventListener('pointerup', (event) => event.pointerId === press.pointerId && finish(true), opts);
  win.addEventListener('pointercancel', (event) => event.pointerId === press.pointerId && finish(false), opts);
  win.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    },
    { signal: listeners.signal, capture: true },
  );
  if (value !== start) handlers.update(value);
  return {
    finish,
    get done() {
      return done;
    },
  };
}
