// Soft-selection weights (M6A-SPEC §5.15, research 13 §5.15): w = f(d / r) per vertex, with d the **world-space**
// distance to the nearest seed — Euclidean (Volume; integer spatial hash over the seeds, cell = r) or geodesic along
// visible edges (Surface; Dijkstra from every seed at once, cut at r). Seeds (the expanded selected vertices) weigh 1,
// vertices beyond r and hidden vertices 0; hidden seeds and hidden edges carry nothing. Deterministic: ties break by
// vertex index and every loop runs in index order.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { BitSet } from '../bitset';
import { kernelError } from '../kernel';
import { PointHash } from '../symmetry/hash';
import { placementAffine, transformPositions } from '../symmetry/space';
import type { EditMesh, HiddenSet, SoftContext } from '../types';
import { falloffFunction } from './falloff';

export function softWeights(
  m: EditMesh,
  seeds: BitSet,
  ctx: SoftContext & { readonly placement: ReadonlyXf; readonly hidden?: HiddenSet | null },
  out?: Float32Array,
): Float32Array {
  const radius = ctx.radius;
  if (!(radius >= 0) || !Number.isFinite(radius)) {
    throw kernelError('invalid-argument', `soft-selection radius must be a finite distance ≥ 0, got ${radius}`);
  }
  if (ctx.falloff !== 'volume' && ctx.falloff !== 'surface') {
    throw kernelError(
      'invalid-argument',
      `soft-selection falloff must be 'volume' or 'surface', got ${String(ctx.falloff)}`,
    );
  }
  const f = falloffFunction(ctx.curve);
  const n = m.counts.points;
  const w = out !== undefined && out.length >= n ? out : new Float32Array(n);
  w.fill(0, 0, n);
  const hidden = ctx.hidden ?? null;
  const visible = (v: number): boolean => hidden === null || !hidden.verts.has(v);
  const seedList: number[] = [];
  seeds.forEach((v) => {
    if (v < n && visible(v)) seedList.push(v);
  });
  if (seedList.length === 0) return w;
  for (const v of seedList) w[v] = 1;
  if (radius === 0) return w;
  const world = transformPositions(m.position, n, placementAffine(ctx.placement));
  const weigh = (d: number): number => (d > radius ? 0 : f(d / radius));
  if (ctx.falloff === 'volume') volume(world, n, seeds, seedList, radius, visible, weigh, w);
  else surface(m, world, seeds, seedList, radius, hidden, visible, weigh, w);
  return w;
}

function volume(
  world: Float64Array,
  n: number,
  seeds: BitSet,
  seedList: readonly number[],
  radius: number,
  visible: (v: number) => boolean,
  weigh: (d: number) => number,
  w: Float32Array,
): void {
  // Bucket only the seeds; a 0-size cell would be degenerate, the radius is > 0 here.
  const seedXyz = new Float64Array(3 * seedList.length);
  for (let k = 0; k < seedList.length; k++) {
    const v = seedList[k] as number;
    seedXyz[3 * k] = world[3 * v] as number;
    seedXyz[3 * k + 1] = world[3 * v + 1] as number;
    seedXyz[3 * k + 2] = world[3 * v + 2] as number;
  }
  const hash = new PointHash(seedXyz, seedList.length, radius);
  const r2 = radius * radius;
  for (let v = 0; v < n; v++) {
    if (seeds.has(v) || !visible(v)) continue;
    const x = world[3 * v] as number;
    const y = world[3 * v + 1] as number;
    const z = world[3 * v + 2] as number;
    let best = Number.POSITIVE_INFINITY;
    hash.near(x, y, z, radius, (k) => {
      const dx = (seedXyz[3 * k] as number) - x;
      const dy = (seedXyz[3 * k + 1] as number) - y;
      const dz = (seedXyz[3 * k + 2] as number) - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    });
    if (best <= r2) w[v] = weigh(Math.sqrt(best));
  }
}

/** Binary min-heap of (distance, vertex) with ties to the smaller vertex. */
class Heap {
  readonly #d: number[] = [];
  readonly #v: number[] = [];
  get size(): number {
    return this.#v.length;
  }
  #less(i: number, j: number): boolean {
    const a = this.#d[i] as number;
    const b = this.#d[j] as number;
    return a < b || (a === b && (this.#v[i] as number) < (this.#v[j] as number));
  }
  #swap(i: number, j: number): void {
    const d = this.#d[i] as number;
    const v = this.#v[i] as number;
    this.#d[i] = this.#d[j] as number;
    this.#v[i] = this.#v[j] as number;
    this.#d[j] = d;
    this.#v[j] = v;
  }
  push(d: number, v: number): void {
    this.#d.push(d);
    this.#v.push(v);
    let i = this.#v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#less(i, p)) break;
      this.#swap(i, p);
      i = p;
    }
  }
  /** Pops the smallest entry into `out` ([distance, vertex]). */
  pop(out: [number, number]): void {
    out[0] = this.#d[0] as number;
    out[1] = this.#v[0] as number;
    const lastD = this.#d.pop() as number;
    const lastV = this.#v.pop() as number;
    if (this.#v.length === 0) return;
    this.#d[0] = lastD;
    this.#v[0] = lastV;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let s = i;
      if (l < this.#v.length && this.#less(l, s)) s = l;
      if (r < this.#v.length && this.#less(r, s)) s = r;
      if (s === i) return;
      this.#swap(i, s);
      i = s;
    }
  }
}

function surface(
  m: EditMesh,
  world: Float64Array,
  seeds: BitSet,
  seedList: readonly number[],
  radius: number,
  hidden: HiddenSet | null,
  visible: (v: number) => boolean,
  weigh: (d: number) => number,
  w: Float32Array,
): void {
  const n = m.counts.points;
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const done = new Uint8Array(n);
  const heap = new Heap();
  for (const v of seedList) {
    dist[v] = 0;
    heap.push(0, v);
  }
  const top: [number, number] = [0, 0];
  while (heap.size > 0) {
    heap.pop(top);
    const [d, v] = top;
    if (done[v] === 1 || d > (dist[v] as number)) continue;
    done[v] = 1;
    const first = m.vertEdge(v);
    if (first < 0) continue;
    let e = first;
    let guard = 0;
    do {
      if (hidden === null || !hidden.edges.has(e)) {
        const u = m.edgeOther(e, v);
        if (done[u] === 0 && visible(u)) {
          const dx = (world[3 * u] as number) - (world[3 * v] as number);
          const dy = (world[3 * u + 1] as number) - (world[3 * v + 1] as number);
          const dz = (world[3 * u + 2] as number) - (world[3 * v + 2] as number);
          const nd = d + Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (nd <= radius && nd < (dist[u] as number)) {
            dist[u] = nd;
            heap.push(nd, u);
          }
        }
      }
      e = m.edgeDiskNext(e, v);
    } while (e !== first && e >= 0 && ++guard <= m.counts.edges);
  }
  for (let v = 0; v < n; v++) {
    if (seeds.has(v) || done[v] === 0) continue;
    w[v] = weigh(dist[v] as number);
  }
}
