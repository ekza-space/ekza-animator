// Incremental GPU uploads (research 13 §7.1: `BufferAttribute.addUpdateRange`): the touched elements of an attribute
// become a few merged ranges; scattered edits fall back to one span, a full rewrite to a whole upload.
import type { BufferAttribute, InterleavedBufferAttribute } from 'three';

/** Gaps up to this many elements are uploaded rather than split into another range. */
const MERGE_GAP = 256;
/** More ranges than this upload as one span from the first to the last touched element. */
const MAX_RANGES = 16;

type Attr = BufferAttribute | InterleavedBufferAttribute;

/** Collects touched element indices of one or more attributes with the same element count. */
export class Touched {
  private marks: Uint8Array;
  private list: number[] = [];
  private all = false;

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
      const sorted = Int32Array.from(this.list).sort();
      const ranges: number[] = [];
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
      if (ranges.length / 2 > MAX_RANGES) ranges.splice(1, ranges.length - 2);
      for (const attr of attrs) {
        if (!(attr as BufferAttribute).isBufferAttribute) {
          attr.needsUpdate = true;
          continue;
        }
        const buffer = attr as BufferAttribute;
        for (let r = 0; r < ranges.length; r += 2) {
          const first = ranges[r] as number;
          const last = ranges[r + 1] as number;
          buffer.addUpdateRange(first * buffer.itemSize, (last - first + 1) * buffer.itemSize);
        }
        buffer.needsUpdate = true;
      }
      for (const i of this.list) this.marks[i] = 0;
    }
    this.list.length = 0;
    this.all = false;
  }
}

/**
 * A whole upload, written as one full range: ranges added after it in the same frame then add to it instead of turning
 * the pending whole upload into a partial one.
 */
export function uploadAll(attr: Attr): void {
  if ((attr as BufferAttribute).isBufferAttribute) {
    const buffer = attr as BufferAttribute;
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, buffer.array.length);
  }
  attr.needsUpdate = true;
}
