// Snapping and the transform tools' settings (M6A-SPEC §6.2, §5.15; B12a).
// - `model.snap.toggle {kind}`: the sticky grid/vertex/increment toggles (`session.model.snap`, U state). The holds
//   (`X`, `V`, `J`) are tool modifiers the viewport's transform tools read themselves (§7 "Tool modifiers").
// - The **Component** orientation of the Move and Rotate tools (§5.15: World / Object / Component; Maya's averaged
//   frame of the selected components): the preferences keep Object/World (`moveSpace`, `rotateSpace`, a closed
//   contract), so the Component choice is remembered per app here and `view.setManipSpace` accepts it.
// - The last-picked manipulator handle of the W/E/R tools (`session.model.tweakHandle`, the MMB rule): set by a LMB
//   press on a handle, cleared on a tool switch.
import type { Disposer } from '@ekza-animator/anim-core';
import type { EditorApp, ManipHandle } from '../../types';
import { type AnyOperator, defineOperator, fail, isRecord, OK } from './define';

export type SnapKind = 'grid' | 'vertex' | 'increment';
export const SNAP_KINDS: readonly SnapKind[] = ['grid', 'vertex', 'increment'];
export const SNAP_LABELS: Readonly<Record<SnapKind, string>> = {
  grid: 'Grid',
  vertex: 'Vertex',
  increment: 'Increment',
};

const snapToggle = defineOperator({
  id: 'model.snap.toggle',
  label: 'Snap',
  description: 'Toggles grid, vertex or increment snapping for transforms.',
  category: 'model',
  scope: 'model',
  extraArgs: ['kind'],
  workspaces: ['model'],
  poll(_ctx, raw) {
    const args: unknown = raw;
    return isRecord(args) && SNAP_KINDS.includes(args['kind'] as SnapKind)
      ? OK
      : fail('expects { kind: grid | vertex | increment }');
  },
  apply({ app }, args) {
    const state = app.session.getState();
    const snap = state.model.snap;
    app.session.setState({ model: { ...state.model, snap: { ...snap, [args.kind]: !snap[args.kind] } } });
  },
});

export const SNAP_OPERATORS: readonly AnyOperator[] = [snapToggle];

// ---------- transform orientation ----------

/** The frame a transform tool moves along: World, Object (the lead object's axes) or Component (§5.15). */
export type TransformSpace = 'world' | 'object' | 'component';
export type TransformToolKind = 'move' | 'rotate' | 'scale';

interface SpaceStore {
  readonly component: { move: boolean; rotate: boolean };
  readonly listeners: Set<() => void>;
}

const spaces = new WeakMap<EditorApp, SpaceStore>();

function spaceStore(app: EditorApp): SpaceStore {
  let store = spaces.get(app);
  if (store === undefined) {
    store = { component: { move: false, rotate: false }, listeners: new Set() };
    spaces.set(app, store);
  }
  return store;
}

/**
 * The orientation of a transform tool on components and objects in Model: Component when chosen for Move/Rotate,
 * else the preference (`moveSpace`; `rotateSpace`, Gimbal reads as Object here). The Scale tool follows Move.
 */
export function transformSpace(app: EditorApp, tool: TransformToolKind): TransformSpace {
  const store = spaceStore(app);
  const prefs = app.prefs.getState();
  if (tool === 'rotate') {
    if (store.component.rotate) return 'component';
    return prefs.rotateSpace === 'world' ? 'world' : 'object';
  }
  if (store.component.move) return 'component';
  return prefs.moveSpace;
}

/** Whether Component is the chosen orientation of Move or Rotate. */
export function componentSpaceOn(app: EditorApp, tool: 'move' | 'rotate'): boolean {
  return spaceStore(app).component[tool];
}

/** Chooses (or leaves) the Component orientation of Move or Rotate; listeners hear every change. */
export function setComponentSpace(app: EditorApp, tool: 'move' | 'rotate', on: boolean): void {
  const store = spaceStore(app);
  if (store.component[tool] === on) return;
  store.component[tool] = on;
  for (const listener of Array.from(store.listeners)) listener();
}

export function subscribeTransformSpace(app: EditorApp, listener: () => void): Disposer {
  const store = spaceStore(app);
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

// ---------- the last-picked handle (MMB rule) ----------

/** Records the handle a LMB press picked (null clears it): MMB drags then follow it (§5.15). */
export function setTweakHandle(app: EditorApp, handle: ManipHandle | null): void {
  const state = app.session.getState();
  if (state.model.tweakHandle === handle) return;
  app.session.setState({ model: { ...state.model, tweakHandle: handle } });
}
