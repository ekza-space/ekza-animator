// M2A-SPEC §5.21.1 (M-1): `Journal.ordered` (the originals for indexed loops) stays the first-touch order of
// `Journal.originals` under any sequence of first touches and removals (rollbacks, failed preview updates).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Journal, NOT_SHOWN } from '../src/store/journal';

describe('Journal.ordered', () => {
  it('equals the originals map in order after any adds and removes', () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant('add' as const), id: fc.integer({ min: 0, max: 12 }) }),
      fc.record({ kind: fc.constant('remove' as const), id: fc.integer({ min: 0, max: 12 }) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.constantFrom('keys', 'curves'), (ops, table) => {
        const journal = new Journal();
        for (const { kind, id } of ops) {
          const key = `k${id}`;
          if (kind === 'add') {
            if (journal.get(table, key) === undefined) {
              journal.add({ table, id: key, original: undefined, shown: NOT_SHOWN, current: undefined });
            }
          } else {
            journal.remove(table, key);
          }
        }
        expect(journal.ordered).toEqual([...journal.originals.values()]);
      }),
    );
  });
});
