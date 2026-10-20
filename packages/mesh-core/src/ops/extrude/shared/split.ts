// Edge points and face chords for the loop-style ops (M6A-SPEC §5.11: Insert Edge Loop's multiple loops, Offset Edge
// Loop, Connect): split each edge at its parameters (largest first, so the edge keeps running from edgeVert(e, 0);
// every new vertex lies exactly at the lerp of the edge's original endpoints), and cut chords between two vertices in
// the face piece that holds both (non-adjacent). Chord flags follow H1 of the original face (hard iff every edge of
// that face was hard before the op).
import { EDGE_HARD } from '../../../constants';
import type { EditMesh } from '../../../types';
import { cornerAt, lerp3, pos, setPos, vertCorners } from './util';

/** Splits edge e at the parameters `u` (from edgeVert(e, 0), 0…1, deduplicated); returns u → vertex. */
export function splitEdgeAt(m: EditMesh, e: number, u: readonly number[]): Map<number, number> {
  const out = new Map<number, number>();
  const pa = pos(m, m.edgeVert(e, 0));
  const pb = pos(m, m.edgeVert(e, 1));
  const params = [...new Set(u.map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => y - x);
  let span = 1;
  for (const t of params) {
    const v = m.splitEdgeMakeVert(e, span > 0 ? t / span : 0);
    setPos(m, v, lerp3(pa, pb, t));
    out.set(t, v);
    span = t;
  }
  return out;
}

/**
 * Cuts a chord between vertices a and b in the face that holds both as non-adjacent corners; returns the chord edge
 * (or −1 when no face holds both, or they are already joined).
 */
export function cutChord(m: EditMesh, a: number, b: number): number {
  if (a === b || m.findEdge(a, b) !== -1) return -1;
  for (const c of vertCorners(m, a)) {
    const g = m.cornerFace(c);
    const d = cornerAt(m, g, b);
    if (d === -1 || m.cornerNext(c) === d || m.cornerNext(d) === c) continue;
    return m.splitFaceMakeEdge(g, c, d);
  }
  return -1;
}

/** Sets the H1 verdict of a chord (keeping its other flag bits). */
export function setChordHard(m: EditMesh, e: number, hard: boolean): void {
  const flags = m.edgeFlags(e);
  const next = hard ? flags | EDGE_HARD : flags & ~EDGE_HARD;
  if (next !== flags) m.setEdgeFlags(e, next);
}
