// The modal readout's state (M6A-SPEC §8.7, §5.10, §5.15; B12a): what the editor's `ModalReadout` chip draws next
// to the pointer during a transform drag (the dragged value), the snap candidate ring and chip ("→ vertex 128 ·
// Torso") and the soft-select radius ring while `B` is held; and the value a drag committed with typed fields, which
// the overlay writes to the help line (§5.10: "a polite live region announces committed values"). Eager and tiny: the
// editor overlay subscribes to it, the lazy transform runtime writes it.
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

/** A drag committed with typed values ("Move Translate Y 0.500 m"), for the help line of its pane's shell. */
export interface TransformAnnouncement {
  readonly paneId: string;
  readonly text: string;
}

interface Store {
  value: TransformReadout | null;
  said: TransformAnnouncement | null;
  readonly listeners: Set<() => void>;
}

const stores = new WeakMap<EditorApp, Store>();

function storeOf(app: EditorApp): Store {
  let store = stores.get(app);
  if (store === undefined) {
    store = { value: null, said: null, listeners: new Set() };
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
  // A new drag supersedes an announcement no pane wrote (its pane went away).
  if (value !== null) store.said = null;
  for (const listener of Array.from(store.listeners)) listener();
}

/** The last committed-value announcement not yet written to the help line, or null. */
export function transformAnnouncement(app: EditorApp): TransformAnnouncement | null {
  return storeOf(app).said;
}

/** Announces a committed value (a new object each time); null marks the last one as written. */
export function announceTransform(app: EditorApp, said: TransformAnnouncement | null): void {
  const store = storeOf(app);
  if (store.said === said) return;
  store.said = said;
  for (const listener of Array.from(store.listeners)) listener();
}

export function subscribeTransformReadout(app: EditorApp, listener: () => void): Disposer {
  const store = storeOf(app);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}
