// The numeric capture window's page bridge (M6A-SPEC §5.10 (b); B11): a keyboard-op window disarms at the first pointer
// move beyond 3 CSS px from where the pointer was when it armed, and at any click; the capture's messages ("Entry
// discarded") and the Model tools' messages go to the help line. Eager (§5.27): B11's shell slot
// (`panels/toolkit/ModelOpsSlot.tsx`) installs it when the shell mounts, so it has seen the pointer before the window
// can arm. Mounted from the lazy overlay chunk instead, it missed the moves made before that chunk landed: nothing
// orders the chunk with the B11 runtime that arms the window, and since T3 the Shift+RMB menus no longer wait for it
// either, so a window armed in that gap took the first move as its origin and never disarmed (E2E-MOD-19 B11).
import { type EditorApp, type NumericCapture, onModelHelp } from '@ekza-studio/editor-core';
import type { Shell } from '../../shell/types';

/** Pointer travel (CSS px) after which the keyboard-op capture window disarms (§5.10 (b)). */
export const CAPTURE_POINTER_SLOP = 3;

/**
 * Installs the bridge on `win` and returns its disposer. The origin is the last pointer position seen before the
 * window armed; when no pointer has moved since the bridge was installed, the first move sets it.
 */
export function bridgeCapture(app: EditorApp, shell: Pick<Shell, 'help'> | null, win: Window = window): () => void {
  const capture = app.capture as Partial<NumericCapture>;
  let pointer: { x: number; y: number } | null = null;
  let origin: { x: number; y: number } | null = null;
  const offState =
    capture.subscribe?.((state) => {
      origin = state.armed === 'keyboard-op' ? (origin ?? pointer) : null;
    }) ?? (() => {});
  const offMessage = capture.onMessage?.((message) => shell?.help(message.text, message.tone)) ?? (() => {});
  // M6a (B12b): the Model tools' messages ("Click on each face the cut crosses", "Extrude removed: it did not move",
  // "No mirror partner: applied to one side") go to the help line too.
  const offTools = onModelHelp(app, (message) => shell?.help(message.text, message.tone));
  const onMove = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    if (app.capture.state.armed !== 'keyboard-op') return;
    if (origin === null) {
      origin = pointer;
      return;
    }
    if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) > CAPTURE_POINTER_SLOP) app.capture.disarm();
  };
  const onDown = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
    if (app.capture.state.armed === 'keyboard-op') app.capture.disarm();
  };
  win.addEventListener('pointermove', onMove, { capture: true, passive: true });
  win.addEventListener('pointerdown', onDown, { capture: true });
  return () => {
    offState();
    offMessage();
    offTools();
    win.removeEventListener('pointermove', onMove, { capture: true });
    win.removeEventListener('pointerdown', onDown, { capture: true });
  };
}
