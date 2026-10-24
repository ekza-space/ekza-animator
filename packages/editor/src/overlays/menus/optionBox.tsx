// B11's shell overlay (M6A-SPEC §8.5, §8.4; registered into B9's `optionBox` shell slot): the option box popover
// (`OptionBoxPopover`: an operator's params as defaults for its next run, `prefs.modeling.optionDefaults`; the view is
// a lazy chunk). A lazy chunk (§5.27): `panels/toolkit/ModelOpsSlot.tsx` mounts it on the first Model entry. The
// numeric capture window's page bridge (§5.10) is eager (`./captureBridge.ts`, installed by that slot when the shell
// mounts). B11's marking menus are data the page's host registers on the first Model entry for every shell
// (`overlays/menus`, `host/registrations`; STUDIO-TOUCH-SPEC §20.3 item 12, T3).
import type { EditorApp } from '@ekza-studio/editor-core';
import { type JSX, lazy, Suspense } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStoreSelector } from '../../hooks/useStoreSelector';
import type { ShellOverlayProps } from '../slots';

const OptionBoxView = lazy(() => import('../../panels/toolkit/OptionBoxView'));

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

export function ModelOpsShellOverlay({ app }: ShellOverlayProps): JSX.Element | null {
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
