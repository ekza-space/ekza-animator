// Deterministic topological sort for the rig schedule (ADR 0004 §6, research 07 §8): Kahn's algorithm that always
// emits the ready node with the smallest (priority, key), and repairs cycles by dropping, per cycle, the edge whose
// consumer key sorts greatest. The result depends only on the node keys and edges, never on insertion order.

export interface SortNode {
  readonly priority: number;
  readonly key: string;
}

export interface DroppedEdge {
  readonly from: number;
  readonly to: number;
  /** Nodes of the cycle the edge was part of, in cycle order. */
  readonly cycle: readonly number[];
}

export interface SortResult {
  readonly order: readonly number[];
  readonly dropped: readonly DroppedEdge[];
}

export function compareSortNodes(a: SortNode, b: SortNode): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** `edges` are [producer, consumer] pairs of indices into `nodes`; duplicates and self-loops are allowed. */
export function topologicalSort(nodes: readonly SortNode[], edges: readonly (readonly [number, number])[]): SortResult {
  const n = nodes.length;
  const out: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const inn: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [from, to] of edges) {
    out[from]?.add(to);
    inn[to]?.add(from);
  }
  const indegree = new Int32Array(n);
  for (let i = 0; i < n; i++) indegree[i] = (inn[i] as Set<number>).size;

  const compare = (a: number, b: number): number => compareSortNodes(nodes[a] as SortNode, nodes[b] as SortNode);
  const ready = new IndexHeap(compare);
  for (let i = 0; i < n; i++) if (indegree[i] === 0) ready.push(i);

  const done = new Uint8Array(n);
  const order: number[] = [];
  const dropped: DroppedEdge[] = [];
  const removeEdge = (from: number, to: number): void => {
    (out[from] as Set<number>).delete(to);
    (inn[to] as Set<number>).delete(from);
    indegree[to] = (indegree[to] as number) - 1;
    if (indegree[to] === 0) ready.push(to);
  };

  while (order.length < n) {
    if (ready.size === 0) {
      const cycle = findCycle(n, done, inn, compare);
      // Edges of the cycle are (cycle[i] → cycle[i + 1]); drop the one whose consumer sorts greatest.
      let best = 0;
      for (let i = 1; i < cycle.length; i++) {
        if (compare(cycle[(i + 1) % cycle.length] as number, cycle[(best + 1) % cycle.length] as number) > 0) best = i;
      }
      const from = cycle[best] as number;
      const to = cycle[(best + 1) % cycle.length] as number;
      dropped.push({ from, to, cycle });
      removeEdge(from, to);
      continue;
    }
    const next = ready.pop();
    done[next] = 1;
    order.push(next);
    for (const to of out[next] as Set<number>) {
      indegree[to] = (indegree[to] as number) - 1;
      if (indegree[to] === 0) ready.push(to);
    }
  }
  return { order, dropped };
}

/**
 * A cycle among the unfinished nodes (every one has an unfinished producer when nothing is ready): start at the
 * smallest unfinished node and keep stepping to its smallest unfinished producer until a node repeats.
 */
function findCycle(
  n: number,
  done: Uint8Array,
  inn: readonly Set<number>[],
  compare: (a: number, b: number) => number,
): number[] {
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (done[i] === 0 && (start === -1 || compare(i, start) < 0)) start = i;
  }
  const seen = new Map<number, number>();
  const path: number[] = [];
  let current = start;
  while (!seen.has(current)) {
    seen.set(current, path.length);
    path.push(current);
    let producer = -1;
    for (const from of inn[current] as Set<number>) {
      if (done[from] === 0 && (producer === -1 || compare(from, producer) < 0)) producer = from;
    }
    current = producer;
  }
  // The walk followed producers, so reverse it to get edges in producer → consumer order.
  return path.slice(seen.get(current)).reverse();
}

/** Binary min-heap of indices under a comparator. */
class IndexHeap {
  private readonly items: number[] = [];

  constructor(private readonly compare: (a: number, b: number) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(value: number): void {
    const items = this.items;
    items.push(value);
    let i = items.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.compare(items[up] as number, value) <= 0) break;
      items[i] = items[up] as number;
      i = up;
    }
    items[i] = value;
  }

  pop(): number {
    const items = this.items;
    const top = items[0] as number;
    const last = items.pop() as number;
    if (items.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= items.length) break;
        const right = left + 1;
        const child =
          right < items.length && this.compare(items[right] as number, items[left] as number) < 0 ? right : left;
        if (this.compare(items[child] as number, last) >= 0) break;
        items[i] = items[child] as number;
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}
