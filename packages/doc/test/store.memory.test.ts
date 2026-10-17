import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnyChange,
  type ChangeBatch,
  type CommittedChange,
  createMemoryStore,
  EkzaError,
  MemoryDocumentStore,
  type Tx,
  type UserId,
} from '../src';
import { makeTestControl, newScene, seedScene, writeScene } from '../src/testing';

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof EkzaError ? error.code : `non-EkzaError: ${String(error)}`;
  }
}

function recorder(store: { subscribe(listener: (batch: ChangeBatch) => void): () => void }): ChangeBatch[] {
  const batches: ChangeBatch[] = [];
  store.subscribe((batch) => batches.push(batch));
  return batches;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMemoryStore options', () => {
  it('strictPut defaults to true; false records the diffed fields of a put over an existing record', async () => {
    const strict = createMemoryStore();
    const scene = await seedScene(strict);
    const camera = strict.get('cameras', scene.camera);
    expect(code(() => strict.transact({ label: 'Put' }, (tx) => tx.put('cameras', { ...camera!, name: 'b' })))).toBe(
      'use-patch',
    );

    const lenient = createMemoryStore({ strictPut: false });
    const other = await seedScene(lenient);
    const batches = recorder(lenient);
    lenient.transact({ label: 'Put' }, (tx) =>
      tx.put('cameras', { ...lenient.get('cameras', other.camera)!, name: 'b', locked: true }),
    );
    expect(batches.at(-1)?.changes[0]?.fields).toEqual(['locked', 'name']);
  });

  it('user, now and undoLimit', async () => {
    const store = createMemoryStore({ user: 'alice' as UserId, now: () => 1234, undoLimit: 2 });
    const scene = await seedScene(store);
    store.transact({ label: 'Delete' }, (tx) => tx.softDelete('cameras', scene.camera));
    expect(store.getIncludingDeleted('cameras', scene.camera)?.deleted).toEqual({ by: 'alice', at: 1234 });
    expect(store.undo.limit).toBe(2);
    store.transact({ label: 'Three' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
    expect(store.undo.undo()).not.toBeNull();
    expect(store.undo.undo()).not.toBeNull();
    expect(store.undo.undo()).toBeNull();
    expect(() => createMemoryStore({ undoLimit: 0 })).toThrow(EkzaError);
  });

  it('coalesces only inside the coalesceMs window of the injected clock', async () => {
    let now = 0;
    const store = createMemoryStore({ now: () => now });
    const scene = await seedScene(store);
    const nudge = (v: number): void =>
      store.transact({ label: 'Nudge', coalesceKey: 'n', coalesceMs: 500 }, (tx) =>
        tx.patch('keys', scene.keys[0], { v }),
      );
    nudge(1);
    const first = store.undo.peekUndo();
    now = 400;
    nudge(2);
    expect(store.undo.peekUndo()?.txId).toBe(first?.txId);
    expect(store.undo.peekUndo()).not.toBe(first); // a new entry object
    now = 850; // sliding window: 450 ms after the last nudge
    nudge(3);
    expect(store.undo.peekUndo()?.txId).toBe(first?.txId);
    now = 1400;
    nudge(4);
    expect(store.undo.peekUndo()?.txId).not.toBe(first?.txId);
  });
});

describe('transactions (memory store details)', () => {
  it('a failing nested transact rolls back only its own writes when the outer one catches', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const batches = recorder(store);
    store.transact({ label: 'Outer' }, (tx) => {
      tx.patch('clips', scene.clip, { loop: true });
      expect(() =>
        store.transact({ label: 'Inner' }, (inner) => {
          inner.patch('layers', scene.layer, { weight: 0.1 });
          throw new Error('inner');
        }),
      ).toThrow('inner');
      expect(tx.get('layers', scene.layer)?.weight).toBe(1);
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]?.changes.map((c) => c.table)).toEqual(['clips']);
  });

  it('refuses async callbacks and rolls their writes back', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    expect(
      code(() => store.transact({ label: 'Async' }, async (tx: Tx) => tx.patch('clips', scene.clip, { loop: true }))),
    ).toBe('unsupported');
    expect(store.get('clips', scene.clip)?.loop).toBe(false);
  });

  it('a Tx cannot write after its transaction ended', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    let leaked: Tx | undefined;
    store.transact({ label: 'Leak' }, (tx) => {
      leaked = tx;
    });
    expect(code(() => leaked?.patch('clips', scene.clip, { loop: true }))).toBe('unsupported');
  });

  it('patch removes fields set to undefined; put stores a normalized copy', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const key = { ...store.get('keys', scene.keys[0])!, breakdown: true };
    store.transact({ label: 'Put' }, (tx) => tx.put('keys', key));
    key.breakdown = false;
    expect(store.get('keys', scene.keys[0])?.breakdown).toBe(true);
    store.transact({ label: 'Clear' }, (tx) => tx.patch('keys', scene.keys[0], { breakdown: undefined } as never));
    expect('breakdown' in (store.get('keys', scene.keys[0]) as object)).toBe(false);
  });

  it('records with pre-existing problems can still be patched; new problems are refused', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const clip = store.get('clips', scene.clip)!;
    store.applyChanges(
      [{ table: 'clips', id: clip.id, before: undefined, after: { ...clip, name: 'bad|name' } } as AnyChange],
      {
        origin: 'remote',
        label: 'Remote',
      },
    );
    store.transact({ label: 'Loop' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
    expect(store.get('clips', scene.clip)?.loop).toBe(true);
    expect(code(() => store.transact({ label: 'Bad' }, (tx) => tx.patch('clips', scene.clip, { tags: ['UP'] })))).toBe(
      'invalid-record',
    );
  });

  it('remove refuses a control referenced by a constraint', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    store.transact({ label: 'Leaf' }, (tx) => {
      tx.put('controls', { ...makeTestControl({ rig: scene.rig, key: 'leaf', parent: null, order: 'b0' }) });
      tx.put('constraints', {
        id: 'cns_0000000000000001' as never,
        rig: scene.rig,
        type: 'orient',
        driven: { bone: { humanoid: 'head' } },
        targets: { a: { target: { kind: 'control', id: `${scene.rig}:leaf` as never }, weight: 1 } },
        maintainOffset: false,
        params: {},
        enabled: false,
        deleted: null,
      });
    });
    expect(
      code(() => store.transact({ label: 'Remove' }, (tx) => tx.remove('controls', `${scene.rig}:leaf` as never))),
    ).toBe('invalid-record');
  });
});

