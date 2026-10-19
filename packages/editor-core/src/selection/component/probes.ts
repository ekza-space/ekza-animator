// What the viewport tells the headless Model operators about the pointer and the key being dispatched (M6A-SPEC §5.6;
// B10): `select.mode` hilites the mesh under the pointer when no mesh is selected (the press point of the RMB mode
// menu, else the hover point), and the active mode's digit returns to object mode while F9/F10 stay idempotent. The
// viewport's Model select runtime provides the probe; headless apps have none (no mesh under the pointer; a keyboard
// run counts as a digit).
import type { Disposer } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';

export interface ModelPointerProbe {
  /**
   * The mesh (a record with data) under the pointer in a pane: at the last press in it (`press`: the marking menu that
   * runs the operator opened there) or at the hover point (`hover`). Null over empty space or without a pane.
   */
  meshAt(paneId: string | null, at: 'press' | 'hover'): MeshId | null;
  /**
   * Whether a mesh without a record (a character's glTF mesh that is not made editable, §5.21) is under the pointer
   * there and no record's mesh is: it cannot be hilited ("Make editable first", §5.6). Optional (false without it).
   */
  assetMeshAt?(paneId: string | null, at: 'press' | 'hover'): boolean;
  /** `KeyboardEvent.code` of the key press the keyboard adapter is dispatching (or last dispatched), or null. */
  lastKey(): string | null;
}

const probes = new WeakMap<object, ModelPointerProbe>();

/** Installs the pointer probe of an app (the viewport's Model select runtime); the disposer removes it. */
export function provideModelPointer(app: object, probe: ModelPointerProbe): Disposer {
  probes.set(app, probe);
  return () => {
    if (probes.get(app) === probe) probes.delete(app);
  };
}

/** The app's pointer probe, or null (headless). */
export function modelPointer(app: object): ModelPointerProbe | null {
  return probes.get(app) ?? null;
}
