// M2A-SPEC §5.21.1 (M-1): `batchTables` / `batchTouches` give listeners the tables of a change batch from one scan per
// batch: the set equals the tables of the changes (any order, runs or not), it is computed once per batch object, and
// every listener of one emit sees the same set.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type AnyChange, batchTables, batchTouches, type ChangeBatch, createMemoryStore, type TableName } from '../src';
import { seedScene } from '../src/testing';

const TABLES: readonly TableName[] = ['keys', 'curves', 'layers', 'clips', 'controls', 'rigs', 'characters', 'project'];

function batchOf(tables: readonly TableName[]): ChangeBatch {
  return {
    txId: 'tx',
    origin: 'local',
    label: 'test',
    user: 'usr_test' as ChangeBatch['user'],
    version: 1,
    changes: tables.map((table, i) => ({ table, id: `id${i}`, before: undefined, after: undefined }) as AnyChange),
  };
}

describe('batchTables / batchTouches', () => {
  it('equals the set of the changes’ tables for any sequence; batchTouches is its intersection test', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...TABLES), { maxLength: 60 }),
        fc.array(fc.constantFrom(...TABLES), { maxLength: 4 }),
        (tables, watched) => {
          const batch = batchOf(tables);
          expect([...batchTables(batch)].sort()).toEqual([...new Set(tables)].sort());
          expect(batchTouches(batch, watched)).toBe(watched.some((table) => tables.includes(table)));
        },
      ),
    );
  });

  it('is computed once per batch object: every listener of one emit gets the same set', async () => {
    const store = createMemoryStore();
    const s = await seedScene(store, 3);
    const seen: ReadonlySet<TableName>[] = [];
    for (let i = 0; i < 3; i++) store.subscribe((batch) => seen.push(batchTables(batch)));
    const first = s.keys[0];
    if (first === undefined) throw new Error('no key');
    const key = store.get('keys', first);
    if (key === undefined) throw new Error('no key');
    store.transact({ label: 'value' }, (tx) => tx.patch('keys', key.id, { v: key.v + 1 }));
    expect(seen).toHaveLength(3);
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toBe(seen[0]);
    expect([...(seen[0] ?? [])]).toEqual(['keys']);
    // Another batch object has its own set.
    store.transact({ label: 'value' }, (tx) => tx.patch('keys', key.id, { v: key.v + 2 }));
    expect(seen[3]).not.toBe(seen[0]);
  });
});
