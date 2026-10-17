// Non-replicating half of the conformance suite (ADR 0002 §5, MVP-SPEC §4.11.0 store rules): transactions, nested
// joins, batches, previews, undo/redo/coalescing, compare-before-restore with simulated external writes, partition
// lifecycle and partition-order application, snapshots, load, migrations, unknown tables, queries.
import type { ControlId, KeyId, UserId } from '../../ids';
import { newId } from '../../ids/generate';
import { migrateSnapshot } from '../../migrations/migrate';
import type {
  ClipRecord,
  ControlRecord,
  CurveRecord,
  KeyRecord,
  LayerRecord,
  Partition,
  TableName,
} from '../../records';
import { makeKey } from '../../records/factories';
import { SCHEMA_VERSION } from '../../snapshot/version';
import type { AnyChange, Change, ChangeBatch, DocSnapshot, DocumentStore } from '../../store';
import { compareStrings, deepEqual } from '../../store/diff';
import { Rng } from '../random';
import {
  check,
  checkProjections,
  curveOf,
  docText,
  equal,
  keyAt,
  newScene,
  read,
  readRaw,
  recordBatches,
  type Scene,
  type SuiteRunner,
  seedScene,
  throwsCode,
  writeScene,
} from './harness';

type Factory = () => DocumentStore;

const REMOTE = { origin: 'remote', label: 'Remote edit', user: 'someone-else' as UserId } as const;

/** Simulates another user's write: an external batch with the record's new value. */
function external(store: DocumentStore, change: Pick<AnyChange, 'table' | 'id' | 'after'>): ChangeBatch {
  return store.applyChanges([{ ...change, before: undefined } as AnyChange], REMOTE);
}

function lastBatch(batches: readonly ChangeBatch[]): ChangeBatch {
  const batch = batches.at(-1);
  check(batch !== undefined, 'expected a batch');
  return batch;
}

function changeOf<T extends TableName>(batch: ChangeBatch, table: T, id: string): Change<T> {
  const change = batch.changes.find((c) => c.table === table && c.id === id);
  check(change !== undefined, `batch '${batch.label}' has no change for ${table}/${id}`);
  return change as unknown as Change<T>;
}

