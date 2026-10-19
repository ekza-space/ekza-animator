// The write log (M6A-SPEC §4.3 `MeshDelta`, ADR 0014 §5, research 13 §4.1). Every write of a transaction records the
// first old value of its slot (coalesced per slot with a bitset per array); a log is cut into segments at layer
// additions and removals (a segment = an optional layer event followed by slot writes). An array whose logged slots
// exceed a quarter of its live length switches to a copy-on-write snapshot (the whole live prefix before and after),
// so giant operations stay O(n) instead of O(n) map entries. Closing a segment reads the after values; `apply` replays
// segments forward (event, then after values) or backward (before values in reverse, then the event's inverse).
// Targets are numbers for the kernel's own arrays (stored arrays, edit links, counts) and layer names for attribute
// layers, so a delta applies to any kernel mesh in the same state (no object identity inside a delta).
//
// Dead slots (past the count, up to the capacity) always hold the target's dead value (`TARGET_DEAD`, a layer's
// default): a removal writes them through the log into the slot it vacates, so the slot's live content is in the
// delta, and every array is a pure function of the live state. That is what makes a delta exact on any mesh in the
// same state — the same object, or a runtime rebuilt from its revision (§5.5 rules 4 and 8).
import { KERNEL_MARKER } from '../kernel';
import type { KernelArray, LayerArray } from '../layers/arrays';
import type { LayerDef } from '../types';

// ---------- targets ----------

/** Built-in targets: the counts, the stored arrays and the edit links. */
export const T_COUNTS = 0;
export const T_POS = 1;
export const T_EV = 2;
export const T_EF = 3;
export const T_CV = 4;
export const T_CN = 5;
export const T_FC = 6;
export const T_FM = 7;
export const T_FF = 8;
export const T_VE = 9;
export const T_DN = 10;
export const T_EC = 11;
export const T_CP = 12;
export const T_CE = 13;
export const T_CF = 14;
export const T_CR = 15;
export const BUILTIN_TARGETS = 16;

/** Domain (0 point, 1 edge, 2 face, 3 corner; −1 none) and values per element of each built-in target. */
export const TARGET_DOMAIN: readonly number[] = [-1, 0, 1, 1, 3, 3, 2, 2, 2, 0, 1, 1, 3, 3, 3, 3];
export const TARGET_STRIDE: readonly number[] = [1, 3, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1];
/** Built-in targets that are part of the stored form (they make elements dirty). */
export const TARGET_STORED: readonly boolean[] = [
  false,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
];
/** The value a dead slot of each built-in target holds: 0 in the stored arrays, −1 in the edit links. */
export const TARGET_DEAD: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, -1];
/** Built-in targets whose writes change connectivity (`DirtySet.topology`). */
export const TARGET_TOPOLOGY: readonly boolean[] = [
  true,
  false,
  true,
  false,
  true,
  true,
  true,
  false,
  false,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

// ---------- events and records ----------

export type LayerEvent =
  | { readonly kind: 'add'; readonly def: LayerDef; readonly at: number }
  | { readonly kind: 'remove'; readonly def: LayerDef; readonly at: number; readonly data: LayerArray };

/** Coalesced slot writes of one target in one segment. */
export interface SlotRecord {
  readonly key: number | string;
  readonly idx: Uint32Array;
  readonly before: KernelArray;
  readonly after: KernelArray;
}
/**
 * A copy-on-write snapshot of one target in one segment: the live prefix at the segment's start (`before`) and the
 * prefix up to the larger of both live lengths at its end (`after`, dead values past the end count). Slots of `after`
 * past `before` were dead at the start: backward application writes the dead value there.
 */
export interface SnapRecord {
  readonly key: number | string;
  readonly before: KernelArray;
  readonly after: KernelArray;
}
export interface SegmentRecord {
  readonly event: LayerEvent | null;
  readonly slots: readonly SlotRecord[];
  readonly snaps: readonly SnapRecord[];
}
/** `MeshDelta.writes` of this kernel. */
export interface KernelWrites {
  readonly kind: 'ekza-mesh-log';
  readonly marker: typeof KERNEL_MARKER;
  /** Peak element counts during the transaction (capacity needed to replay it), [P, E, F, C]. */
  readonly peak: readonly [number, number, number, number];
  readonly segments: readonly SegmentRecord[];
}

export function isKernelWrites(value: unknown): value is KernelWrites {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'ekza-mesh-log' &&
    (value as { marker?: unknown }).marker === KERNEL_MARKER
  );
}

// ---------- the open log ----------

/** The live array, live length (elements × stride) and identity of a target at the time of a write. */
export interface TargetAccess {
  /** Current array of the target (identity changes on capacity growth). */
  array(tid: number): KernelArray;
  /** Live values (count × stride) of the target for element counts `counts` ([P, E, F, C]). */
  lengthAt(tid: number, counts: Int32Array): number;
  /** Current element counts [P, E, F, C]. */
  counts(): Int32Array;
  /** Delta key of the target: the built-in id, or the layer's name. */
  key(tid: number): number | string;
}

class SlotLog {
  idx = new Int32Array(16);
  before = new Float64Array(16);
  n = 0;
  seen: Uint32Array;
  snap: KernelArray | null = null;

