// Parent-pointer hierarchies in projection (research 06 R8): parents before children, siblings by fractional
// `order` then id. Cycles from concurrent reparenting are broken deterministically — the member with the smallest id
// is detached and treated as a root — so every node appears exactly once. A node whose parent is missing (deleted,
// in another rig, unopened) is a root too. Consumers can tell a detached node by its parent appearing after it.
import { compareStrings } from '../store/diff';

export interface HierarchyNode {
  readonly id: string;
  readonly parent: string | null;
  readonly order: string;
}

export function byOrderThenId(
  a: { readonly id: string; readonly order: string },
  b: { readonly id: string; readonly order: string },
): number {
  return compareStrings(a.order, b.order) || compareStrings(a.id, b.id);
}

/** Depth-first pre-order of a forest given by parent pointers, with cycles broken (see module comment). */
export function hierarchyOrder<T extends HierarchyNode>(nodes: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const node of nodes) byId.set(node.id, node);
  const parentOf = (node: T): string | null =>
    node.parent !== null && node.parent !== node.id && byId.has(node.parent) ? node.parent : null;

  // Each component of a parent-pointer graph holds at most one cycle; walk until a known node is reached.
  const detached = new Set<string>();
  const state = new Map<string, 1 | 2>(); // 1: on the current walk, 2: finished
  for (const start of nodes) {
    if (state.has(start.id)) continue;
    const walk: string[] = [];
    let current: string | null = start.id;
    while (current !== null && !state.has(current)) {
      state.set(current, 1);
      walk.push(current);
      current = parentOf(byId.get(current) as T);
    }
    if (current !== null && state.get(current) === 1) {
      const cycle = walk.slice(walk.indexOf(current));
      detached.add(cycle.reduce((min, id) => (compareStrings(id, min) < 0 ? id : min)));
    }
    for (const id of walk) state.set(id, 2);
  }

  const children = new Map<string | null, T[]>();
  for (const node of nodes) {
    const parent = detached.has(node.id) ? null : parentOf(node);
    const siblings = children.get(parent);
    if (siblings === undefined) children.set(parent, [node]);
    else siblings.push(node);
  }
  for (const siblings of children.values()) siblings.sort(byOrderThenId);

  const out: T[] = [];
  const stack: T[] = [...(children.get(null) ?? [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as T;
    out.push(node);
    const kids = children.get(node.id);
    if (kids !== undefined) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as T);
  }
  return out;
}