export function registerCoreCases(r: SuiteRunner, factory: Factory): void {
  r.describe('transactions and batches', () => {
    r.it('put inserts; the local batch carries txId, label, user, version and whole-record changes', async () => {
      const store = factory();
      const log = recordBatches(store);
      const scene = await seedScene(store);
      const batch = lastBatch(log.batches);
      equal(batch.origin, 'local', 'origin');
      equal(batch.label, 'Seed', 'label');
      equal(batch.user, store.user, 'user');
      equal(batch.version, store.version, 'version is the store version after the batch');
      check(typeof batch.txId === 'string' && batch.txId.length > 0, 'txId');
      const key = changeOf(batch, 'keys', scene.keys[0]);
      equal(key.before, undefined, 'insert: before undefined');
      equal(key.after, read(store, 'keys', scene.keys[0]), 'insert: after is the record');
      check(key.fields === undefined, 'inserts carry no fields');
      equal(read(store, 'clips', scene.clip)?.name, 'wave', 'get reads the record');
      equal(
        store.list('controls').map((c) => c.id),
        [...scene.controls].sort(compareStrings),
        'list is ordered by id',
      );
      log.dispose();
    });

    r.it('reads inside a transaction see its writes (get, list, query)', async () => {
      const store = factory();
      const scene = await seedScene(store);
      store.transact({ label: 'Edit' }, (tx) => {
        const extra = keyAt(scene, scene.curve, 5, 0.25);
        tx.put('keys', extra);
        equal(tx.get('keys', extra.id)?.v, 0.25, 'tx.get');
        check(
          tx.list('keys').some((k) => k.id === extra.id),
          'tx.list',
        );
        equal(
          tx.query.keysOfCurve(scene.curve).map((k) => k.t),
          [0, 5, 10, 20],
          'tx.query sees the new key',
        );
        tx.patch('clips', scene.clip, { name: 'wave2' });
        equal(tx.get('clips', scene.clip)?.name, 'wave2', 'patched value visible');
      });
    });

    r.it('an exception rolls back every write, emits nothing and records no undo entry', async () => {
      const store = factory();
      await seedScene(store);
      const before = docText(store);
      const version = store.version;
      const entry = store.undo.peekUndo();
      const log = recordBatches(store);
      const scene = newScene(2);
      let caught: unknown;
      try {
        store.transact({ label: 'Fails' }, (tx) => {
          writeScene(tx, scene, { withProject: false });
          throw new Error('boom');
        });
      } catch (error) {
        caught = error;
      }
      check(caught instanceof Error && caught.message === 'boom', 'the callback error propagates');
      equal(docText(store), before, 'document unchanged');
      equal(
        log.batches.filter((b) => b.origin !== 'load'),
        [],
        'no batch emitted',
      );
      check(store.version >= version, 'version never decreases');
      check(store.undo.peekUndo() === entry, 'no undo entry');
      log.dispose();
    });

    r.it(
      'a transact inside a transact joins it: one batch, the outer meta wins, annotate sets the outermost',
      async () => {
        const store = factory();
        const scene = await seedScene(store);
        const log = recordBatches(store);
        store.transact({ label: 'Outer', selectionBefore: 'sel-0' }, (tx) => {
          tx.patch('clips', scene.clip, { loop: true });
          store.transact({ label: 'Inner', coalesceKey: 'ignored' }, (inner) => {
            inner.patch('layers', scene.layer, { weight: 0.5 });
            inner.annotate({ label: 'Annotated', selectionAfter: 'sel-1' });
          });
        });
        equal(log.batches.length, 1, 'one batch');
        equal(lastBatch(log.batches).label, 'Annotated', 'annotate adjusts the outermost label');
        equal(lastBatch(log.batches).changes.length, 2, 'both writes in the batch');
        const entry = store.undo.peekUndo();
        equal(entry?.label, 'Annotated', 'one undo entry with the annotated label');
        equal(entry?.selectionBefore, 'sel-0', 'outer selectionBefore');
        equal(entry?.selectionAfter, 'sel-1', 'annotated selectionAfter');
        store.undo.undo();
        equal(read(store, 'clips', scene.clip)?.loop, false, 'one undo reverts the outer write');
        equal(read(store, 'layers', scene.layer)?.weight, 1, 'and the inner write');
        log.dispose();
      },
    );

    r.it('patch records the changed top-level fields; keys, inserts and hard deletes carry none', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const log = recordBatches(store);
      store.transact({ label: 'Patch' }, (tx) => {
        tx.patch('controls', scene.controls[1], { name: 'Left Arm', order: 'a5' });
        tx.patch('keys', scene.keys[0], { v: 1 });
        tx.remove('keys', scene.keys[2]);
      });
      const batch = lastBatch(log.batches);
      equal(changeOf(batch, 'controls', scene.controls[1]).fields, ['name', 'order'], 'field-merge update fields');
      check(changeOf(batch, 'keys', scene.keys[0]).fields === undefined, 'record-merge update has no fields');
      const removed = changeOf(batch, 'keys', scene.keys[2]);
      check(removed.after === undefined && removed.fields === undefined, 'hard delete: after undefined, no fields');
      log.dispose();
    });

    r.it(
      'put over an existing field-merge record throws use-patch (strictPut) or records only the diffed fields',
      async () => {
        const store = factory();
        const scene = await seedScene(store);
        const log = recordBatches(store);
        const current = read(store, 'cameras', scene.camera);
        check(current !== undefined, 'camera exists');
        let strict = false;
        try {
          store.transact({ label: 'Put over' }, (tx) => tx.put('cameras', { ...current, name: 'renamed' }));
        } catch (error) {
          strict = (error as { code?: unknown }).code === 'use-patch';
          check(strict, `unexpected error ${String(error)}`);
        }
        if (strict) {
          equal(read(store, 'cameras', scene.camera), current, 'state unchanged after use-patch');
        } else {
          equal(changeOf(lastBatch(log.batches), 'cameras', scene.camera).fields, ['name'], 'diffed fields');
        }
        // Record-merge tables accept put over an existing record in every mode.
        const key = read(store, 'keys', scene.keys[0]);
        check(key !== undefined, 'key exists');
        store.transact({ label: 'Replace key' }, (tx) => tx.put('keys', { ...key, v: 2 }));
        equal(read(store, 'keys', scene.keys[0])?.v, 2, 'key replaced');
        log.dispose();
      },
    );

    r.it('a transaction without a net change emits no batch and records no undo entry', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const entry = store.undo.peekUndo();
      const log = recordBatches(store);
      store.transact({ label: 'Nothing' }, () => undefined);
      store.transact({ label: 'Back and forth' }, (tx) => {
        tx.patch('clips', scene.clip, { loop: true });
        tx.patch('clips', scene.clip, { loop: false });
      });
      equal(log.batches.length, 0, 'no batch');
      check(store.undo.peekUndo() === entry, 'no undo entry');
      log.dispose();
    });

    r.it('invalid records are rejected with invalid-record', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const key = read(store, 'keys', scene.keys[0]);
      check(key !== undefined, 'key exists');
      throwsCode(
        () =>
          store.transact({ label: 'Bad' }, (tx) =>
            tx.put('keys', { ...keyAt(scene, scene.curve, 3, 0), t: Number.NaN }),
          ),
        'invalid-record',
        'NaN key time',
      );
      throwsCode(
        () => store.transact({ label: 'Bad' }, (tx) => tx.patch('clips', scene.clip, { range: { start: 10, end: 5 } })),
        'invalid-record',
        'clip range start ≥ end',
      );
      throwsCode(
        () => store.transact({ label: 'Bad' }, (tx) => tx.patch('keys', 'k_missing000' as KeyId, { v: 1 })),
        'invalid-record',
        'patch of a missing record',
      );
      equal(read(store, 'keys', scene.keys[0]), key, 'nothing written');
    });

    r.it('soft delete hides from get, list and queries; restore brings the record back', async () => {
      const store = factory();
      const scene = await seedScene(store);
      store.transact({ label: 'Delete curve' }, (tx) => tx.softDelete('curves', scene.curve));
      equal(read(store, 'curves', scene.curve), undefined, 'get excludes soft-deleted');
      check(
        readRaw(store, 'curves', scene.curve)?.deleted?.by === store.user,
        'getIncludingDeleted keeps it, with a tombstone',
      );
      equal(store.list('curves'), [], 'list excludes it');
      equal(store.query.curvesOfClip(scene.clip), [], 'queries exclude it');
      equal(store.query.keysOfCurve(scene.curve), [], 'its keys are hidden with it');
      check(!(scene.curve in (store.snapshot().tables.curves ?? {})), 'snapshots omit soft-deleted records');
      store.transact({ label: 'Restore curve' }, (tx) => tx.restore('curves', scene.curve));
      equal(read(store, 'curves', scene.curve)?.deleted, null, 'restored');
      equal(store.query.keysOfCurve(scene.curve).length, 3, 'keys visible again');
    });

    r.it('remove: keys always; other records only without dependants', async () => {
      const store = factory();
      const scene = await seedScene(store);
      store.transact({ label: 'Remove key' }, (tx) => tx.remove('keys', scene.keys[0]));
      equal(read(store, 'keys', scene.keys[0]), undefined, 'key removed');
      throwsCode(
        () => store.transact({ label: 'Remove curve' }, (tx) => tx.remove('curves', scene.curve)),
        'invalid-record',
        'a curve with keys',
      );
      throwsCode(
        () => store.transact({ label: 'Remove control' }, (tx) => tx.remove('controls', scene.controls[0])),
        'invalid-record',
        'a control with children and curves',
      );
      store.transact({ label: 'Remove leaf' }, (tx) => tx.remove('cameras', scene.camera));
      equal(readRaw(store, 'cameras', scene.camera), undefined, 'a record without dependants is removed');
    });

    r.it('version increments on every emitted batch', async () => {
      const store = factory();
      const log = recordBatches(store);
      const scene = await seedScene(store);
      store.transact({ label: 'Edit' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('keys', scene.keys[0], { v: 3 }));
      preview.cancel();
      for (let i = 1; i < log.batches.length; i++) {
        equal(
          (log.batches[i] as ChangeBatch).version,
          (log.batches[i - 1] as ChangeBatch).version + 1,
          'consecutive versions',
        );
      }
      equal(lastBatch(log.batches).version, store.version, 'store version = last batch');
      log.dispose();
    });
  });

  r.describe('preview sessions', () => {
    r.it('update emits preview batches readers see; transact and beginPreview throw preview-active', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const log = recordBatches(store);
      const preview = store.beginPreview('Move keys');
      check(store.preview === preview && preview.active, 'store.preview is the session');
      preview.update((tx) => tx.patch('keys', scene.keys[1], { t: 12 }));
      const batch = lastBatch(log.batches);
      equal(batch.origin, 'preview', 'preview origin');
      equal(read(store, 'keys', scene.keys[1])?.t, 12, 'readers see the overlay');
      equal(
        store.query.keysOfCurve(scene.curve).map((k) => k.t),
        [0, 12, 20],
        'queries see the overlay',
      );
      throwsCode(() => store.transact({ label: 'X' }, () => undefined), 'preview-active', 'transact during a preview');
      throwsCode(() => store.beginPreview('Second'), 'preview-active', 'second preview');
      throwsCode(
        () => preview.update(() => store.transact({ label: 'Nested' }, () => undefined)),
        'preview-active',
        'transact inside preview.update',
      );
      preview.cancel();
      log.dispose();
    });

    r.it('update replaces the previous overlay; commit writes it as one local batch and one undo entry', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const committedKey = read(store, 'keys', scene.keys[1]);
      const log = recordBatches(store);
      const preview = store.beginPreview('Move keys');
      preview.update((tx) => {
        tx.patch('keys', scene.keys[1], { t: 12 });
        tx.patch('clips', scene.clip, { loop: true });
      });
      preview.update((tx) => tx.patch('keys', scene.keys[1], { t: 14 }));
      equal(read(store, 'clips', scene.clip)?.loop, false, 'the second update discarded the first overlay');
      equal(changeOf(lastBatch(log.batches), 'clips', scene.clip).after?.loop, false, 'preview batch restores it');
      const before = store.undo.peekUndo();
      const batch = preview.commit({ selectionAfter: 'after' });
      check(batch !== null && batch.origin === 'local', 'commit returns the local batch');
      equal(batch.label, 'Move keys', 'labelled with the preview label');
      equal(batch.changes.length, 1, 'only the net change');
      equal(changeOf(batch, 'keys', scene.keys[1]).before, committedKey, 'before = committed value');
      check(!preview.active && store.preview === null, 'the preview ended');
      const entry = store.undo.peekUndo();
      check(entry !== before && entry?.txId === batch.txId, 'one undo entry');
      equal(entry?.selectionAfter, 'after', 'selectionAfter from commit meta');
      store.undo.undo();
      equal(read(store, 'keys', scene.keys[1]), committedKey, 'one undo reverts the gesture');
      log.dispose();
    });

    r.it('commit with undoable: false enters no undo stack; an empty overlay commits to null', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const entry = store.undo.peekUndo();
      const camera = store.beginPreview('Orbit shot');
      camera.update((tx) => tx.patch('cameras', scene.camera, { target: [0, 1.5, 0] }));
      check(camera.commit({ undoable: false }) !== null, 'committed');
      equal(read(store, 'cameras', scene.camera)?.target, [0, 1.5, 0], 'written');
      check(store.undo.peekUndo() === entry, 'no undo entry');
      const empty = store.beginPreview('Nothing');
      empty.update(() => undefined);
      equal(empty.commit(), null, 'empty overlay → null');
      check(store.preview === null, 'ended');
    });

    r.it('cancel restores committed values with a preview batch and records no undo entry', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const before = docText(store);
      const entry = store.undo.peekUndo();
      const log = recordBatches(store);
      const preview = store.beginPreview('Drag');
      preview.update((tx) => {
        tx.patch('keys', scene.keys[0], { v: 9 });
        tx.put('keys', keyAt(scene, scene.curve, 30, 1));
      });
      preview.cancel();
      const batch = lastBatch(log.batches);
      equal(batch.origin, 'preview', 'cancel emits a preview batch');
      equal(changeOf(batch, 'keys', scene.keys[0]).after?.v, 0.5, 'restoring the committed value');
      equal(docText(store), before, 'document unchanged');
      equal(read(store, 'keys', scene.keys[0])?.v, 0.5, 'readers see committed values');
      check(store.undo.peekUndo() === entry, 'no undo entry');
      check(!preview.active && store.preview === null, 'ended');
      preview.cancel();
      log.dispose();
    });

    r.it('snapshot() reports committed state during a preview', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const before = docText(store);
      const preview = store.beginPreview('Drag');
      preview.update((tx) => {
        tx.patch('keys', scene.keys[0], { v: 9 });
        tx.remove('keys', scene.keys[2]);
      });
      equal(docText(store), before, 'committed snapshot');
      preview.cancel();
    });

    r.it(
      'applyChanges during a preview is allowed; changes to overlaid records are reported as conflicts',
      async () => {
        const store = factory();
        const scene = await seedScene(store);
        const preview = store.beginPreview('Drag');
        preview.update((tx) => tx.patch('keys', scene.keys[0], { t: 2 }));
        equal(preview.conflicts, [], 'no conflicts yet');
        const key0 = readRaw(store, 'keys', scene.keys[0]);
        check(key0 !== undefined, 'key exists');
        const remoteKey = { ...key0, t: 0, v: 7 };
        external(store, { table: 'keys', id: scene.keys[0], after: remoteKey });
        external(store, {
          table: 'clips',
          id: scene.clip,
          after: { ...read(store, 'clips', scene.clip), loop: true } as never,
        });
        equal(read(store, 'clips', scene.clip)?.loop, true, 'a change outside the overlay is visible at once');
        equal(read(store, 'keys', scene.keys[0])?.t, 2, 'the overlay still shows the drag');
        equal(
          preview.conflicts.map((c) => c.id),
          [scene.keys[0]],
          'the overlaid key is a conflict',
        );
        preview.cancel();
        equal(read(store, 'keys', scene.keys[0]), remoteKey, 'cancel shows the external value');
      },
    );
  });

  r.describe('undo and redo', () => {
    r.it('undo/redo revert and re-apply exactly, with labels and selection snapshots', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const seeded = docText(store);
      store.transact({ label: 'Set Key', selectionBefore: ['a'], selectionAfter: ['b'] }, (tx) => {
        tx.put('keys', keyAt(scene, scene.curve, 30, 1));
        tx.patch('controls', scene.controls[1], { name: 'Renamed' });
      });
      const edited = docText(store);
      equal(store.undo.peekUndo()?.label, 'Set Key', 'peekUndo');
      const undone = store.undo.undo();
      equal(undone?.label, 'Set Key', 'undo label');
      equal(undone?.selection, ['a'], 'undo restores selectionBefore');
      equal(undone?.skipped, [], 'nothing skipped');
      equal(docText(store), seeded, 'undo restores the document exactly');
      check(store.undo.canRedo() && store.undo.peekRedo()?.label === 'Set Key', 'redo available');
      const redone = store.undo.redo();
      equal(redone?.selection, ['b'], 'redo restores selectionAfter');
      equal(docText(store), edited, 'redo re-applies exactly');
      store.undo.undo();
      store.undo.undo();
      check(!store.undo.canUndo(), 'stack exhausted');
      equal(store.undo.undo(), null, 'undo on an empty stack returns null');
    });

    r.it('only local undoable batches enter the stack; a new local change clears redo', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const seedEntry = store.undo.peekUndo();
      external(store, {
        table: 'clips',
        id: scene.clip,
        after: { ...read(store, 'clips', scene.clip), loop: true } as never,
      });
      store.applyChanges(
        [
          {
            table: 'keys',
            id: scene.keys[0],
            before: undefined,
            after: { ...read(store, 'keys', scene.keys[0]), v: 3 },
          } as AnyChange,
        ],
        {
          origin: 'import',
          label: 'Import',
        },
      );
      store.transact({ label: 'Not undoable', undoable: false }, (tx) =>
        tx.patch('layers', scene.layer, { mute: true }),
      );
      check(store.undo.peekUndo() === seedEntry, 'remote, import and undoable:false batches are not recorded');
      store.transact({ label: 'A' }, (tx) => tx.patch('layers', scene.layer, { weight: 0.3 }));
      const log = recordBatches(store);
      store.undo.undo();
      equal(lastBatch(log.batches).origin, 'undo', 'undo batches have origin undo');
      store.undo.redo();
      equal(lastBatch(log.batches).origin, 'redo', 'redo batches have origin redo');
      store.undo.undo();
      check(store.undo.canRedo(), 'redo available');
      store.transact({ label: 'B' }, (tx) => tx.patch('layers', scene.layer, { weight: 0.4 }));
      check(!store.undo.canRedo(), 'a new local change clears redo');
      equal(store.undo.peekUndo()?.label, 'B', 'B on top');
      store.undo.undo();
      equal(store.undo.peekUndo()?.txId, seedEntry?.txId, 'undo/redo never create entries');
      log.dispose();
    });

    r.it('coalescing: the same coalesceKey within coalesceMs merges; stopCapturing and other keys split', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const nudge = (v: number, key = 'nudge'): void =>
        store.transact({ label: 'Nudge', coalesceKey: key, coalesceMs: 3_600_000 }, (tx) =>
          tx.patch('keys', scene.keys[0], { v }),
        );
      nudge(1);
      const first = store.undo.peekUndo();
      nudge(2);
      nudge(3);
      equal(store.undo.peekUndo()?.txId, first?.txId, 'merged into the first entry (same txId)');
      store.undo.stopCapturing();
      nudge(4);
      check(store.undo.peekUndo()?.txId !== first?.txId, 'stopCapturing starts a new entry');
      nudge(5, 'other');
      const other = store.undo.peekUndo();
      nudge(6);
      check(store.undo.peekUndo()?.txId !== other?.txId, 'a different key starts a new entry');
      store.transact({ label: 'No window', coalesceKey: 'nudge' }, (tx) => tx.patch('keys', scene.keys[0], { v: 7 }));
      store.transact({ label: 'No window', coalesceKey: 'nudge' }, (tx) => tx.patch('keys', scene.keys[0], { v: 8 }));
      const tops: string[] = [];
      while (store.undo.canUndo() && read(store, 'keys', scene.keys[0])?.v !== 0.5) {
        tops.push(store.undo.undo()?.label ?? '');
      }
      equal(read(store, 'keys', scene.keys[0])?.v, 0.5, 'all nudges undone');
      equal(tops.length, 6, 'entries: 8, 7, 6, 5, 4, merged 1–3 (coalesceMs defaults to 0)');
    });

    r.it('coalesced edits that cancel out leave no entry; external batches break coalescing', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const seedEntry = store.undo.peekUndo();
      const nudge = (v: number): void =>
        store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 3_600_000 }, (tx) =>
          tx.patch('keys', scene.keys[0], { v }),
        );
      nudge(1);
      nudge(0.5);
      check(store.undo.peekUndo()?.txId === seedEntry?.txId, 'a nudge and its reverse leave nothing to undo');
      nudge(1);
      const first = store.undo.peekUndo();
      external(store, {
        table: 'layers',
        id: scene.layer,
        after: { ...read(store, 'layers', scene.layer), mute: true } as never,
      });
      nudge(2);
      check(store.undo.peekUndo()?.txId !== first?.txId, 'an external batch in between starts a new entry');
    });

    r.it('the stack keeps at most `limit` entries (default 500)', async () => {
      const store = factory();
      const scene = await seedScene(store);
      equal(store.undo.limit, 500, 'default limit');
      for (let i = 0; i < 505; i++)
        store.transact({ label: `Edit ${i}` }, (tx) => tx.patch('keys', scene.keys[0], { v: i }));
      let undone = 0;
      while (store.undo.undo() !== null) undone++;
      equal(undone, 500, 'undo count');
      equal(read(store, 'keys', scene.keys[0])?.v, 4, 'the oldest entries were dropped');
    });

    r.it('keys merge as whole records: a key changed by another writer is skipped, not overwritten', async () => {
      const store = factory();
      const scene = await seedScene(store);
      store.transact({ label: 'Edit key' }, (tx) => tx.patch('keys', scene.keys[0], { v: 1 }));
      const theirs = { ...read(store, 'keys', scene.keys[0]), inType: 'linear' } as KeyRecord;
      external(store, { table: 'keys', id: scene.keys[0], after: theirs });
      const result = store.undo.undo();
      equal(result?.applied, 0, 'nothing applied');
      equal(
        result?.skipped.map((s) => [s.change.id, s.fields, s.reason]),
        [[scene.keys[0], null, 'changed-by-other']],
        'skip report',
      );
      equal(read(store, 'keys', scene.keys[0]), theirs, 'the other writer’s key is kept');
      const redo = store.undo.redo();
      equal(redo?.skipped.length, 1, 'redo is symmetric: skipped too');
      equal(read(store, 'keys', scene.keys[0]), theirs, 'still theirs');
    });

    r.it(
      'field-merge records undo per field: another field does not block undo, the same field is skipped',
      async () => {
        const store = factory();
        const scene = await seedScene(store);
        const control = scene.controls[1];
        store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', control, { name: 'Mine', order: 'a3' }));
        external(store, {
          table: 'controls',
          id: control,
          after: { ...read(store, 'controls', control), hiddenByDefault: true } as ControlRecord,
        });
        const first = store.undo.undo();
        equal(first?.skipped, [], 'a concurrent edit of another field does not block undo');
        equal(read(store, 'controls', control)?.name, 'arm.L', 'name reverted');
        equal(read(store, 'controls', control)?.hiddenByDefault, true, 'their field kept');
        store.undo.redo();
        equal(read(store, 'controls', control)?.name, 'Mine', 'redo');
        external(store, {
          table: 'controls',
          id: control,
          after: { ...read(store, 'controls', control), name: 'Theirs' } as ControlRecord,
        });
        const second = store.undo.undo();
        equal(second?.applied, 1, 'the order field is still reverted');
        equal(
          second?.skipped.map((s) => [s.fields, s.reason]),
          [[['name'], 'changed-by-other']],
          'name skipped and reported',
        );
        equal(read(store, 'controls', control)?.name, 'Theirs', 'their name kept');
        equal(read(store, 'controls', control)?.order, 'a0', 'order reverted');
      },
    );

    r.it('inserts, hard deletes and soft deletes undo and redo as whole records', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const seeded = docText(store);
      const extra = keyAt(scene, scene.curve, 30, 1);
      store.transact({ label: 'Insert' }, (tx) => tx.put('keys', extra));
      store.transact({ label: 'Delete' }, (tx) => tx.remove('keys', scene.keys[0]));
      store.transact({ label: 'Soft delete' }, (tx) => tx.softDelete('controls', scene.controls[2]));
      const edited = docText(store);
      store.undo.undo();
      equal(read(store, 'controls', scene.controls[2])?.deleted, null, 'soft delete undone');
      store.undo.undo();
      check(read(store, 'keys', scene.keys[0]) !== undefined, 'hard delete undone');
      store.undo.undo();
      equal(read(store, 'keys', extra.id), undefined, 'insert undone');
      equal(docText(store), seeded, 'seeded state');
      store.undo.redo();
      store.undo.redo();
      store.undo.redo();
      equal(docText(store), edited, 'redo all');
      // Redo of an insert is skipped when someone else re-created the record meanwhile.
      store.undo.undo();
      store.undo.undo();
      store.undo.undo();
      external(store, { table: 'keys', id: extra.id, after: { ...extra, v: 42 } });
      const redo = store.undo.redo();
      equal(
        redo?.skipped.map((s) => s.reason),
        ['changed-by-other'],
        'insert redo skipped: the record exists',
      );
      equal(read(store, 'keys', extra.id)?.v, 42, 'theirs kept');
    });

    r.it('undo never hard-deletes a record that a record outside the entry still references', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const control = scene.controls[1];
      const curve = curveOf(scene, control, 'ry');
      store.transact({ label: 'New curve' }, (tx) => tx.put('curves', curve));
      // Another writer keys into the new curve: undoing its creation must not orphan their key.
      const theirs = keyAt(scene, curve.id, 4, 0.5);
      external(store, { table: 'keys', id: theirs.id, after: theirs });
      const result = store.undo.undo();
      equal(
        result?.skipped.map((s) => [s.change.table, s.change.id, s.fields, s.reason]),
        [['curves', curve.id, null, 'changed-by-other']],
        'the curve delete is skipped and reported',
      );
      check(read(store, 'curves', curve.id) !== undefined, 'the curve stays');
      equal(
        store.query.keysOfCurve(curve.id).map((k) => k.id),
        [theirs.id],
        'their key keeps its curve',
      );
      // A plan that removes the reference in the same step may delete: undoing "move the curve to a new control"
      // re-points the curve before deleting the control.
      const moved = keyAt(scene, scene.curve, 33, 0.1);
      store.transact({ label: 'Key' }, (tx) => tx.put('keys', moved));
      const extra = { ...read(store, 'controls', control), id: `${scene.rig}:extra`, key: 'extra' } as ControlRecord;
      store.transact({ label: 'Retarget' }, (tx) => {
        tx.put('controls', extra);
        tx.patch('curves', curve.id, { control: extra.id });
      });
      const retarget = store.undo.undo();
      equal(retarget?.skipped, [], 'nothing outside the entry references the new control');
      equal(read(store, 'controls', extra.id), undefined, 'the control is deleted');
      equal(read(store, 'curves', curve.id)?.control, control, 'after the curve was re-pointed');
      // Skipping one delete keeps its own references alive: the layer and clip under a kept curve stay too.
      const clip = newScene(scene.seed + 500);
      store.transact({ label: 'New clip' }, (tx) => {
        tx.put('clips', { ...(read(store, 'clips', scene.clip) as ClipRecord), id: clip.clip, order: 'b0' });
        tx.put('layers', { ...(read(store, 'layers', scene.layer) as LayerRecord), id: clip.layer, clip: clip.clip });
        tx.put('curves', { ...curve, id: clip.curve, clip: clip.clip, layer: clip.layer });
      });
      const late = keyAt(scene, clip.curve, 1, 1);
      external(store, { table: 'keys', id: late.id, after: { ...late, clip: clip.clip } });
      const cascade = store.undo.undo();
      equal(
        cascade?.skipped.map((s) => s.change.table).sort(compareStrings),
        ['clips', 'curves', 'layers'],
        'the whole chain is kept',
      );
      checkProjections(store, 'after skipped deletes');
    });

    r.it('changes in closed partitions are skipped with missing-partition', async () => {
      const store = factory();
      const scene = await seedScene(store);
      store.transact({ label: 'Edit' }, (tx) => {
        tx.patch('keys', scene.keys[0], { v: 1 });
        tx.patch('cameras', scene.camera, { locked: true });
      });
      store.close(`clip:${scene.clip}`);
      const result = store.undo.undo();
      equal(
        result?.skipped.map((s) => [s.change.table, s.reason]),
        [['keys', 'missing-partition']],
        'key skipped',
      );
      equal(read(store, 'cameras', scene.camera)?.locked, false, 'scene change reverted');
      await store.open(`clip:${scene.clip}`);
      equal(read(store, 'keys', scene.keys[0])?.v, 1, 'the clip change was not reverted');
    });

    r.it('undo and redo refuse to run during a preview', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const preview = store.beginPreview('Drag');
      preview.update((tx) => tx.patch('keys', scene.keys[0], { v: 2 }));
      throwsCode(() => store.undo.undo(), 'preview-active', 'undo during a preview');
      preview.cancel();
      check(store.undo.undo() !== null, 'works after the preview');
    });

    r.it('subscribers of the undo manager hear every stack change', async () => {
      const store = factory();
      const scene = await seedScene(store);
      let calls = 0;
      const dispose = store.undo.subscribe(() => calls++);
      store.transact({ label: 'Edit' }, (tx) => tx.patch('keys', scene.keys[0], { v: 1 }));
      store.undo.undo();
      store.undo.redo();
      store.undo.clear();
      dispose();
      check(calls >= 4, `expected ≥ 4 notifications, got ${calls}`);
      check(!store.undo.canUndo() && !store.undo.canRedo(), 'clear empties both stacks');
    });
  });

  r.describe('partitions', () => {
    r.it('reads of unopened partitions are absent; close and open toggle visibility without losing data', async () => {
      const store = factory();
      const scene = await seedScene(store);
      equal([...store.openPartitions()], [...scene.partitions].sort(compareStrings), 'openPartitions');
      const text = docText(store);
      store.close(`char:${scene.character}`);
      check(!store.isOpen(`char:${scene.character}`), 'closed');
      equal(read(store, 'rigs', scene.rig), undefined, 'rig hidden');
      equal(read(store, 'controls', scene.controls[0]), undefined, 'controls hidden (rig-scoped)');
      equal(read(store, 'clips', scene.clip), undefined, 'clip metadata lives in the character partition');
      equal(store.query.controlsOfRig(scene.rig), [], 'queries hide it');
      check(read(store, 'curves', scene.curve) !== undefined, 'clip partition still open');
      check(read(store, 'characters', scene.character) !== undefined, 'scene partition still open');
      check(!(scene.rig in (store.snapshot().tables.rigs ?? {})), 'snapshots cover open partitions only');
      store.close(`clip:${scene.clip}`);
      equal(store.query.keysOfCurve(scene.curve), [], 'clip partition hidden');
      equal(read(store, 'layers', scene.layer), undefined, 'layers hidden');
      await store.open(`char:${scene.character}`);
      await store.open(`clip:${scene.clip}`);
      await store.open(`clip:${scene.clip}`);
      equal(docText(store), text, 'reopening restores everything (open is idempotent)');
    });

    r.it('missingPartitions lists partitions referenced by open records that are not open', async () => {
      const store = factory();
      const scene = await seedScene(store);
      equal(store.query.missingPartitions(), [], 'everything open');
      store.close(`clip:${scene.clip}`);
      equal(store.query.missingPartitions(), [`clip:${scene.clip}`], 'clip partition missing');
      store.close(`char:${scene.character}`);
      equal(
        store.query.missingPartitions(),
        [`char:${scene.character}`],
        'the clip record is hidden with its character',
      );
    });

    r.it('a new character or clip opens the partition it owns, even before anything is written there', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const clip = newScene(scene.seed + 1).clip;
      store.transact({ label: 'Empty clip' }, (tx) =>
        tx.put('clips', { ...(read(store, 'clips', scene.clip) as ClipRecord), id: clip, order: 'b0' }),
      );
      check(store.isOpen(`clip:${clip}`), 'the clip partition is open');
      equal(store.query.missingPartitions(), [], 'nothing missing');
      const reloaded = factory();
      reloaded.load(store.snapshot());
      check(reloaded.isOpen(`clip:${clip}`), 'load opens the partitions of every character and clip');
      equal(reloaded.query.missingPartitions(), [], 'nothing missing after load');
    });

    r.it('writes into a partition that is not open yet open it (new characters and clips)', async () => {
      const store = factory();
      await store.open('scene');
      const scene = newScene(7);
      store.transact({ label: 'Create' }, (tx) => writeScene(tx, scene));
      for (const partition of scene.partitions) check(store.isOpen(partition), `${partition} opened by the write`);
      check(read(store, 'keys', scene.keys[0]) !== undefined, 'read-your-writes across partitions');
    });

    r.it('a batch applied partition by partition in random order keeps projections valid', async () => {
      const source = factory();
      const log = recordBatches(source);
      const scene = await seedScene(source, 11);
      source.transact({ label: 'More' }, (tx) => {
        tx.put('curves', curveOf(scene, scene.controls[1], 'rx'));
        tx.put('keys', keyAt(scene, scene.curve, 5, 0.1));
      });
      const changes = log.batches.filter((b) => b.origin === 'local').flatMap((b) => b.changes);
      log.dispose();
      const rigCharacter = new Map<string, string>();
      for (const change of changes) {
        if (change.table === 'rigs' && change.after !== undefined) rigCharacter.set(change.id, change.after.character);
      }
      const groups = new Map<Partition, AnyChange[]>();
      for (const change of changes) {
        const partition = partitionOfChange(change, rigCharacter);
        groups.set(partition, [...(groups.get(partition) ?? []), change]);
      }
      for (let seed = 1; seed <= 8; seed++) {
        const target = factory();
        for (const partition of scene.partitions) await target.open(partition);
        const order = new Rng(seed).shuffle([...groups.keys()]);
        for (const partition of order) {
          target.applyChanges(groups.get(partition) ?? [], { origin: 'remote', label: `Partition ${partition}` });
          checkProjections(target, `after ${partition} (seed ${seed})`);
        }
        equal(docText(target), docText(source), `converged (seed ${seed})`);
      }
    });
  });

  r.describe('snapshots and load', () => {
    r.it('snapshots are deterministic: equal content serializes to identical bytes', async () => {
      const a = factory();
      const b = factory();
      const scene = newScene(5);
      for (const partition of scene.partitions) {
        await a.open(partition);
        await b.open(partition);
      }
      a.transact({ label: 'All at once' }, (tx) => writeScene(tx, scene));
      // b writes the same content in another order and through intermediate values.
      b.transact({ label: 'Keys first' }, (tx) => {
        writeScene(tx, scene);
        tx.patch('clips', scene.clip, { loop: true });
      });
      b.transact({ label: 'Back' }, (tx) => tx.patch('clips', scene.clip, { loop: false }));
      equal(docText(b), docText(a), 'byte-identical serialization');
      equal(docText(a), docText(a), 'stable across calls');
    });

    r.it('load replaces content, clears undo and emits a load batch; snapshot(load(s)) equals s', async () => {
      const source = factory();
      const scene = await seedScene(source);
      source.transact({ label: 'Soft delete' }, (tx) => tx.softDelete('controls', scene.controls[2]));
      const snapshot = source.snapshot();
      const target = factory();
      const other = await seedScene(target, 99);
      const log = recordBatches(target);
      target.load(snapshot);
      equal(lastBatch(log.batches).origin, 'load', 'load batch');
      check(!target.undo.canUndo() && !target.undo.canRedo(), 'undo cleared');
      equal(read(target, 'characters', other.character), undefined, 'previous content replaced');
      equal(target.snapshot(), snapshot, 'round trip');
      for (const partition of scene.partitions) check(target.isOpen(partition), `${partition} open after load`);
      check(!target.readOnly, 'writable');
      log.dispose();
    });

    r.it('unknown tables and unknown fields survive load → snapshot and stay transactable', async () => {
      const source = factory();
      const scene = await seedScene(source);
      const base = source.snapshot();
      const tables = base.tables as unknown as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      const withExtras: DocSnapshot = {
        ...base,
        tableVersions: { ...base.tableVersions, 'acme.notes': 3 },
        tables: {
          ...tables,
          'acme.notes': { n1: { id: 'n1', text: 'hello', nested: { deep: [1, 2] } } },
          clips: { [scene.clip]: { ...(tables['clips']?.[scene.clip] as object), futureField: { kept: true } } },
        } as unknown as DocSnapshot['tables'],
      };
      const store = factory();
      store.load(withExtras);
      equal(store.snapshot(), withExtras, 'preserved verbatim, with their table versions');
      store.transact({ label: 'Edit opaque' }, (tx) => {
        tx.patch('acme.notes' as 'clips', 'n1' as never, { text: 'edited' } as never);
        tx.patch('clips', scene.clip, { loop: true });
      });
      const notes = (store.snapshot().tables as unknown as Record<string, Record<string, { text?: string }>>)[
        'acme.notes'
      ];
      equal(notes?.['n1']?.text, 'edited', 'opaque tables are transactable');
      equal(
        (read(store, 'clips', scene.clip) as unknown as { futureField?: unknown }).futureField,
        { kept: true },
        'unknown field kept by patch',
      );
      store.undo.undo();
      equal(store.snapshot(), withExtras, 'and undoable');
    });

    r.it('a newer minWriterVersion or opts.readOnly loads read-only', async () => {
      const source = factory();
      await seedScene(source);
      const snapshot = source.snapshot();
      const newer = factory();
      newer.load({ ...snapshot, minWriterVersion: SCHEMA_VERSION + 1 });
      check(newer.readOnly, 'read-only');
      throwsCode(() => newer.transact({ label: 'X' }, () => undefined), 'read-only', 'transact');
      throwsCode(() => newer.beginPreview('X'), 'read-only', 'beginPreview');
      equal(newer.snapshot().minWriterVersion, SCHEMA_VERSION + 1, 'minWriterVersion preserved');
      const explicit = factory();
      explicit.load(snapshot, { readOnly: true });
      check(explicit.readOnly, 'opts.readOnly');
      const writable = factory();
      writable.load(snapshot);
      check(!writable.readOnly, 'writable otherwise');
    });

    r.it('migrated snapshots load and round-trip (v1 baseline)', async () => {
      const source = factory();
      await seedScene(source);
      const snapshot = source.snapshot();
      const parsed = JSON.parse(JSON.stringify(snapshot)) as unknown;
      const migrated = migrateSnapshot(parsed);
      equal(migrated.migratedFrom, SCHEMA_VERSION, 'migratedFrom');
      check(!migrated.readOnly, 'writable');
      const store = factory();
      store.load(migrated.snapshot);
      equal(docText(store), docText(source), 'loads to the same document');
      equal(store.snapshot().tableVersions, snapshot.tableVersions, 'table versions');
    });
  });

  r.describe('queries and projection', () => {
    r.it('duplicate key times: the greatest KeyId wins, the others are reported by hiddenKeys', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const low = 'k_000000000000' as KeyId;
      const high = 'k_zzzzzzzzzzzz' as KeyId;
      store.applyChanges(
        [
          { table: 'keys', id: low, before: undefined, after: keyAt(scene, scene.curve, 10, 1, low) },
          { table: 'keys', id: high, before: undefined, after: keyAt(scene, scene.curve, 10, 2, high) },
        ] as AnyChange[],
        REMOTE,
      );
      const keys = store.query.keysOfCurve(scene.curve);
      equal(
        keys.map((k) => k.t),
        [0, 10, 20],
        'unique times',
      );
      equal(keys[1]?.id, high, 'greatest KeyId wins');
      equal(
        store.query
          .hiddenKeys(scene.curve)
          .map((k) => k.id)
          .sort(compareStrings),
        [low, scene.keys[1]].sort(compareStrings),
        'losers are hidden',
      );
      checkProjections(store, 'duplicate keys');
    });

    r.it('duplicate curves: the smallest CurveId is canonical and their keys are unioned', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const duplicate = curveOf(scene, scene.controls[0], 'rz', 'crv_0000000000000000' as never);
      store.applyChanges(
        [
          { table: 'curves', id: duplicate.id, before: undefined, after: duplicate },
          {
            table: 'keys',
            id: 'k_dup000000001',
            before: undefined,
            after: keyAt(scene, duplicate.id, 15, 3, 'k_dup000000001' as KeyId),
          },
        ] as AnyChange[],
        REMOTE,
      );
      const canonical = store.query.curveFor(scene.clip, scene.layer, scene.controls[0], 'rz');
      equal(canonical?.id, duplicate.id, 'smallest CurveId');
      equal(
        store.query.curvesOfClip(scene.clip).map((c) => c.id),
        [duplicate.id],
        'one canonical curve per channel',
      );
      equal(
        store.query.curvesOfControl(scene.clip, scene.controls[0]).map((c) => c.id),
        [duplicate.id],
        'curvesOfControl',
      );
      equal(
        store.query.keysOfCurve(duplicate.id).map((k) => k.t),
        [0, 10, 15, 20],
        'keys unioned',
      );
      equal(store.query.keysOfCurve(scene.curve), [], 'a non-canonical duplicate has no keys of its own');
      checkProjections(store, 'duplicate curves');
    });

    r.it('controlsOfRig: parents before children, siblings by order, cycles broken at the smallest id', async () => {
      const store = factory();
      const scene = await seedScene(store);
      const [root, left, right] = scene.controls;
      equal(
        store.query.controlsOfRig(scene.rig).map((c) => c.id),
        [root, left, right],
        'tree order',
      );
      store.transact({ label: 'Reorder' }, (tx) => tx.patch('controls', right, { order: 'Zz' }));
      equal(
        store.query.controlsOfRig(scene.rig).map((c) => c.id),
        [root, right, left],
        'siblings by order',
      );
      // A cycle (possible after concurrent reparenting): left → right → left.
      store.applyChanges(
        [
          {
            table: 'controls',
            id: left,
            before: undefined,
            after: { ...read(store, 'controls', left), parent: right },
          },
          {
            table: 'controls',
            id: right,
            before: undefined,
            after: { ...read(store, 'controls', right), parent: left },
          },
        ] as AnyChange[],
        REMOTE,
      );
      const ordered = store.query.controlsOfRig(scene.rig).map((c) => c.id);
      const detached = [left, right].sort(compareStrings)[0] as ControlId;
      const other = detached === left ? right : left;
      const roots = [read(store, 'controls', root), read(store, 'controls', detached)] as ControlRecord[];
      roots.sort((a, b) => compareStrings(a.order, b.order) || compareStrings(a.id, b.id));
      const expected = roots.flatMap((control) => (control.id === detached ? [detached, other] : [root]));
      equal(ordered, expected, 'the smallest id of the cycle is detached as a root');
      checkProjections(store, 'cycle');
    });

    r.it('layers, clips, rigs and template keys', async () => {
      const store = factory();
      const scene = await seedScene(store);
      equal(store.query.baseLayer(scene.clip)?.id, scene.layer, 'baseLayer');
      equal(
        store.query.layersOfClip(scene.clip).map((l) => l.id),
        [scene.layer],
        'layersOfClip',
      );
      equal(
        store.query.clipsOfCharacter(scene.character).map((c) => c.id),
        [scene.clip],
        'clipsOfCharacter',
      );
      equal(store.query.rigOfCharacter(scene.character)?.id, scene.rig, 'rigOfCharacter');
      equal(store.query.controlByKey(scene.rig, 'arm.L')?.id, scene.controls[1], 'controlByKey');
      equal(store.query.controlByKey(scene.rig, 'missing'), undefined, 'controlByKey miss');
      const upper = {
        ...read(store, 'layers', scene.layer),
        id: newId('layer', scene.ids),
        name: 'Upper',
        order: 'a5',
      };
      store.transact({ label: 'Layer' }, (tx) => tx.put('layers', upper as never));
      equal(
        store.query.layersOfClip(scene.clip).map((l) => l.name),
        ['Base', 'Upper'],
        'layers by order',
      );
      equal(store.query.baseLayer(scene.clip)?.id, scene.layer, 'base = lowest order');
    });

    r.it('query results match a brute-force projection after random edits', async () => {
      for (let seed = 1; seed <= 12; seed++) {
        const store = factory();
        const scene = await seedScene(store, seed);
        const rng = new Rng(seed);
        const curves = [scene.curve as string];
        for (let step = 0; step < 40; step++) {
          store.transact({ label: `Random ${step}` }, (tx) => {
            const roll = rng.int(6);
            if (roll === 0) {
              const curve = curveOf(scene, rng.pick(scene.controls), rng.pick(['rx', 'rz'] as const));
              tx.put('curves', curve);
              curves.push(curve.id);
            } else if (roll === 1) {
              const keys = tx.list('keys');
              if (keys.length > 0) tx.remove('keys', rng.pick(keys).id);
            } else if (roll === 2) {
              const curve = tx.get('curves', rng.pick(curves) as never);
              if (curve !== undefined) tx.softDelete('curves', curve.id);
            } else {
              const curve = rng.pick(curves);
              if (tx.getIncludingDeleted('curves', curve as never) !== undefined) {
                tx.put(
                  'keys',
                  makeKey({
                    id: newId('key', scene.ids),
                    clip: scene.clip,
                    curve: curve as never,
                    t: rng.int(8) * 5,
                    v: rng.next(),
                  }),
                );
              }
            }
          });
          equalsBruteForce(store, scene, `seed ${seed} step ${step}`);
        }
      }
    });
  });

  r.describe('property: undo-all', () => {
    r.it('random edit sequences then undo-all restore the initial snapshot', async () => {
      for (let seed = 1; seed <= 15; seed++) {
        const store = factory();
        const scene = await seedScene(store, seed);
        store.undo.clear();
        const initial = docText(store);
        const rng = new Rng(seed * 7919);
        const steps = 5 + rng.int(25);
        for (let step = 0; step < steps; step++) randomLocalEdit(store, scene, rng, step);
        while (store.undo.undo() !== null) {
          // keep undoing
        }
        equal(docText(store), initial, `seed ${seed}: undo-all restores the initial snapshot`);
        while (store.undo.redo() !== null) {
          // keep redoing
        }
        checkProjections(store, `seed ${seed} after redo-all`);
      }
    });
  });
}

