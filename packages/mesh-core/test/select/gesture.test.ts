// Maya's loop table (M6A-SPEC §5.6) through `loopGesture`: every row in edge, vertex and face mode on the torus, the
// tie rule, the plain-Shift fallback and the `Mod`-double run removal (E2E-MOD-26 asserts the same through the UI).
import { describe, expect, it } from 'vitest';
import { type ComponentSelection, edgeLoop, edgeRing, faceLoop, loopGesture, vertexLoop } from '../../src';
import { faceVerts, hiddenSet, membersOf, mesh, sel, sorted } from './fixtures';

const torus = (): ReturnType<typeof mesh> => mesh('torus'); // 72/144/72

/** A selection of `kind` built from picks in order, with extra bits of the other kinds (per-mode memory). */
function picks(
  m: ReturnType<typeof mesh>,
  kind: 'vertex' | 'edge' | 'face',
  items: readonly number[],
): ComponentSelection {
  const s = sel(m, kind, items);
  if (kind !== 'edge') s.edges.add(7);
  if (kind !== 'face') s.faces.add(3);
  return s;
}

describe('edge mode', () => {
  it('double-click: the edge loop replaces the selection; the clicked edge is active', () => {
    const m = torus();
    const after = loopGesture(m, picks(m, 'edge', [40, 41]), 'edge', 0, 'double');
    expect(after.kind).toBe('edge');
    expect(sorted(membersOf(after))).toEqual(sorted(edgeLoop(m, 0)));
    expect(after.active).toBe(0);
    expect(membersOf(after, 'face')).toEqual([3]);
  });

  it('Shift+double-click on the next edge of the reference loop: the full loop is added', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const after = loopGesture(m, picks(m, 'edge', [99, 0]), 'edge', loop[1] as number, 'shift-double');
    expect(sorted(membersOf(after))).toEqual(sorted([...loop, 99]));
    expect(after.active).toBe(loop[1]);
    expect(after.order?.[after.order.length - 1]).toBe(loop[1]);
    // Closed loops: the edge before the reference (wrapping) is adjacent too.
    const wrap = loopGesture(m, picks(m, 'edge', [0]), 'edge', loop.at(-1) as number, 'shift-double');
    expect(sorted(membersOf(wrap))).toEqual(sorted(loop));
  });

  it('Shift+double-click on a non-adjacent edge of the loop: the shorter arc; ties run towards edgeVert(ref, 1)', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const n = loop.length;
    const arc = loopGesture(m, picks(m, 'edge', [0]), 'edge', loop[3] as number, 'shift-double');
    expect(sorted(membersOf(arc))).toEqual(sorted(loop.slice(0, 4)));
    expect(Array.from(arc.order ?? [])).toEqual(loop.slice(0, 4));
    const back = loopGesture(m, picks(m, 'edge', [0]), 'edge', loop[n - 2] as number, 'shift-double');
    expect(sorted(membersOf(back))).toEqual(sorted([0, loop[n - 1] as number, loop[n - 2] as number]));
    // A tie (the clicked edge opposite the reference): the arc that starts towards edgeVert(0, 1).
    const tie = loopGesture(m, picks(m, 'edge', [0]), 'edge', loop[n / 2] as number, 'shift-double');
    expect(sorted(membersOf(tie))).toEqual(sorted(loop.slice(0, n / 2 + 1)));
    expect([m.edgeVert(loop[1] as number, 0), m.edgeVert(loop[1] as number, 1)]).toContain(m.edgeVert(0, 1));
  });

  it('Shift+double-click on a parallel edge (same ring): the full ring', () => {
    const m = torus();
    const ring = Array.from(edgeRing(m, 0));
    const after = loopGesture(m, picks(m, 'edge', [0]), 'edge', ring[2] as number, 'shift-double');
    expect(sorted(membersOf(after))).toEqual(sorted(ring));
    expect(after.active).toBe(ring[2]);
  });

  it('no common loop or ring, or no reference: a plain Shift toggle', () => {
    const m = torus();
    const loop = new Set(edgeLoop(m, 0));
    const ring = new Set(edgeRing(m, 0));
    const other = [...Array(m.counts.edges).keys()].find((e) => !loop.has(e) && !ring.has(e)) as number;
    const added = loopGesture(m, picks(m, 'edge', [0]), 'edge', other, 'shift-double');
    expect(sorted(membersOf(added))).toEqual(sorted([0, other]));
    expect(added.active).toBe(other);
    const removed = loopGesture(m, added, 'edge', other, 'shift-double');
    expect(membersOf(removed)).toEqual([0]);
    expect(removed.active).toBe(0);
    // The reference is the active component of the same mode only: a face selection gives none.
    const fromFaces = loopGesture(m, picks(m, 'face', [1]), 'edge', 5, 'shift-double');
    expect(membersOf(fromFaces)).toEqual(sorted([5, 7]));
  });

  it('Mod+double-click removes the contiguous selected run along the loop (whole loop or up to its ends)', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const full = loopGesture(m, picks(m, 'edge', [...loop, 77]), 'edge', loop[2] as number, 'mod-double');
    expect(membersOf(full)).toEqual([77]);
    // A partial run [1..4] plus a separate selected edge of the same loop (7): only the run goes.
    const partial = picks(m, 'edge', [loop[1], loop[2], loop[3], loop[4], loop[7]] as number[]);
    const after = loopGesture(m, partial, 'edge', loop[3] as number, 'mod-double');
    expect(membersOf(after)).toEqual([loop[7]]);
    // On an unselected edge: nothing to remove.
    const none = loopGesture(m, partial, 'edge', loop[9] as number, 'mod-double');
    expect(sorted(membersOf(none))).toEqual(sorted(membersOf(partial)));
  });
});

