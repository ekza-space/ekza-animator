// The DOM side of the Channels panel virtual slider (M2A-SPEC §5.18, A2), shared by the Channels panel rows and the
// viewport's plain MMB drag: Pointer Lock when available (no edge stop), else pointer capture; both integrate
// `PointerEvent.movementX` (never clientX differences), so the values are identical in both modes.
//
// Chrome uses Esc to leave Pointer Lock and does not deliver that keydown to the page, and refuses a new lock for a
// moment after the user left one, so: a `pointerlockchange` to unlocked during an active gesture cancels it (the Esc
// path under lock); a rejected `requestPointerLock()` promise or a `pointerlockerror` falls back to pointer capture
// for that gesture; under pointer capture Esc cancels as usual. Releasing the pointer commits (one history step).
import type { ChannelRef, EditorApp, VirtualSlider } from '@ekza-studio/editor-core';
import { beginVirtualSlider } from '@ekza-studio/editor-core';

export interface VirtualSliderDrag {
  /** 'lock' while Pointer Lock holds the pointer, 'capture' otherwise. */
  readonly mode: 'lock' | 'capture';
  readonly active: boolean;
  /** Ends the gesture: `commit` keeps the values (one step), otherwise they are restored. */
  end(commit: boolean): void;
}

export interface VirtualSliderDragOptions {
  /** Try Pointer Lock first (default true; the e2e switch `pointerLock=off` passes false). */
  readonly pointerLock?: boolean;
  /** History label (default: the slider's channel label). */
  readonly label?: string;
  /** Called once when the gesture ends (committed or cancelled). */
  readonly onEnd?: (committed: boolean) => void;
  /**
   * Motion already made before the slider started (the Channels panel's LMB drag starts after 3 px; the `movementX`
   * integrated since the press, never a clientX distance): applied as the first increment, with the press's
   * modifiers.
   */
  readonly initialDx?: number;
  /**
   * M6a (M6A-SPEC §5.17 (b); B9): the press is the viewport's MMB stand-in (`Alt+Shift`+LMB in Model on the trackpad
   * and one-button profiles), delivered as MMB with Alt and Shift cleared: for the whole gesture Shift is part of the
   * chord, never the ×0.1 rate. `Mod` keeps its ×10. Default false.
   */
  readonly standIn?: boolean;
}

/**
 * Starts a virtual slider drag from a pointer press on `element` (a Channels panel row or a viewport pane). Returns
 * null when no channel of `refs` can be edited (nothing starts).
 */
export function startVirtualSliderDrag(
  app: EditorApp,
  refs: readonly ChannelRef[],
  element: HTMLElement,
  press: PointerEvent,
  opts: VirtualSliderDragOptions = {},
): VirtualSliderDrag | null {
  const slider: VirtualSlider = beginVirtualSlider(
    app,
    refs,
    opts.label === undefined ? undefined : { label: opts.label },
  );
  if (!slider.active) return null;
  const mac = app.keymap.platform === 'mac';
  // The stand-in's Shift belongs to its chord (§5.17 (b)): the rate reads it as released.
  const shiftOf = (event: { readonly shiftKey: boolean }): boolean => opts.standIn !== true && event.shiftKey;
  const doc = element.ownerDocument;
  const win = doc.defaultView ?? window;
  const pointerId = press.pointerId;
  let mode: 'lock' | 'capture' = 'capture';
  let locked = false;
  let done = false;
  const listeners = new AbortController();
  const signal = listeners.signal;

  const capture = (): void => {
    mode = 'capture';
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Synthetic events in tests have no active pointer to capture.
    }
  };
  const release = (): void => {
    try {
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    } catch {
      // See capture().
    }
    if (doc.pointerLockElement === element) {
      try {
        doc.exitPointerLock();
      } catch {
        // Nothing to exit.
      }
    }
  };
  const end = (commit: boolean): void => {
    if (done) return;
    done = true;
    listeners.abort();
    release();
    if (commit) slider.commit();
    else slider.cancel();
    opts.onEnd?.(commit);
  };

  const onMove = (event: PointerEvent): void => {
    if (done || (event.pointerId !== pointerId && mode === 'capture')) return;
    event.preventDefault();
    slider.move(event.movementX, { shift: shiftOf(event), mod: mac ? event.metaKey : event.ctrlKey });
    if (!slider.active) end(false);
  };
  element.addEventListener('pointermove', onMove, { signal });
  win.addEventListener('pointerup', () => end(true), { signal });
  element.addEventListener('pointerup', () => end(true), { signal });
  element.addEventListener('pointercancel', () => end(false), { signal });
  win.addEventListener('blur', () => end(false), { signal });
  win.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      end(false);
    },
    { signal, capture: true },
  );
  doc.addEventListener(
    'pointerlockchange',
    () => {
      if (doc.pointerLockElement === element) {
        locked = true;
        mode = 'lock';
      } else if (locked) {
        // Left the lock during the gesture: the Esc path under Pointer Lock cancels.
        locked = false;
        end(false);
      }
    },
    { signal },
  );
  doc.addEventListener(
    'pointerlockerror',
    () => {
      if (!done && !locked) capture();
    },
    { signal },
  );

  // Capture first: moves arriving before the lock is granted still reach the element.
  capture();
  if (opts.initialDx !== undefined && opts.initialDx !== 0) {
    slider.move(opts.initialDx, { shift: shiftOf(press), mod: mac ? press.metaKey : press.ctrlKey });
  }
  const lockable = opts.pointerLock !== false && typeof element.requestPointerLock === 'function';
  if (lockable) {
    try {
      const request = element.requestPointerLock() as unknown;
      if (request instanceof Promise) {
        request.catch(() => {
          if (!done && !locked) capture();
        });
      }
    } catch {
      capture();
    }
  }

  return {
    get mode() {
      return mode;
    },
    get active() {
      return !done;
    },
    end,
  };
}