describe('batches and listeners', () => {
  it('a throwing listener never interrupts a commit; the error is rethrown asynchronously', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const scheduled: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => scheduled.push(callback));
    store.subscribe(() => {
      throw new Error('listener bug');
    });
    const seen = recorder(store);
    store.transact({ label: 'Edit' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
    expect(store.get('clips', scene.clip)?.loop).toBe(true);
    expect(seen).toHaveLength(1);
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow('listener bug');
  });

  it('batches written by listeners are delivered after the current one, in version order', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    store.subscribe((batch) => {
      if (batch.label === 'First')
        store.transact({ label: 'Reaction' }, (tx) => tx.patch('layers', scene.layer, { mute: true }));
    });
    const seen = recorder(store);
    store.transact({ label: 'First' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
    expect(seen.map((b) => b.label)).toEqual(['First', 'Reaction']);
    expect(seen[1]!.version).toBe(seen[0]!.version + 1);
  });

  it('applyChanges with no effect returns an unemitted batch and keeps the version', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const version = store.version;
    const key = store.get('keys', scene.keys[0])!;
    const batch = store.applyChanges([{ table: 'keys', id: key.id, before: key, after: key } as AnyChange], {
      origin: 'remote',
      label: 'Same',
    });
    expect(batch.changes).toEqual([]);
    expect(store.version).toBe(version);
  });

  it('import/cleanup batches are validated, remote ones are not; read-only stores accept only remote', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const bad = { ...store.get('keys', scene.keys[0])!, t: Number.NaN };
    const change = { table: 'keys', id: bad.id, before: undefined, after: bad } as AnyChange;
    expect(code(() => store.applyChanges([change], { origin: 'import', label: 'Import' }))).toBe('invalid-record');
    expect(code(() => store.applyChanges([change], { origin: 'remote', label: 'Remote' }))).toBeNull();
    expect(code(() => store.applyChanges([change], { origin: 'local' as never, label: 'X' }))).toBe('unsupported');

    const readOnly = createMemoryStore();
    readOnly.load(store.snapshot(), { readOnly: true });
    const ok = { ...store.get('clips', scene.clip)!, loop: true };
    const clipChange = { table: 'clips', id: ok.id, before: undefined, after: ok } as AnyChange;
    expect(code(() => readOnly.applyChanges([clipChange], { origin: 'import', label: 'Import' }))).toBe('read-only');
    expect(code(() => readOnly.applyChanges([clipChange], { origin: 'remote', label: 'Remote' }))).toBeNull();
    expect(readOnly.get('clips', scene.clip)?.loop).toBe(true);
  });

  it('open and close emit load batches for the records that appear and disappear', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const batches = recorder(store);
    store.close(`clip:${scene.clip}`);
    expect(batches.at(-1)).toMatchObject({ origin: 'load' });
    expect(batches.at(-1)?.changes.every((c) => c.after === undefined)).toBe(true);
    expect(batches.at(-1)?.changes).toHaveLength(5); // layer, curve, three keys
    await store.open(`clip:${scene.clip}`);
    expect(batches.at(-1)?.changes.every((c) => c.before === undefined)).toBe(true);
    const count = batches.length;
    await store.open(`clip:${scene.clip}`);
    expect(batches).toHaveLength(count);
  });

  it('open, close and load refuse to run inside a transaction callback', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    store.transact({ label: 'X' }, () => {
      expect(code(() => store.close('scene'))).toBe('unsupported');
      expect(code(() => store.load(store.snapshot()))).toBe('unsupported');
      expect(code(() => store.undo.undo())).toBe('unsupported');
      expect(code(() => store.applyChanges([], { origin: 'remote', label: 'X' }))).toBe('unsupported');
    });
    expect(store.get('clips', scene.clip)).toBeDefined();
  });
});

