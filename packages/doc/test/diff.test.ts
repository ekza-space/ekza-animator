import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareStrings, deepEqual, diffFields } from '../src';

describe('deepEqual', () => {
  it('compares JSON-like values structurally', () => {
    expect(deepEqual({ a: [1, { b: 'x' }], c: null }, { c: null, a: [1, { b: 'x' }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(0, -0)).toBe(true);
    expect(deepEqual('1', 1)).toBe(false);
  });

  it('treats undefined properties as absent and NaN as equal to NaN (JSON semantics)', () => {
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual({ v: Number.NaN }, { v: Number.NaN })).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(undefined, null)).toBe(false);
  });

  it('agrees with JSON round-trip equality on JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
        expect(deepEqual(a, structuredClone(a))).toBe(true);
        const sameText = canonical(a) === canonical(b);
        expect(deepEqual(a, b)).toBe(sameText);
      }),
    );
  });
});

describe('diffFields', () => {
  it('lists changed, added and removed top-level fields in code-unit order', () => {
    expect(diffFields({ id: 'x', b: 1, a: { n: 1 }, gone: 1 }, { id: 'x', b: 1, a: { n: 2 }, Z: true })).toEqual([
      'Z',
      'a',
      'gone',
    ]);
    expect(diffFields({ a: 1, b: undefined }, { a: 1 })).toEqual([]);
  });
});

describe('compareStrings', () => {
  it('orders by code unit, not locale', () => {
    expect(['b', 'B', 'a', 'A', '0'].sort(compareStrings)).toEqual(['0', 'A', 'B', 'a', 'b']);
  });
});

/** JSON text with sorted keys (and -0 normalized by JSON). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => compareStrings(a, b)))
      : inner,
  );
}
