// The modal readout chip (M6A-SPEC §8.7, §5.10, §5.15; B12a), drawn in each viewport pane's `modalReadout` slot: the
// dragged field and its value next to the pointer during a transform drag, the numeric capture entry ("Translate Y
// 0.5_ · Enter ✓ · Esc ✕ · Tab next") from the first typed digit, the snap candidate's ring and name, and the
// soft-select radius ring while `B` is held. This file is the eager facade: it subscribes to the viewport's readout
// state and the capture window, and loads the drawing (`ModalReadoutView`) the first time there is something to show.
//
// `registerModelTransformUi()` (one line in the Studio shell) registers the slot, drawn in Pro's panes (`PaneView`).
// B12a's marking menus (`model.options`, the `W`/`E`+LMB space menus) are data the page's host registers on the first
// Model entry for every shell (`overlays/menus`, `host/registrations`; STUDIO-TOUCH-SPEC §20.3 item 12, T3).
import type { Disposer } from '@ekza-studio/anim-core';
import type { EditorApp, NumericCaptureState } from '@ekza-studio/editor-core';
import { subscribeTransformReadout, transformReadout } from '@ekza-studio/viewport';
import { type JSX, lazy, Suspense, useSyncExternalStore } from 'react';
import { type PaneOverlayProps, registerPaneOverlay } from '../../overlays/slots';

const ModalReadoutView = lazy(() => import('./ModalReadoutView'));

interface CaptureLike {
  subscribe?(listener: (state: NumericCaptureState) => void): Disposer;
}

function useCaptureState(app: EditorApp): NumericCaptureState {
  return useSyncExternalStore(
    (listener) => (app.capture as CaptureLike).subscribe?.(() => listener()) ?? (() => {}),
    () => app.capture.state,
  );
}

export function ModalReadout(props: PaneOverlayProps): JSX.Element | null {
  const { app, paneId } = props;
  const readout = useSyncExternalStore(
    (listener) => subscribeTransformReadout(app, listener),
    () => transformReadout(app),
  );
  const capture = useCaptureState(app);
  const mine = readout !== null && readout.paneId === paneId;
  const typing = capture.armed !== null && capture.text !== null;
  if (!mine && !typing) return null;
  return (
    <Suspense fallback={null}>
      <ModalReadoutView app={app} paneId={paneId} readout={mine ? readout : null} capture={capture} />
    </Suspense>
  );
}

/** Registers the readout slot; the disposer removes it. */
export function registerModelTransformUi(): Disposer {
  return registerPaneOverlay('modalReadout', ModalReadout);
}