  constructor(
    readonly tid: number,
    readonly key: number | string,
    /** Live length when the segment started (the snapshot prefix: slots past it were dead before the segment). */
    readonly startLength: number,
    arrayLength: number,
  ) {
    this.seen = new Uint32Array((arrayLength >>> 5) + 1);
  }
}

/** Snapshot threshold: switch once the slots exceed a quarter of the live length (and a small floor). */
const SNAPSHOT_FLOOR = 64;

export class OpenSegment {
  readonly builtin: (SlotLog | undefined)[] = Array.from({ length: BUILTIN_TARGETS }, () => undefined);
  readonly layers = new Map<number, SlotLog>();
  /** Insertion order of every log (deterministic records). */
  readonly order: SlotLog[] = [];

  /** Element counts when the segment opened. */
  private readonly startCounts: Int32Array;

  constructor(
    readonly event: LayerEvent | null,
    private readonly access: TargetAccess,
  ) {
    this.startCounts = access.counts().slice();
  }

  /** Records the old value of slot `i` of target `tid` before its first write in this segment. */
  record(tid: number, i: number, old: number, array: KernelArray): void {
    let log = tid < BUILTIN_TARGETS ? this.builtin[tid] : this.layers.get(tid);
    if (log === undefined) {
      log = new SlotLog(tid, this.access.key(tid), this.access.lengthAt(tid, this.startCounts), array.length);
      if (tid < BUILTIN_TARGETS) this.builtin[tid] = log;
      else this.layers.set(tid, log);
      this.order.push(log);
    }
    if (log.snap !== null) return;
    const word = i >>> 5;
    if (word >= log.seen.length) {
      const grown = new Uint32Array(Math.max(word + 1, log.seen.length * 2));
      grown.set(log.seen);
      log.seen = grown;
    }
    const bit = 1 << (i & 31);
    if (((log.seen[word] as number) & bit) !== 0) return;
    log.seen[word] = (log.seen[word] as number) | bit;
    if (log.n === log.idx.length) {
      const idx = new Int32Array(log.n * 2);
      idx.set(log.idx);
      log.idx = idx;
      const before = new Float64Array(log.n * 2);
      before.set(log.before);
      log.before = before;
    }
    log.idx[log.n] = i;
    log.before[log.n] = old;
    log.n++;
    if (tid !== T_COUNTS && log.n > SNAPSHOT_FLOOR && log.n * 4 > log.startLength) this.toSnapshot(log, array);
  }

  /** Copy-on-write: the live prefix at segment start, rebuilt from the current array and the logged old values. */
  private toSnapshot(log: SlotLog, array: KernelArray): void {
    const snap = array.slice(0, log.startLength) as KernelArray;
    for (let k = log.n - 1; k >= 0; k--) {
      const i = log.idx[k] as number;
      if (i < log.startLength) snap[i] = log.before[k] as number;
    }
    log.snap = snap;
    log.n = 0;
    log.idx = new Int32Array(0);
    log.before = new Float64Array(0);
  }

  /**
   * Reads the after values and freezes the segment. Unchanged slots are dropped (an element created and removed
   * again within the segment leaves dead values at both ends, so it drops out here too); every changed slot is kept,
   * live or not, so a slot a later segment empties again is still restored by the segment that emptied it first.
   */
  close(): SegmentRecord {
    const slots: SlotRecord[] = [];
    const snaps: SnapRecord[] = [];
    const endCounts = this.access.counts();
    for (const log of this.order) {
      const array = this.access.array(log.tid);
      if (log.snap !== null) {
        const live = Math.max(log.startLength, this.access.lengthAt(log.tid, endCounts));
        snaps.push({ key: log.key, before: log.snap, after: array.slice(0, live) });
        continue;
      }
      const keep = (k: number): boolean => !Object.is(array[log.idx[k] as number], log.before[k]);
      let kept = 0;
      for (let k = 0; k < log.n; k++) if (keep(k)) kept++;
      if (kept === 0) continue;
      const Ctor = array.constructor as new (n: number) => KernelArray;
      const idx = new Uint32Array(kept);
      const before = new Ctor(kept);
      const after = new Ctor(kept);
      let o = 0;
      for (let k = 0; k < log.n; k++) {
        if (!keep(k)) continue;
        const i = log.idx[k] as number;
        const value = array[i] as number;
        idx[o] = i;
        before[o] = log.before[k] as number;
        after[o] = value;
        o++;
      }
      slots.push({ key: log.key, idx, before, after });
    }
    return Object.freeze({ event: this.event, slots: Object.freeze(slots), snaps: Object.freeze(snaps) });
  }
}

/** Retained bytes of a segment record (journal accounting). */
export function segmentBytes(segment: SegmentRecord): number {
  let bytes = 32;
  for (const slot of segment.slots) bytes += slot.idx.byteLength + slot.before.byteLength + slot.after.byteLength + 32;
  for (const snap of segment.snaps) bytes += snap.before.byteLength + snap.after.byteLength + 32;
  if (segment.event?.kind === 'remove') bytes += segment.event.data.byteLength;
  if (segment.event !== null) bytes += 64;
  return bytes;
}