/** A random local edit through the public API (transactions, previews, coalesced nudges). */
export function randomLocalEdit(store: DocumentStore, scene: Scene, rng: Rng, step: number): void {
  const keys = store.list('keys');
  const roll = rng.int(9);
  if (roll === 0) {
    store.transact({ label: 'Insert key' }, (tx) => tx.put('keys', keyAt(scene, scene.curve, 30 + step, rng.next())));
  } else if (roll === 1 && keys.length > 0) {
    store.transact({ label: 'Delete key' }, (tx) => tx.remove('keys', rng.pick(keys).id));
  } else if (roll === 2 && keys.length > 0) {
    const key = rng.pick(keys);
    store.transact({ label: 'Nudge', coalesceKey: 'nudge', coalesceMs: 3_600_000 }, (tx) =>
      tx.patch('keys', key.id, { v: key.v + 0.1 }),
    );
  } else if (roll === 3) {
    store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', rng.pick(scene.controls), { name: `n${step}` }));
  } else if (roll === 4) {
    const curve = store.getIncludingDeleted('curves', scene.curve);
    if (curve !== undefined) {
      store.transact({ label: 'Toggle curve' }, (tx) =>
        curve.deleted === null ? tx.softDelete('curves', curve.id) : tx.restore('curves', curve.id),
      );
    }
  } else if (roll === 5 && keys.length > 0) {
    const key = rng.pick(keys);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', key.id, { t: key.t + 0.5 }));
    preview.update((tx) => tx.patch('keys', key.id, { t: key.t + 1.5 }));
    if (rng.bool()) preview.commit();
    else preview.cancel();
  } else if (roll === 6) {
    store.transact({ label: 'Clip' }, (tx) => tx.patch('clips', scene.clip, { loop: rng.bool(), sceneStart: step }));
  } else if (roll === 7 && store.undo.canUndo()) {
    store.undo.undo();
  } else if (roll === 8 && store.undo.canRedo()) {
    store.undo.redo();
  } else {
    store.transact({ label: 'Layer' }, (tx) => tx.patch('layers', scene.layer, { weight: rng.next() }));
  }
}

