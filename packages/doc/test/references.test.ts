import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareStrings } from '../src';
import { type PlannedWrites, ReferenceIndex, referencesOf, referencesRecord } from '../src/store/references';
import { type Row, rowKey } from '../src/store/rows';

const IDS = ['a', 'b', 'c', 'd'];

/** A random record of a referencing table whose references point into a small id space. */
const recordArb = fc.oneof(
  fc.record({
    table: fc.constant('keys'),
    id: fc.constantFrom(...IDS),
    clip: fc.constantFrom(...IDS),
    curve: fc.constantFrom(...IDS),
  }),
  fc.record({
    table: fc.constant('curves'),
    id: fc.constantFrom(...IDS),
    clip: fc.constantFrom(...IDS),
    layer: fc.constantFrom(...IDS),
    control: fc.constantFrom(...IDS),
  }),
  fc.record({
    table: fc.constant('controls'),
    id: fc.constantFrom(...IDS),
    rig: fc.constantFrom(...IDS),
    parent: fc.option(fc.constantFrom(...IDS)),
    mirror: fc.option(fc.constantFrom(...IDS)),
  }),
);

type Op = { readonly table: string; readonly id: string; readonly record: Row | undefined };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  recordArb.map(({ table, ...record }) => ({ table, id: record.id, record: record as Row })),
  fc.record({
    table: fc.constantFrom('keys', 'curves', 'controls'),
    id: fc.constantFrom(...IDS),
    record: fc.constant(undefined),
  }),
);

function bruteForce(
  rows: ReadonlyMap<string, { readonly table: string; readonly record: Row }>,
  table: string,
  id: string,
): string | null {
  const found: string[] = [];
  for (const [key, row] of rows) {
    if (key === rowKey(table, id)) continue;
    if (referencesRecord(row.table, row.record, table, id)) found.push(`${row.table}/${row.record.id}`);
  }
  return found.sort(compareStrings)[0] ?? null;
}

describe('references', () => {
  it('lists the outgoing references of every built-in referencing table', () => {
    expect(referencesOf('keys', { id: 'k', clip: 'c', curve: 'v' })).toEqual([
      ['clips', 'c'],
      ['curves', 'v'],
    ]);
    expect(
      referencesOf('constraints', {
        id: 'x',
        rig: 'r',
        driven: { control: 'c1' },
        targets: { a: { target: { kind: 'control', id: 'c2' } }, b: { target: { kind: 'world' } } },
      }),
    ).toEqual([
      ['rigs', 'r'],
      ['controls', 'c1'],
      ['controls', 'c2'],
    ]);
    expect(referencesOf('clips', { id: 'c', character: 'h', source: { kind: 'embedded', asset: 'f' } })).toEqual([
      ['characters', 'h'],
      ['assets', 'f'],
    ]);
    expect(referencesOf('acme.notes', { id: 'n', clip: 'c' })).toEqual([]);
  });

  it('the index agrees with a brute-force scan after any write sequence, with and without a plan', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), fc.array(opArb, { maxLength: 6 }), (ops, plan) => {
        const index = new ReferenceIndex();
        const rows = new Map<string, { table: string; record: Row }>();
        for (const op of ops) {
          const key = rowKey(op.table, op.id);
          index.onWrite(op.table, op.id, rows.get(key)?.record, op.record);
          if (op.record === undefined) rows.delete(key);
          else rows.set(key, { table: op.table, record: op.record });
        }
        const current = (table: string, id: string): Row | undefined => rows.get(rowKey(table, id))?.record;
        const planned: PlannedWrites = new Map(
          plan.map((op) => [rowKey(op.table, op.id), { table: op.table, after: op.record }]),
        );
        const after = new Map(rows);
        for (const op of plan) {
          if (op.record === undefined) after.delete(rowKey(op.table, op.id));
          else after.set(rowKey(op.table, op.id), { table: op.table, record: op.record });
        }
        for (const table of ['clips', 'curves', 'layers', 'controls', 'rigs']) {
          for (const id of IDS) {
            expect(index.dependantOf(table, id, current), `${table}/${id}`).toBe(bruteForce(rows, table, id));
            expect(index.dependantOf(table, id, current, planned), `${table}/${id} planned`).toBe(
              bruteForce(after, table, id),
            );
          }
        }
        expect(index.dependantOf('keys', 'a', current)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });
});
