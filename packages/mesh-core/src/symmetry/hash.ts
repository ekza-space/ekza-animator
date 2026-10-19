// Integer spatial hash over 3D points (ADR 0014 determinism rules: integer cells, no float-keyed maps, candidates in
// ascending point index). Cells are cubes of `cell` units; points are bucketed by a hash of their integer cell
// coordinates with a counting sort, so a query visits the buckets of the cells its box touches and filters by the real
// distance (hash collisions only add candidates). Used by the symmetry partner search and Volume soft selection.
import { kernelError } from '../kernel';

const P1 = 73856093;
const P2 = 19349663;
const P3 = 83492791;

export class PointHash {
  readonly cell: number;
  readonly #mask: number;
  readonly #start: Int32Array;
  readonly #items: Int32Array;
  readonly #xyz: Float64Array;

  /**
   * `xyz` holds 3 coordinates per point; `include(i)` (default: all) picks the points to bucket. The array is read,
   * not copied: keep it unchanged while the hash is in use.
   */
  constructor(xyz: Float64Array, count: number, cell: number, include?: (i: number) => boolean) {
    if (!(cell > 0) || !Number.isFinite(cell)) {
      throw kernelError('invalid-argument', `spatial hash cell must be a positive finite size, got ${cell}`);
    }
    this.cell = cell;
    this.#xyz = xyz;
    let size = 16;
    while (size < 2 * count) size *= 2;
    this.#mask = size - 1;
    const bucket = new Int32Array(count).fill(-1);
    const start = new Int32Array(size + 1);
    for (let i = 0; i < count; i++) {
      if (include !== undefined && !include(i)) continue;
      const b = this.#bucketOf(xyz[3 * i] as number, xyz[3 * i + 1] as number, xyz[3 * i + 2] as number);
      bucket[i] = b;
      start[b + 1] = (start[b + 1] as number) + 1;
    }
    for (let b = 0; b < size; b++) start[b + 1] = (start[b + 1] as number) + (start[b] as number);
    const items = new Int32Array(start[size] as number);
    const fill = start.slice(0, size);
    for (let i = 0; i < count; i++) {
      const b = bucket[i] as number;
      if (b < 0) continue;
      items[fill[b] as number] = i;
      fill[b] = (fill[b] as number) + 1;
    }
    this.#start = start;
    this.#items = items;
  }

  #hashCell(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix | 0, P1) ^ Math.imul(iy | 0, P2) ^ Math.imul(iz | 0, P3)) & this.#mask;
  }

  #bucketOf(x: number, y: number, z: number): number {
    return this.#hashCell(Math.floor(x / this.cell), Math.floor(y / this.cell), Math.floor(z / this.cell));
  }

  /**
   * Calls `fn(i)` for every bucketed point whose cell intersects the axis-aligned box of half-size `r` around
   * (x, y, z) — a superset of the points within distance r. Points of a bucket come in ascending index; a point can
   * come more than once when two cells of the box share a bucket.
   */
  near(x: number, y: number, z: number, r: number, fn: (i: number) => void): void {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    const z0 = Math.floor((z - r) / c);
    const z1 = Math.floor((z + r) / c);
    // A huge box (r ≫ cell) degenerates to a scan of every bucket once.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > this.#mask + 1) {
      for (let k = 0; k < this.#items.length; k++) fn(this.#items[k] as number);
      return;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const b = this.#hashCell(ix, iy, iz);
          const end = this.#start[b + 1] as number;
          for (let k = this.#start[b] as number; k < end; k++) fn(this.#items[k] as number);
        }
      }
    }
  }

  /** Coordinates the hash reads (3 per point). */
  get points(): Float64Array {
    return this.#xyz;
  }
}
