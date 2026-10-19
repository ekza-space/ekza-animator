// Maya's loop table (M6A-SPEC §5.6) as a pure function. `sel` is the selection **before** the gesture (the first
// click of the double-click is not applied); the reference is its active component when `sel.kind === kind`.
//
// | gesture      | vertex                                   | edge                                   | face                                  |
// |--------------|------------------------------------------|----------------------------------------|---------------------------------------|
// | double       | select the vertex (replaces)             | the edge loop (replaces)               | select the face (replaces)            |
// | shift-double | adjacent: the full vertex loop along the | the clicked edge continues the         | adjacent: the full face loop across   |
// |              | joining edge; same loop: the partial     | reference's loop: the full loop; same  | the shared edge; same loop: the       |
// |              | loop (shorter arc)                       | loop: the partial loop; same ring: the | partial loop                          |
// |              |                                          | full ring                              |                                       |
// | mod-double   | deselect the contiguous selected run along the loop through the clicked component (vertices and faces: the
// |              | loop with the longest run; a full selected loop goes entirely, a partial one up to its ends)          |
//
// A shift-double without a common loop (or ring) acts as a plain Shift toggle. Added components follow in loop order
// (partial loops from the reference to the click) and the clicked component becomes the active one.
import { BitSet } from '../bitset';
import { kernelError } from '../kernel';
import type { ComponentKind, ComponentSelection, EditMesh, HiddenSet, LoopGesture } from '../types';
import {
  checkIndex,
  countOf,
  forEachEdgeCorner,
  forEachFaceCorner,
  type Hidden,
  hiddenEdge,
  isHidden,
  resultSelection,
  setOf,
  sizedClone,
} from './common';
import {
  arcOf,
  edgeLoopWalk,
  edgeRingWalk,
  faceLoopWalk,
  loopsThrough,
  partialLoop,
  vertexLoopWalk,
  type Walk,
} from './loops';

/** The visible members of a walk as a list. */
const visibleItems = (walk: Walk, kind: ComponentKind, hidden: Hidden): number[] =>
  walk.items.filter((i) => !isHidden(hidden, kind, i));

function add(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  items: readonly number[],
  active: number,
): ComponentSelection {
  const set = sizedClone(setOf(sel, kind), countOf(m, kind));
  const added: number[] = [];
  for (const i of items) {
    if (set.has(i)) continue;
    set.add(i);
    added.push(i);
  }
  return resultSelection(m, sel, kind, set, added, active);
}

function toggle(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  c: number,
  hidden: Hidden,
): ComponentSelection {
  const set = sizedClone(setOf(sel, kind), countOf(m, kind));
  if (set.has(c)) {
    set.delete(c);
    return resultSelection(m, sel, kind, set, [], sel.kind === kind && sel.active !== c ? sel.active : -1);
  }
  if (isHidden(hidden, kind, c)) return resultSelection(m, sel, kind, set, [], sel.kind === kind ? sel.active : -1);
  set.add(c);
  return resultSelection(m, sel, kind, set, [c], c);
}

function replace(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  items: readonly number[],
  active: number,
): ComponentSelection {
  const set = new BitSet(countOf(m, kind));
  for (const i of items) set.add(i);
  const fresh: ComponentSelection = { ...sel, kind, order: null, active: -1 };
  return resultSelection(m, fresh, kind, set, items, active);
}

/** The shared edge of two faces (smallest index), or −1. */
function sharedEdge(m: EditMesh, a: number, b: number): number {
  let found = -1;
  forEachFaceCorner(m, a, (c) => {
    const e = m.cornerEdge(c);
    forEachEdgeCorner(m, e, (r) => {
      if (m.cornerFace(r) === b && (found < 0 || e < found)) found = e;
    });
  });
  return found;
}