describe('vertex mode', () => {
  it('double-click selects the vertex only (no loop)', () => {
    const m = torus();
    const after = loopGesture(m, picks(m, 'vertex', [5, 6]), 'vertex', 9, 'double');
    expect(membersOf(after)).toEqual([9]);
    expect(after.active).toBe(9);
  });

  it('Shift+double-click: adjacent → the full vertex loop along the joining edge; same loop → the shorter arc', () => {
    const m = torus();
    const e = m.vertEdge(0);
    const u = m.edgeOther(e, 0);
    const loop = Array.from(vertexLoop(m, 0, e));
    const full = loopGesture(m, picks(m, 'vertex', [0]), 'vertex', u, 'shift-double');
    expect(sorted(membersOf(full))).toEqual(sorted(loop));
    const arc = loopGesture(m, picks(m, 'vertex', [0]), 'vertex', loop[3] as number, 'shift-double');
    expect(sorted(membersOf(arc))).toEqual(sorted(loop.slice(0, 4)));
    expect(arc.active).toBe(loop[3]);
  });

  it('Mod+double-click removes the selected run on the loop holding it', () => {
    const m = torus();
    const e = m.vertEdge(0);
    const loop = Array.from(vertexLoop(m, 0, e));
    const s = picks(m, 'vertex', [...loop.slice(0, 5)]);
    const after = loopGesture(m, s, 'vertex', loop[2] as number, 'mod-double');
    expect(membersOf(after)).toEqual([]);
  });
});

describe('face mode', () => {
  it('double-click selects the face; Shift+double-click: adjacent → full face loop, same loop → arc', () => {
    const m = torus();
    expect(membersOf(loopGesture(m, picks(m, 'face', [4]), 'face', 9, 'double'))).toEqual([9]);
    const vs = faceVerts(m, 0);
    const across = m.findEdge(vs[0] as number, vs[1] as number);
    const loop = Array.from(faceLoop(m, 0, across));
    const neighbour = loop[1] as number;
    const full = loopGesture(m, picks(m, 'face', [0]), 'face', neighbour, 'shift-double');
    expect(sorted(membersOf(full))).toEqual(sorted(loop));
    const arc = loopGesture(m, picks(m, 'face', [0]), 'face', loop[3] as number, 'shift-double');
    expect(sorted(membersOf(arc))).toEqual(sorted(loop.slice(0, 4)));
  });

  it('Mod+double-click removes the selected face run', () => {
    const m = torus();
    const vs = faceVerts(m, 0);
    const loop = Array.from(faceLoop(m, 0, m.findEdge(vs[0] as number, vs[1] as number)));
    const after = loopGesture(m, picks(m, 'face', loop), 'face', loop[1] as number, 'mod-double');
    expect(membersOf(after)).toEqual([]);
  });
});

describe('hidden components and caller errors', () => {
  it('a loop through hidden edges stops at them; a gesture on a hidden component changes nothing', () => {
    const m = torus();
    const loop = Array.from(edgeLoop(m, 0));
    const hidden = hiddenSet(m, { edges: [loop[3] as number] });
    const after = loopGesture(m, picks(m, 'edge', []), 'edge', 0, 'double', hidden);
    expect(membersOf(after)).not.toContain(loop[3]);
    expect(membersOf(after).length).toBe(loop.length - 1);
    const onHidden = loopGesture(m, picks(m, 'edge', [0]), 'edge', loop[3] as number, 'double', hidden);
    expect(membersOf(onHidden)).toEqual([0]);
  });

  it('out-of-range components and unknown gestures throw', () => {
    const m = torus();
    expect(() => loopGesture(m, picks(m, 'edge', []), 'edge', 999, 'double')).toThrow(
      expect.objectContaining({ code: 'out-of-range' }),
    );
    expect(() => loopGesture(m, picks(m, 'edge', []), 'edge', 0, 'triple' as never)).toThrow(
      expect.objectContaining({ code: 'invalid-argument' }),
    );
  });
});
