// B11's shell overlay (M6A-SPEC §8.5, §5.10, §8.4; registered into B9's `optionBox` shell slot): the option box
// popover (`OptionBoxPopover`: an operator's params as defaults for its next run, `prefs.modeling.optionDefaults`;
// the view is a lazy chunk), the numeric capture window's bridge to the page (case (b) disarms at the first pointer
// move beyond 3 CSS px or any click; its messages go to the help line). A lazy chunk (§5.27):
// `panels/toolkit/ModelOpsSlot.tsx` mounts it on the first Model entry. B11's marking menus are data the page's host
// registers on the first Model entry for every shell (`overlays/menus`, `host/registrations`; STUDIO-TOUCH-SPEC
// §20.3 item 12, T3).
import { type EditorApp, type NumericCapture, onModelHelp } from '@ekza-studio/editor-core';
import { type JSX, lazy, Suspense, useEffect } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import { useOptionalShell } from '../../shell/context';
import type { Shell } from '../../shell/types';
import type { ShellOverlayProps } from '../slots';

const OptionBoxView = lazy(() => import('../../panels/toolkit/OptionBoxView'));

/** Pointer travel (CSS px) after which the keyboard-op capture window disarms (§5.10 (b)). */
export const CAPTURE_POINTER_SLOP = 3;

export interface OptionBoxState {
  /** The operator whose option box is open, null when closed. */
  readonly op: string | null;
  /** Where it opened (page CSS px), null: beside the Toolkit. */
  readonly anchor: { readonly x: number; readonly y: number } | null;
}

const CLOSED: OptionBoxState = { op: null, anchor: null };
const stores = new WeakMap<EditorApp, StoreApi<OptionBoxState>>();

export function optionBoxStore(app: EditorApp): StoreApi<OptionBoxState> {
  let store = stores.get(app);
  if (store === undefined) {
    store = createStore<OptionBoxState>()(() => CLOSED);
    stores.set(app, store);
  }
  return store;
}

/** Opens the option box of `op` (the Toolkit's `⋯`). */
export function openOptionBox(app: EditorApp, op: string, anchor: OptionBoxState['anchor'] = null): void {
  optionBoxStore(app).setState({ op, anchor });
}

export function closeOptionBox(app: EditorApp): void {
  optionBoxStore(app).setState(CLOSED);
}

/**
 * The capture window's page bridge: a keyboard-op window (b) disarms at the first pointer move beyond 3 CSS px from
 * where the pointer was when it armed, and at any click; its messages ("Entry discarded") go to the help line.
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

export function ModelOpsShellOverlay({ app }: ShellOverlayProps): JSX.Element | null {
  const shell = useOptionalShell();
  useEffect(() => bridgeCapture(app, shell), [app, shell]);
  const store = optionBoxStore(app);
  const op = useStoreSelector(store, (s) => s.op);
  const anchor = useStoreSelector(store, (s) => s.anchor);
  if (op === null) return null;
  return (
    <Suspense fallback={null}>
      <OptionBoxView app={app} op={op} anchor={anchor} onClose={() => closeOptionBox(app)} />
    </Suspense>
  );
}