describe('partitions (memory store details)', () => {
  it('a control written before its rig in one transaction lands in the character partition', async () => {
    const store = new MemoryDocumentStore();
    await store.open('scene');
    const scene = newScene(3);
    store.transact({ label: 'Reversed' }, (tx) => {
      tx.put('controls', makeTestControl({ rig: scene.rig, key: 'early', parent: null, order: 'a0' }));
      writeScene(tx, scene);
    });
    expect(store.entryOf('controls', `${scene.rig}:early`)?.partition).toBe(`char:${scene.character}`);
    store.close(`char:${scene.character}`);
    expect(store.get('controls', `${scene.rig}:early` as never)).toBeUndefined();
  });

  it('a record keeps its partition while its partition fields stay (a deleted rig does not move its controls)', async () => {
    const store = new MemoryDocumentStore();
    const scene = await seedScene(store);
    const rig = store.get('rigs', scene.rig)!;
    store.applyChanges([{ table: 'rigs', id: rig.id, before: rig, after: undefined } as AnyChange], {
      origin: 'remote',
      label: 'Rig gone',
    });
    store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', scene.controls[1], { name: 'still here' }));
    expect(store.entryOf('controls', scene.controls[1])?.partition).toBe(`char:${scene.character}`);
    expect(store.partitionFor('controls', store.get('controls', scene.controls[1]) as never)).toBe('scene');
  });

  it('writing into a closed partition opens it and announces its other records first', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    store.close(`char:${scene.character}`);
    const batches = recorder(store);
    store.transact({ label: 'Add control' }, (tx) =>
      tx.put('controls', makeTestControl({ rig: scene.rig, key: 'new', parent: null, order: 'b0' })),
    );
    expect(store.isOpen(`char:${scene.character}`)).toBe(true);
    expect(batches.map((b) => b.origin)).toEqual(['load', 'local']);
    expect(batches[0]?.changes.map((c) => c.id).sort()).toEqual([scene.rig, scene.clip, ...scene.controls].sort());
    expect(batches[1]?.changes.map((c) => c.id)).toEqual([`${scene.rig}:new`]);
  });

  it('remote batches never open partitions', async () => {
    const store = createMemoryStore();
    await store.open('scene');
    const source = createMemoryStore();
    const scene = await seedScene(source);
    const changes = source.snapshot();
    const all: AnyChange[] = [];
    for (const [table, rows] of Object.entries(changes.tables)) {
      for (const record of Object.values(rows as Record<string, { id: string }>))
        all.push({ table, id: record.id, before: undefined, after: record } as AnyChange);
    }
    store.applyChanges(all, { origin: 'remote', label: 'Remote' });
    expect(store.openPartitions()).toEqual(['scene']);
    expect(store.query.missingPartitions()).toEqual([`char:${scene.character}`]);
    await store.open(`char:${scene.character}`);
    expect(store.query.missingPartitions()).toEqual([`clip:${scene.clip}`]);
  });
});

