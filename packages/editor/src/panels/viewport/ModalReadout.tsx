// The modal readout chip (M6A-SPEC §8.7, §5.10, §5.15; B12a), drawn in each viewport pane's `modalReadout` slot: the
// dragged field and its value next to the pointer during a transform drag, the numeric capture entry ("Translate Y
// 0.5_ · Enter ✓ · Esc ✕ · Tab next") from the first typed digit, the snap candidate's ring and name, and the
// soft-select radius ring while `B` is held. This file is the eager facade: it subscribes to the viewport's readout
// state and the capture window, and loads the drawing (`ModalReadoutView`) the first time there is something to show.
// A drag committed with typed values announces them on the help line (the polite live region, §5.10) from here: the
// drawing is gone by then.
//
// `registerModelTransformUi(app)` (one line in the shell) registers the slot and, on the first Model entry, B12a's
// marking menus (`model.options`, the `W`/`E`+LMB space menus; a lazy chunk).
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, NumericCaptureState } from '@ekza-animator/editor-core';
import {
  announceTransform,
  subscribeTransformReadout,
  transformAnnouncement,
  transformReadout,
} from '@ekza-animator/viewport';
import { type JSX, lazy, Suspense, useEffect, useSyncExternalStore } from 'react';
import { type PaneOverlayProps, registerPaneOverlay } from '../../overlays/slots';
import { useOptionalShell } from '../../shell/context';

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
  const said = useSyncExternalStore(
    (listener) => subscribeTransformReadout(app, listener),
    () => transformAnnouncement(app),
  );
  const shell = useOptionalShell();
  useEffect(() => {
    if (said === null || said.paneId !== paneId || shell === null) return;
    shell.help(said.text);
    announceTransform(app, null);
  }, [app, said, paneId, shell]);
  const mine = readout !== null && readout.paneId === paneId;
  const typing = capture.armed !== null && capture.text !== null;
  if (!mine && !typing) return null;
  return (
    <Suspense fallback={null}>
      <ModalReadoutView app={app} paneId={paneId} readout={mine ? readout : null} capture={capture} />
    </Suspense>
  );
}

/** Registers the readout slot and B12a's marking menus (on the first Model entry); the disposer removes them. */
export function registerModelTransformUi(app: EditorApp): Disposer {
  const disposers: Disposer[] = [registerPaneOverlay('modalReadout', ModalReadout)];
  let menus: Disposer | null = null;
  let loading = false;
  let disposed = false;
  const load = (): void => {
    if (disposed || loading || menus !== null || app.session.getState().workspace !== 'model') return;
    loading = true;
    void import('../../overlays/menus/options').then(
      (module) => {
        loading = false;
        if (!disposed) menus = module.registerModelTransformMenus(app);
      },
      () => {
        // Offline after a redeploy: the menus are missing until the next Model entry tries again.
        loading = false;
      },
    );
  };
  disposers.push(
    app.session.subscribe((state, previous) => (state.workspace !== previous.workspace ? load() : undefined)),
  );
  load();
  return () => {
    disposed = true;
    menus?.();
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };
}