function shiftDouble(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  c: number,
  hidden: Hidden,
): ComponentSelection {
  const r = sel.kind === kind ? sel.active : -1;
  if (r < 0 || r === c || r >= countOf(m, kind) || isHidden(hidden, kind, c)) return toggle(m, sel, kind, c, hidden);
  if (kind === 'edge') {
    const loop = edgeLoopWalk(m, r, hidden);
    const ir = loop.items.indexOf(r);
    const ic = loop.items.indexOf(c);
    if (ir >= 0 && ic >= 0) {
      const n = loop.items.length;
      const adjacent = Math.abs(ic - ir) === 1 || (loop.closed && Math.abs(ic - ir) === n - 1);
      return add(m, sel, kind, adjacent ? visibleItems(loop, kind, hidden) : arcOf(loop, ir, ic), c);
    }
    const ring = edgeRingWalk(m, r, hidden);
    if (ring.items.includes(c)) return add(m, sel, kind, visibleItems(ring, kind, hidden), c);
    return toggle(m, sel, kind, c, hidden);
  }
  if (kind === 'vertex') {
    const e = m.findEdge(r, c);
    if (e >= 0 && !hiddenEdge(hidden, e)) {
      const loop = vertexLoopWalk(m, r, e, hidden);
      if (loop.items.includes(c)) return add(m, sel, kind, loop.items, c);
    }
  } else {
    const s = sharedEdge(m, r, c);
    if (s >= 0) {
      const loop = faceLoopWalk(m, r, s, hidden);
      if (loop.items.includes(c)) return add(m, sel, kind, loop.items, c);
    }
  }
  const arc = partialLoop(m, r, c, kind, hidden);
  if (arc !== null) return add(m, sel, kind, Array.from(arc), c);
  return toggle(m, sel, kind, c, hidden);
}

/** The contiguous run of `set` members around position `at` of a walk (the whole walk when it is all selected). */
function runAround(walk: Walk, at: number, set: BitSet): number[] {
  const items = walk.items;
  const n = items.length;
  const inSet = (i: number): boolean => set.has(items[i] as number);
  if (!inSet(at)) return [];
  let lo = at;
  let hi = at;
  let length = 1;
  if (walk.closed) {
    while (length < n && inSet((lo - 1 + n) % n)) {
      lo = (lo - 1 + n) % n;
      length++;
    }
    while (length < n && inSet((hi + 1) % n)) {
      hi = (hi + 1) % n;
      length++;
    }
    const out: number[] = [];
    for (let k = 0, i = lo; k < length; k++, i = (i + 1) % n) out.push(items[i] as number);
    return out;
  }
  while (lo > 0 && inSet(lo - 1)) lo--;
  while (hi < n - 1 && inSet(hi + 1)) hi++;
  return items.slice(lo, hi + 1);
}

function modDouble(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  c: number,
  hidden: Hidden,
): ComponentSelection {
  const set = sizedClone(setOf(sel, kind), countOf(m, kind));
  let run: number[] = [];
  if (set.has(c)) {
    for (const walk of loopsThrough(m, c, kind, hidden)) {
      const at = walk.items.indexOf(c);
      if (at < 0) continue;
      const candidate = runAround(walk, at, set);
      if (candidate.length > run.length) run = candidate;
    }
    if (run.length === 0) run = [c];
  }
  for (const i of run) set.delete(i);
  const active = sel.kind === kind && set.has(sel.active) ? sel.active : -1;
  return resultSelection(m, sel, kind, set, [], active);
}

/** Maya's loop table (§5.6) as a pure function: the selection after the gesture on `component` of `kind`. */
export function loopGesture(
  m: EditMesh,
  sel: ComponentSelection,
  kind: ComponentKind,
  component: number,
  gesture: LoopGesture,
  hidden?: HiddenSet | null,
): ComponentSelection {
  checkIndex(m, kind, component);
  switch (gesture) {
    case 'double': {
      if (isHidden(hidden, kind, component))
        return resultSelection(m, sel, kind, sizedClone(setOf(sel, kind), countOf(m, kind)), [], -1);
      const items = kind === 'edge' ? visibleItems(edgeLoopWalk(m, component, hidden), kind, hidden) : [component];
      return replace(m, sel, kind, items, component);
    }
    case 'shift-double':
      return shiftDouble(m, sel, kind, component, hidden);
    case 'mod-double':
      return modDouble(m, sel, kind, component, hidden);
    default:
      throw kernelError(
        'invalid-argument',
        `loop gesture must be double, shift-double or mod-double, got ${String(gesture)}`,
      );
  }
}
