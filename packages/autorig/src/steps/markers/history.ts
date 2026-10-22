// ②'s marker history (AR-D8-3; D8; lazy with the step view). Quick Rig's markers are U state (M6b §0.2: nothing in
// Quick Rig writes the document), so the shipped undo would skip them and undo the import behind the step, leaving an
// empty ②. While ② is mounted the step registers its own undo (`shell/stepUndo`): every marker change (a drag from
// pointer down to up, one nudge, a guess) is one step; Undo / Redo restore the markers, which were moved, and the
// selection (`skel.quickRig.setMarker` for each changed marker, the preview follows), and an empty history does nothing.
// The history starts empty on every entry and is dropped when Quick Rig closes or its meshes change.
import type { Disposer } from '@ekza-studio/anim-core';
import { QUICK_RIG_MARKERS, type QuickRigState, quickRigOf } from '@ekza-studio/editor-core';
import { messages } from '../../i18n';
import type { WizardContext } from '../../shell/context';
import { stepUndo } from '../../shell/stepUndo';
import './strings';

type Marker = (typeof QUICK_RIG_MARKERS)[number];

interface Snapshot {
  readonly markers: QuickRigState['markers'];
  readonly moved: ReadonlySet<Marker>;
  readonly selected: Marker | null;
}

const snap = (state: QuickRigState): Snapshot => ({
  markers: state.markers,
  moved: state.moved,
  selected: state.selected,
});

const sameMeshes = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((mesh, i) => mesh === b[i]);

/** Installs the marker history while ② is mounted; returns its disposer (the document history applies again). */
export function installMarkerHistory(ctx: WizardContext): Disposer {
  const { app } = ctx;
  const past: Snapshot[] = [];
  const future: Snapshot[] = [];
  const store = stepUndo(ctx.session);
  let pointerDown = false;
  let group = false;
  let applying = false;

  const restore = async (target: Snapshot): Promise<void> => {
    const state = quickRigOf(app);
    if (state === null) return;
    applying = true;
    try {
      for (const name of QUICK_RIG_MARKERS) {
        const point = target.markers[name];
        const now = state.markers[name];
        const moved = target.moved.has(name);
        const same = now !== undefined && point !== undefined && now.every((v, i) => v === point[i]);
        if (point === undefined || (same && state.moved.has(name) === moved)) continue;
        await app.runUntyped('skel.quickRig.setMarker', { name, point: [...point], moved });
      }
      await app.runUntyped('skel.quickRig.pick', { marker: target.selected });
    } finally {
      applying = false;
    }
  };

  const publish = (): void => {
    const label = messages().markers.historyLabel;
    store.set({
      undoLabel: past.length > 0 ? label : null,
      redoLabel: future.length > 0 ? label : null,
      undo() {
        const state = quickRigOf(app);
        const target = past.pop();
        if (state === null || target === undefined) return;
        future.push(snap(state));
        group = false;
        publish();
        void restore(target);
      },
      redo() {
        const state = quickRigOf(app);
        const target = future.pop();
        if (state === null || target === undefined) return;
        past.push(snap(state));
        group = false;
        publish();
        void restore(target);
      },
    });
  };

  const off = app.session.subscribe((state, previous) => {
    const now = state.rig.quickRig;
    const before = previous.rig.quickRig;
    if (now === before || applying) return;
    if (now === null || before === null || !sameMeshes(now.meshes, before.meshes)) {
      past.length = 0;
      future.length = 0;
      group = false;
      publish();
      return;
    }
    if (now.markers === before.markers) return;
    // A drag is one step (pointer down to up); a nudge or a guess is one step each.
    if (!group) {
      past.push(snap(before));
      future.length = 0;
      publish();
    }
    group = pointerDown;
  });
  const onDown = (): void => {
    pointerDown = true;
  };
  const onUp = (): void => {
    pointerDown = false;
    group = false;
  };
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  window.addEventListener('pointerup', onUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onUp, { capture: true, passive: true });
  publish();
  return () => {
    off();
    window.removeEventListener('pointerdown', onDown, { capture: true });
    window.removeEventListener('pointerup', onUp, { capture: true });
    window.removeEventListener('pointercancel', onUp, { capture: true });
    store.set(null);
  };
}
