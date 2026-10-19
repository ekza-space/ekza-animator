// M6A-SPEC §4.3 (B0a: complete): BitSet operations, the tagged encoding that picks the smaller of run-length and raw
// words (never more than size / 8 bytes + the tag), decode round trips and malformed encodings; selectionOf.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BitSet, selectionOf } from '../src';

const code = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

describe('BitSet', () => {
  it('adds, deletes, toggles and counts within its size', () => {
    const set = new BitSet(70);
    expect(set.size).toBe(70);
    expect(set.isEmpty()).toBe(true);
    set.add(0);
    set.add(31);
    set.add(32);
    set.add(69);
    set.toggle(5);
    set.toggle(31);
    set.delete(0);
    expect([...set.toArray()]).toEqual([5, 32, 69]);
    expect(set.count()).toBe(3);
    expect(set.has(32)).toBe(true);
    expect(set.has(70)).toBe(false);
    expect(set.has(-1)).toBe(false);
    expect(set.has(1.5)).toBe(false);
    expect(code(() => set.add(70))).toBe('out-of-range');
    expect(code(() => set.delete(-1))).toBe('out-of-range');
    expect(code(() => new BitSet(-1))).toBe('invalid-bitset');
    const seen: number[] = [];
    set.forEach((i) => seen.push(i));
    expect(seen).toEqual([5, 32, 69]);
    set.clear();
    expect(set.isEmpty()).toBe(true);
  });

  it('resizes keeping bits below the new size; clones and compares', () => {
    const set = new BitSet(40);
    for (const i of [1, 33, 39]) set.add(i);
    const copy = set.clone();
    expect(copy.equals(set)).toBe(true);
    expect(copy.words).not.toBe(set.words);
    set.resize(34);
    expect([...set.toArray()]).toEqual([1, 33]);
    set.resize(100);
    expect([...set.toArray()]).toEqual([1, 33]);
    expect(set.equals(copy)).toBe(false);
    expect(new BitSet(3).equals(new BitSet(4))).toBe(false);
  });

  it('handles bit 31 and full words (sign bit) in forEach and count', () => {
    const set = new BitSet(64);
    for (let i = 0; i < 64; i++) set.add(i);
    expect(set.count()).toBe(64);
    expect([...set.toArray()]).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('encode picks the smaller encoding (runs for contiguous, raw words for scattered) and decodes exactly', () => {
    const runs = new BitSet(10_000);
    for (let i = 100; i < 5_000; i++) runs.add(i);
    const a = runs.encode();
    expect([...a]).toEqual([0, 100, 4_900]);
    expect(BitSet.decode(a, 10_000).equals(runs)).toBe(true);

    const scattered = new BitSet(10_000);
    for (let i = 0; i < 10_000; i += 2) scattered.add(i);
    const b = scattered.encode();
    expect(b[0]).toBe(1);
    expect(b.length).toBe(1 + scattered.words.length);
    // the words round size / 8 bytes up to whole words; the tag adds 4 bytes
    expect(b.byteLength).toBeLessThanOrEqual(4 * Math.ceil(10_000 / 32) + 4);
    expect(BitSet.decode(b, 10_000).equals(scattered)).toBe(true);

    expect([...new BitSet(0).encode()]).toEqual([0]);
    expect(BitSet.decode(new Uint32Array([0]), 5).isEmpty()).toBe(true);
  });

  it('encode never costs more than the raw words plus the tag and round-trips (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), fc.array(fc.nat(599)), (size, picks) => {
        const set = new BitSet(size);
        for (const i of picks) if (i < size) set.add(i);
        const encoded = set.encode();
        expect(encoded.length).toBeLessThanOrEqual(1 + set.words.length);
        expect(BitSet.decode(encoded, size).equals(set)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('rejects malformed encodings', () => {
    expect(code(() => BitSet.decode(new Uint32Array(0), 4))).toBe('invalid-bitset');
    expect(code(() => BitSet.decode(new Uint32Array([7]), 4))).toBe('invalid-bitset');
    expect(code(() => BitSet.decode(new Uint32Array([0, 1]), 4))).toBe('invalid-bitset');
    expect(code(() => BitSet.decode(new Uint32Array([0, 2, 5]), 4))).toBe('invalid-bitset');
    expect(code(() => BitSet.decode(new Uint32Array([0, 3, 1, 1, 1]), 8))).toBe('invalid-bitset');
    expect(code(() => BitSet.decode(new Uint32Array([1, 0, 0]), 4))).toBe('invalid-bitset');
    // raw words beyond the size are masked
    expect([...BitSet.decode(new Uint32Array([1, 0xffffffff]), 4).toArray()]).toEqual([0, 1, 2, 3]);
  });
});

describe('selectionOf', () => {
  const counts = { points: 8, edges: 12, faces: 6, corners: 24 };
  it('selects the indices of one kind in pick order, the last pick active', () => {
    const sel = selectionOf('face', [4, 1, 4, 2], counts);
    expect(sel.kind).toBe('face');
    expect([...sel.faces.toArray()]).toEqual([1, 2, 4]);
    expect([...(sel.order ?? [])]).toEqual([4, 1, 2]);
    expect(sel.active).toBe(2);
    expect([sel.verts.size, sel.edges.size, sel.faces.size]).toEqual([8, 12, 6]);
    expect(sel.verts.isEmpty() && sel.edges.isEmpty()).toBe(true);
  });
  it('an empty pick list has no order and no active component; out-of-range picks throw', () => {
    const sel = selectionOf('vertex', [], counts);
    expect([sel.order, sel.active]).toEqual([null, -1]);
    expect(code(() => selectionOf('edge', [12], counts))).toBe('out-of-range');
  });
});
