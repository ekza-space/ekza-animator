import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareStrings, EkzaError, fractionalIndex, isFractionalIndex } from '../src';

describe('fractionalIndex', () => {
  it('starts at a0 and appends with short keys', () => {
    expect(fractionalIndex(null, null)).toBe('a0');
    const keys: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      last = fractionalIndex(last, null);
      keys.push(last);
    }
    expect(keys.slice(0, 3)).toEqual(['a0', 'a1', 'a2']);
    expect([...keys].sort(compareStrings)).toEqual(keys);
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(3);
  });

  it('prepends below a0 and keeps order', () => {
    const keys: string[] = ['a0'];
    for (let i = 0; i < 100; i++) keys.unshift(fractionalIndex(null, keys[0] ?? null));
    expect([...keys].sort(compareStrings)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('inserts strictly between any two keys', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.nat(), fc.boolean()), { minLength: 1, maxLength: 60 }), (moves) => {
        const keys: string[] = [fractionalIndex(null, null)];
        for (const [at, before] of moves) {
          const i = at % keys.length;
          const left = before ? (keys[i - 1] ?? null) : (keys[i] ?? null);
          const right = before ? (keys[i] ?? null) : (keys[i + 1] ?? null);
          const key = fractionalIndex(left, right);
          expect(isFractionalIndex(key)).toBe(true);
          if (left !== null) expect(compareStrings(left, key)).toBeLessThan(0);
          if (right !== null) expect(compareStrings(key, right)).toBeLessThan(0);
          keys.splice(before ? i : i + 1, 0, key);
        }
        expect([...keys].sort(compareStrings)).toEqual(keys);
      }),
    );
  });

  it('keeps repeated bisection bounded and ordered', () => {
    let low = 'a0';
    const high = 'a1';
    for (let i = 0; i < 50; i++) {
      const mid = fractionalIndex(low, high);
      expect(compareStrings(low, mid)).toBeLessThan(0);
      expect(compareStrings(mid, high)).toBeLessThan(0);
      low = mid;
    }
    expect(low.length).toBeLessThan(60);
  });

  it('rejects malformed keys and reversed bounds with invalid-record', () => {
    for (const [a, b] of [
      ['a1', 'a0'],
      ['a0', 'a0'],
      ['', null],
      ['a', null],
      ['a00', null],
      ['?0', null],
      ['a0!', null],
    ] as const) {
      expect(() => fractionalIndex(a, b)).toThrow(EkzaError);
      try {
        fractionalIndex(a, b);
      } catch (error) {
        expect((error as EkzaError).code).toBe('invalid-record');
      }
    }
    expect(isFractionalIndex('a0V')).toBe(true);
    expect(isFractionalIndex('a0V0')).toBe(false);
  });
});
