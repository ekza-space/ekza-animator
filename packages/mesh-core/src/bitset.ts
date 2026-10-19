// Fixed-size bitset over element indices (M6A-SPEC §4.3): component selections, hidden sets and per-mode memory.
// Words are 32-bit; bits at or above `size` are always zero. `encode` picks the smaller of two tagged encodings, so a
// selection snapshot never costs more than size / 8 bytes plus the tag (§5.6 undo byte budget). Eager-safe.
import { EkzaError } from '@ekza-animator/anim-core';

const TAG_RUNS = 0;
const TAG_WORDS = 1;

function wordCount(size: number): number {
  return (size + 31) >>> 5;
}

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > 0xffff_ffff) {
    throw new EkzaError('invalid-bitset', `BitSet size must be an integer 0…2^32−1, got ${size}`);
  }
}

/** Number of set bits of a 32-bit word. */
function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export class BitSet {
  #size: number;
  #words: Uint32Array;

  constructor(size = 0) {
    checkSize(size);
    this.#size = size;
    this.#words = new Uint32Array(wordCount(size));
  }

  get size(): number {
    return this.#size;
  }

  /** The backing words (bit i in word i >>> 5, bit i & 31). Replaced by `resize`. */
  get words(): Uint32Array {
    return this.#words;
  }

  has(i: number): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= this.#size) return false;
    return ((this.#words[i >>> 5] as number) & (1 << (i & 31))) !== 0;
  }

  add(i: number): void {
    this.#check(i);
    this.#words[i >>> 5] = (this.#words[i >>> 5] as number) | (1 << (i & 31));
  }

  delete(i: number): void {
    this.#check(i);
    this.#words[i >>> 5] = (this.#words[i >>> 5] as number) & ~(1 << (i & 31));
  }

  toggle(i: number): void {
    this.#check(i);
    this.#words[i >>> 5] = (this.#words[i >>> 5] as number) ^ (1 << (i & 31));
  }

  clear(): void {
    this.#words.fill(0);
  }

  count(): number {
    let n = 0;
    for (let w = 0; w < this.#words.length; w++) n += popcount(this.#words[w] as number);
    return n;
  }

  isEmpty(): boolean {
    for (let w = 0; w < this.#words.length; w++) if (this.#words[w] !== 0) return false;
    return true;
  }

  /** Grows or shrinks the set; bits below the new size are kept, bits at or above it are dropped. */
  resize(size: number): void {
    checkSize(size);
    const words = new Uint32Array(wordCount(size));
    words.set(this.#words.subarray(0, Math.min(words.length, this.#words.length)));
    this.#words = words;
    this.#size = size;
    this.#maskTail();
  }

  /** Calls `fn` for every set bit, ascending. */
  forEach(fn: (i: number) => void): void {
    const words = this.#words;
    for (let w = 0; w < words.length; w++) {
      let word = words[w] as number;
      while (word !== 0) {
        const low = word & -word;
        fn((w << 5) + (31 - Math.clz32(low)));
        word ^= low;
      }
    }
  }

  /** The set bits, ascending. */
  toArray(): Uint32Array {
    const out = new Uint32Array(this.count());
    let n = 0;
    this.forEach((i) => {
      out[n++] = i;
    });
    return out;
  }

  equals(other: BitSet): boolean {
    if (other.size !== this.#size) return false;
    const a = this.#words;
    const b = other.words;
    for (let w = 0; w < a.length; w++) if (a[w] !== b[w]) return false;
    return true;
  }

  clone(): BitSet {
    const copy = new BitSet(this.#size);
    copy.words.set(this.#words);
    return copy;
  }

  /**
   * The smaller of two encodings, element 0 the tag: 0 = run-length (start, length) pairs ascending, 1 = the raw
   * words. A tie goes to the run-length form. Scattered selections on large meshes therefore never cost more than
   * size / 8 bytes (+4).
   */
  encode(): Uint32Array {
    const runs: number[] = [];
    let start = -1;
    let previous = -2;
    this.forEach((i) => {
      if (i !== previous + 1) {
        if (start >= 0) runs.push(start, previous - start + 1);
        start = i;
      }
      previous = i;
    });
    if (start >= 0) runs.push(start, previous - start + 1);
    if (runs.length <= this.#words.length) {
      const out = new Uint32Array(1 + runs.length);
      out[0] = TAG_RUNS;
      out.set(runs, 1);
      return out;
    }
    const out = new Uint32Array(1 + this.#words.length);
    out[0] = TAG_WORDS;
    out.set(this.#words, 1);
    return out;
  }

  /** Decodes `encode()` output for a set of `size` elements; EkzaError('invalid-bitset') on malformed input. */
  static decode(encoded: Uint32Array, size: number): BitSet {
    const set = new BitSet(size);
    const fail = (why: string): never => {
      throw new EkzaError('invalid-bitset', `BitSet.decode: ${why}`);
    };
    if (encoded.length === 0) fail('empty encoding (no tag)');
    const tag = encoded[0];
    if (tag === TAG_WORDS) {
      if (encoded.length - 1 !== set.words.length) {
        fail(`expected ${set.words.length} words for size ${size}, got ${encoded.length - 1}`);
      }
      set.words.set(encoded.subarray(1));
      set.#maskTail();
      return set;
    }
    if (tag !== TAG_RUNS) fail(`unknown tag ${String(tag)}`);
    if ((encoded.length - 1) % 2 !== 0) fail('run-length pairs are incomplete');
    let end = 0;
    for (let k = 1; k < encoded.length; k += 2) {
      const start = encoded[k] as number;
      const length = encoded[k + 1] as number;
      if (length === 0 || start < end || start + length > size)
        fail(`run (${start}, ${length}) is out of order or range`);
      for (let i = start; i < start + length; i++)
        set.words[i >>> 5] = (set.words[i >>> 5] as number) | (1 << (i & 31));
      end = start + length;
    }
    return set;
  }

  #check(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.#size) {
      throw new EkzaError('out-of-range', `BitSet index ${i} is outside 0…${this.#size - 1}`);
    }
  }

  /** Clears the bits of the last word at or above `size`. */
  #maskTail(): void {
    const rest = this.#size & 31;
    if (rest !== 0 && this.#words.length > 0) {
      const last = this.#words.length - 1;
      this.#words[last] = (this.#words[last] as number) & ((1 << rest) - 1);
    }
  }
}