function partitionOfChange(change: AnyChange, rigCharacter: ReadonlyMap<string, string>): Partition {
  const record = (change.after ?? change.before) as unknown as Readonly<Record<string, unknown>>;
  switch (change.table) {
    case 'rigs':
    case 'clips':
      return `char:${String(record['character'])}`;
    case 'controls':
    case 'constraints':
    case 'solvers':
      return `char:${rigCharacter.get(String(record['rig'])) ?? ''}`;
    case 'layers':
    case 'curves':
    case 'keys':
      return `clip:${String(record['clip'])}`;
    case 'project':
    case 'assets':
    case 'characters':
    case 'cameras':
      return 'scene';
  }
}

/** Recomputes key and curve projections from `list()` and compares them with the indexed queries. */
function equalsBruteForce(store: DocumentStore, scene: Scene, label: string): void {
  const curves = store.list('curves').filter((curve) => curve.clip === scene.clip);
  const groups = new Map<string, CurveRecord[]>();
  for (const curve of curves) {
    const key = `${curve.layer}/${curve.control}/${curve.channel}`;
    groups.set(key, [...(groups.get(key) ?? []), curve]);
  }
  const canonical: CurveRecord[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => compareStrings(a.id, b.id));
    const winner = members[0] as CurveRecord;
    canonical.push(winner);
    const ids = new Set(members.map((m) => m.id));
    const keys = store
      .list('keys')
      .filter((key) => ids.has(key.curve))
      .sort((a, b) => a.t - b.t || compareStrings(b.id, a.id));
    const visible = keys.filter((key, i) => i === 0 || (keys[i - 1] as KeyRecord).t !== key.t);
    const hidden = keys.filter((key) => !visible.includes(key));
    equal(
      store.query.keysOfCurve(winner.id).map((k) => k.id),
      visible.map((k) => k.id),
      `${label}: keysOfCurve`,
    );
    equal(
      store.query
        .hiddenKeys(winner.id)
        .map((k) => k.id)
        .sort(compareStrings),
      hidden.map((k) => k.id).sort(compareStrings),
      `${label}: hiddenKeys`,
    );
    for (const member of members.slice(1)) equal(store.query.keysOfCurve(member.id), [], `${label}: non-canonical`);
  }
  equal(
    store.query.curvesOfClip(scene.clip).map((c) => c.id),
    canonical.map((c) => c.id).sort(compareStrings),
    `${label}: curvesOfClip`,
  );
  check(deepEqual(store.query.curvesOfClip(scene.clip), store.query.curvesOfClip(scene.clip)), 'stable');
}
