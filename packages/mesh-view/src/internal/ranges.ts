// Incremental GPU uploads (research 13 §7.1: `BufferAttribute.addUpdateRange`): the touched elements of an attribute
// become a few merged ranges; scattered edits fall back to one span, a full rewrite to a whole upload.
import type { BufferAttribute, InterleavedBufferAttribute } from 'three';

/** Gaps up to this many elements are uploaded rather than split into another range. */
const MERGE_GAP = 256;
/** More ranges than this upload as one span from the first to the last touched element. */
const MAX_RANGES = 16;

type Attr = BufferAttribute | InterleavedBufferAttribute;

/**
 * Attributes that reached the GPU. A fresh attribute uploads whole on its first render (three ignores ranges then
 * but keeps them), so ranges are only added once it was uploaded; before that a plain `needsUpdate` suffices.
 */
const uploaded = new WeakSet<object>();

/** Registers `attr` for upload tracking (every attribute the overlays write incrementally). */
export function tracked<T extends BufferAttribute>(attr: T): T {
  attr.onUpload(() => {
    uploaded.add(attr);
  });
  return attr;
}

function ranged(attr: Attr): attr is BufferAttribute {
  return (attr as BufferAttribute).isBufferAttribute === true && uploaded.has(attr);
}

/**
 * Collects touched element indices of one or more attributes with the same element count. Its buffers are reused
 * across flushes (drags flush every frame; MVP-SPEC §3: no allocation in per-frame paths once warm).
 */
export class Touched {
  private marks: Uint8Array;
  private list: number[] = [];
  private all = false;
  private sorted = new Int32Array(0);
  private readonly ranges: number[] = [];

  constructor(size: number) {
    this.marks = new Uint8Array(size);
  }

  resize(size: number): void {
    this.marks = new Uint8Array(size);
    this.list.length = 0;
    this.all = false;
  }

  add(i: number): void {
    if (this.all || this.marks[i] === 1) return;
    this.marks[i] = 1;
    this.list.push(i);
  }

  addAll(): void {
    this.all = true;
  }

  get empty(): boolean {
    return !this.all && this.list.length === 0;
  }

  /** Marks the attributes for upload (their `itemSize` scales the ranges) and resets. */
  flush(attrs: readonly Attr[]): void {
    if (this.all) {
      for (const attr of attrs) uploadAll(attr);
    } else if (this.list.length > 0) {
      const n = this.list.length;
      if (this.sorted.length < n) this.sorted = new Int32Array(Math.max(n, 2 * this.sorted.length));
      const sorted = this.sorted.subarray(0, n);
      for (let k = 0; k < n; k++) sorted[k] = this.list[k] as number;
      sorted.sort();
      const ranges = this.ranges;
      ranges.length = 0;
      let start = sorted[0] as number;
      let end = start;
      for (let k = 1; k < sorted.length; k++) {
        const i = sorted[k] as number;
        if (i - end <= MERGE_GAP) {
          end = i;
          continue;
        }
        ranges.push(start, end);
        start = i;
        end = i;
      }
      ranges.push(start, end);
      if (ranges.length / 2 > MAX_RANGES) {
        ranges[1] = ranges[ranges.length - 1] as number;
        ranges.length = 2;
      }
      for (const attr of attrs) {
        if (!ranged(attr)) {
          attr.needsUpdate = true;
          continue;
        }
        const buffer = attr;
        for (let r = 0; r < ranges.length; r += 2) {
          const first = ranges[r] as number;
          const last = ranges[r + 1] as number;
          buffer.addUpdateRange(first * buffer.itemSize, (last - first + 1) * buffer.itemSize);
        }
        buffer.needsUpdate = true;
      }
      for (let k = 0; k < n; k++) this.marks[this.list[k] as number] = 0;
    }
    this.list.length = 0;
    this.all = false;
  }
}

/**
 * A reusable set of element indices in insertion order (generation stamps over an item buffer): cleared and refilled
 * per incremental update without allocating once sized for the topology.
 */
export class IndexSet {
  private stamps: Uint32Array;
  private buffer: Uint32Array;
  private count = 0;
  private generation = 1;

  constructor(size = 0) {
    this.stamps = new Uint32Array(size);
    this.buffer = new Uint32Array(size);
  }

  /** Sizes the set for `size` elements (indices ≥ size are ignored) and empties it. */
  resize(size: number): void {
    if (this.stamps.length !== size) {
      this.stamps = new Uint32Array(size);
      this.buffer = new Uint32Array(size);
      this.generation = 0;
    }
    this.clear();
  }

  clear(): void {
    this.count = 0;
    this.generation++;
    if (this.generation === 0xffffffff) {
      this.stamps.fill(0);
      this.generation = 1;
    }
  }

  add(i: number): void {
    if (!(i < this.stamps.length) || this.stamps[i] === this.generation) return;
    this.stamps[i] = this.generation;
    this.buffer[this.count++] = i;
  }

  get size(): number {
    return this.count;
  }

  /** The indices added since the last `clear`, in insertion order: a view, valid until the next change. */
  items(): Uint32Array {
    return this.buffer.subarray(0, this.count);
  }
}

/**
 * A whole upload, written as one full range: ranges added after it in the same frame then add to it instead of turning
 * the pending whole upload into a partial one.
 */
export function uploadAll(attr: Attr): void {
  if (ranged(attr)) {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, attr.array.length);
  }
  attr.needsUpdate = true;
}

/** One range (in array elements) of an attribute; a whole upload while it has not reached the GPU yet. */
export function addRange(attr: BufferAttribute, start: number, count: number): void {
  if (uploaded.has(attr)) attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}
