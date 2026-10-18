// Key-editing drags (M2A-SPEC §4.5 `beginKeyEditGesture`, §5.21.1 M-1 mechanism 1): the Graph Editor, the Dope Sheet
// and the time slider drag keys in ONE document preview whose updates are coalesced to one per animation frame
// (`app.scheduleBeforeFrame`), committed as ONE transaction and recorded as ONE editor-history step. Esc (or a
// preview cancelled from outside, `edit.escape`) leaves no trace. Session overrides the drag consumed (a Tween bar
// drag on the pose keys channels whose overrides then leave the session) go into the same step, as the operator
// runner records them, so undo brings them back (MVP-SPEC §4.11.1 rule 5).
import type { ChangeBatch, Tx } from '@ekza-animator/doc';
import { internalsOf } from '../app/internals';
import type { CaptureOutcome } from '../history/capture';
import { overrideDelta, sameLocation } from '../history/overrides';
import { activeLocation, ownerOfControl } from '../session/location';
import { selectionSnapshot } from '../session/selection';
import type { EditorApp, KeyEditGesture } from '../types';

let nextGesture = 0;

/**
 * Starts a key-editing drag. `update(edit)` replaces the pending edit; the edit is applied at the next
 * `flushScheduled` (the frame loop's first step; synchronously in Node, where no frame requester is installed) on
 * top of committed state. `commit(final)` drops a pending update, applies `final` at once (callers pass
 * `resolveCollisions: true`), commits one transaction and records one step labelled `meta.label ?? label`; the step
 * also carries the change of the session overrides since the gesture began (when the active clip frame is the same).
 * Throws `EkzaError('preview-active')` while another preview runs and `EkzaError('read-only')` on a read-only store.
 */
export function beginKeyEditGesture(app: EditorApp, label: string): KeyEditGesture {
  const preview = app.store.beginPreview(label);
  const key = `keyEditGesture:${nextGesture++}`;
  const selectionBefore = selectionSnapshot(app.session.getState().selection);
  const overridesBefore = app.session.getState().overrides;
  const where = activeLocation(app);
  const gestures = internalsOf(app).gestures;
  let active = true;
  let pending: ((tx: Tx) => void) | null = null;

  const finish = (): void => {
    active = false;
    pending = null;
    gestures.delete(handle);
  };
  const flushPending = (): void => {
    const edit = pending;
    pending = null;
    if (!active || edit === null) return;
    if (!preview.active) {
      // Cancelled from outside (edit.escape): the gesture ends without a trace.
      finish();
      return;
    }
    preview.update(edit);
  };
  const handle = { cancel: (): void => gesture.cancel() };

  const gesture: KeyEditGesture = {
    get active() {
      return active && preview.active;
    },
    update(edit: (tx: Tx) => void): void {
      if (!active) return;
      pending = edit;
      app.scheduleBeforeFrame(key, flushPending);
    },
    commit(final: (tx: Tx) => void, meta?: { readonly label?: string }): ChangeBatch | null {
      if (!active) return null;
      if (!preview.active) {
        finish();
        return null;
      }
      finish();
      const stepLabel = meta?.label ?? label;
      const capture = internalsOf(app).capture;
      const scope = capture?.begin() ?? null;
      const topBefore = app.store.undo.peekUndo()?.txId ?? null;
      let outcome: CaptureOutcome = { kind: 'none' };
      let batch: ChangeBatch | null = null;
      try {
        preview.update(final);
        batch = preview.commit({
          label: stepLabel,
          selectionBefore,
          selectionAfter: selectionSnapshot(app.session.getState().selection),
        });
        if (scope === null) {
          const top = app.store.undo.peekUndo();
          if (batch !== null && top !== null && top.txId === batch.txId && top.txId !== topBefore) {
            outcome = { kind: 'new', txId: top.txId, label: stepLabel };
          }
        }
      } catch (error) {
        // Nothing was written (read-only store, a throwing edit): the gesture ends as if cancelled.
        if (preview.active) preview.cancel();
        throw error;
      } finally {
        if (capture !== null && scope !== null) outcome = capture.end(scope);
      }
      const docTxId = outcome.kind === 'new' || outcome.kind === 'coalesced' ? outcome.txId : null;
      const whereAfter = activeLocation(app);
      const overrides =
        whereAfter !== null && sameLocation(where, whereAfter)
          ? overrideDelta(overridesBefore, app.session.getState().overrides, whereAfter, (control) =>
              ownerOfControl(app.store, control),
            )
          : null;
      if (docTxId !== null || overrides !== null) app.history.record({ label: stepLabel, docTxId, overrides });
      return batch;
    },
    cancel(): void {
      if (!active) return;
      finish();
      if (preview.active) preview.cancel();
    },
  };
  gestures.add(handle);
  return gesture;
}
