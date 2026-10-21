// The selected reference image plane (M6A-SPEC §5.26, §8.8; B13): image planes are never picked in the viewport, so
// the Outliner's Reference rows (and a fresh import) select one for the Attributes panel's Image plane section. Per
// app, U state outside the document; selecting scene objects clears it, and a deleted plane is never reported.
import type { ImagePlaneId } from '@ekza-studio/doc';
import type { EditorApp } from '@ekza-studio/editor-core';
import { useEffect, useSyncExternalStore } from 'react';

interface Slot {
  id: ImagePlaneId | null;
  readonly listeners: Set<() => void>;
}

const slots = new WeakMap<EditorApp, Slot>();

function slotOf(app: EditorApp): Slot {
  let slot = slots.get(app);
  if (slot === undefined) {
    slot = { id: null, listeners: new Set() };
    slots.set(app, slot);
  }
  return slot;
}

/** The selected plane while it is live, else null. */
export function selectedPlane(app: EditorApp): ImagePlaneId | null {
  const id = slotOf(app).id;
  return id !== null && app.store.get('imagePlanes', id) !== undefined ? id : null;
}

/** Selects a plane (null clears); with a plane, the scene object selection is cleared so Attributes shows it. */
export function setSelectedPlane(app: EditorApp, id: ImagePlaneId | null): void {
  const slot = slotOf(app);
  if (id !== null) {
    const state = app.session.getState();
    if (state.selection.objects.length > 0) app.session.setState({ selection: { ...state.selection, objects: [] } });
  }
  if (slot.id === id) return;
  slot.id = id;
  for (const listener of Array.from(slot.listeners)) listener();
}

/** The selected plane, re-rendering on changes; selecting scene objects or deleting the plane clears it. */
export function useSelectedPlane(app: EditorApp): ImagePlaneId | null {
  const slot = slotOf(app);
  const id = useSyncExternalStore(
    (listener) => {
      slot.listeners.add(listener);
      return () => slot.listeners.delete(listener);
    },
    () => slot.id,
    () => slot.id,
  );
  useEffect(
    () =>
      app.session.subscribe((state, previous) => {
        if (state.selection.objects !== previous.selection.objects && state.selection.objects.length > 0) {
          setSelectedPlane(app, null);
        }
      }),
    [app],
  );
  return id !== null && app.store.get('imagePlanes', id) !== undefined ? id : null;
}