describe('previews (memory store details)', () => {
  it('a throwing update keeps the previous overlay', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', scene.keys[0], { v: 2 }));
    expect(() =>
      preview.update((tx) => {
        tx.patch('keys', scene.keys[0], { v: 3 });
        throw new Error('bad update');
      }),
    ).toThrow('bad update');
    expect(store.get('keys', scene.keys[0])?.v).toBe(2);
    expect(preview.commit()?.changes[0]?.after).toMatchObject({ v: 2 });
  });

  it('annotate inside an update sets the commit label and selection', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const preview = store.beginPreview('Drag');
    preview.update((tx) => {
      tx.patch('keys', scene.keys[0], { v: 2 });
      tx.annotate({ label: 'Move Key', selectionAfter: ['k'] });
    });
    const batch = preview.commit();
    expect(batch?.label).toBe('Move Key');
    expect(store.undo.peekUndo()?.selectionAfter).toEqual(['k']);
  });

  it('a session refuses to update or commit after it ended', async () => {
    const store = createMemoryStore();
    await seedScene(store);
    const preview = store.beginPreview('Drag');
    preview.cancel();
    expect(code(() => preview.update(() => undefined))).toBe('unsupported');
    expect(code(() => preview.commit())).toBe('unsupported');
  });

  it('load ends an active preview without committing it', async () => {
    const store = createMemoryStore();
    const scene = await seedScene(store);
    const snapshot = store.snapshot();
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', scene.keys[0], { v: 2 }));
    store.load(snapshot);
    expect(preview.active).toBe(false);
    expect(store.preview).toBeNull();
    expect(store.get('keys', scene.keys[0])?.v).toBe(0.5);
  });
});

describe('observeCommits (adapters)', () => {
  it('reports committed changes with their partitions, including preview conflicts, but not previews', async () => {
    const store = new MemoryDocumentStore();
    const scene = await seedScene(store);
    const seen: { origin: string; committed: readonly CommittedChange[] }[] = [];
    const dispose = store.observeCommits((batch, committed) => seen.push({ origin: batch.origin, committed }));
    const key = store.get('keys', scene.keys[0])!;
    const preview = store.beginPreview('Drag');
    preview.update((tx) => tx.patch('keys', key.id, { v: 2 }));
    expect(seen).toEqual([]);
    store.applyChanges([{ table: 'keys', id: key.id, before: key, after: { ...key, v: 9 } } as AnyChange], {
      origin: 'remote',
      label: 'R',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.committed[0]).toMatchObject({
      beforePartition: `clip:${scene.clip}`,
      afterPartition: `clip:${scene.clip}`,
    });
    expect(seen[0]?.committed[0]?.change.after).toMatchObject({ v: 9 });
    preview.commit();
    expect(seen.at(-1)?.origin).toBe('local');
    dispose();
    store.transact({ label: 'After' }, (tx) => tx.patch('clips', scene.clip, { loop: true }));
    expect(seen).toHaveLength(2);
  });
});
