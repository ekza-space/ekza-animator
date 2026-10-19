// The modal readout's state (M6A-SPEC §8.7, §5.10, §5.15; B12a): what the editor's `ModalReadout` chip draws next
// to the pointer during a transform drag (the dragged value), the snap candidate ring and chip ("→ vertex 128 ·
// Torso") and the soft-select radius ring while `B` is held. Eager and tiny: the editor overlay subscribes to it, the
// lazy transform runtime writes it.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp } from '@ekza-animator/editor-core';

export interface TransformReadout {
  readonly paneId: string;
  /** The pointer, pane CSS px. */
  readonly x: number;
  readonly y: number;
  /** The dragged field and its value ("Translate Y 0.250 m"); null without a drag. */
  readonly label: string | null;
  readonly value: string | null;
  /** The snap candidate (pane CSS px) and its name. */
  readonly snap: { readonly x: number; readonly y: number; readonly label: string } | null;
  /** The soft-select radius ring at the pointer (`B` held), radius in CSS px, with the radius text. */
  readonly ring: { readonly x: number; readonly y: number; readonly r: number; readonly label: string } | null;
}

interface Store {
  value: TransformReadout | null;
  readonly listeners: Set<() => void>;
}

const stores = new WeakMap<EditorApp, Store>();

function storeOf(app: EditorApp): Store {
  let store = stores.get(app);
  if (store === undefined) {
    store = { value: null, listeners: new Set() };
    stores.set(app, store);
  }
  return store;
}

/** The readout drawn now, or null. */
export function transformReadout(app: EditorApp): TransformReadout | null {
  return storeOf(app).value;
}

/** Replaces the readout (null hides it). */
export function setTransformReadout(app: EditorApp, value: TransformReadout | null): void {
  const store = storeOf(app);
  if (store.value === value) return;
  store.value = value;
  for (const listener of Array.from(store.listeners)) listener();
}

export function subscribeTransformReadout(app: EditorApp, listener: () => void): Disposer {
  const store = storeOf(app);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}
