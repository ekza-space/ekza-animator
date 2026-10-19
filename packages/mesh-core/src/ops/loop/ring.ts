// The edge ring walk (M6A-SPEC §5.11, research 10 §4.7): from a seed edge with a side vertex, through quads both
// ways (entering quad (x, y, z, w) across x → y, the opposite edge is z → w and the side maps x ↔ w, y ↔ z, so a
// fraction measured from the side stays straight across the ring), stopping at a border or non-manifold edge, a hidden
// or non-quad face (whose edge is still split: the new vertex joins that face), or when the ring closes. Shared by
// Insert Edge Loop (B3) and the loop placement of Connect.
import type { EditMesh, HiddenSet } from '../../types';
import { cornerOnEdge, edgeFaces, isHiddenFace } from '../extrude/shared/util';

export interface RingEdge {
  readonly e: number;
  /** The vertex fractions are measured from. */
  readonly side: number;
}

export interface RingFace {
  readonly f: number;
  /** Indices into `edges` of the two ring edges the quad joins. */
  readonly a: number;
  readonly b: number;
}

export interface Ring {
  readonly edges: readonly RingEdge[];
  readonly faces: readonly RingFace[];
  readonly closed: boolean;
}

/** The ring through `e0` with fractions measured from `side0` (an endpoint of e0). */
export function walkRing(m: EditMesh, e0: number, side0: number, hidden: HiddenSet | null): Ring {
  const edges: RingEdge[] = [{ e: e0, side: side0 }];
  const index = new Map<number, number>([[e0, 0]]);
  const faces: RingFace[] = [];
  const seen = new Set<number>();
  let closed = false;
  const startFaces = edgeFaces(m, e0);
  if (startFaces.length !== 2 && startFaces.length !== 1) return { edges, faces, closed };
  /** Walks from ring edge `fromIdx` into face f; returns the next ring edge index or −1 (stop). */
  const step = (fromIdx: number, f: number): { next: number; f: number } | null => {
    const from = edges[fromIdx] as RingEdge;
    if (seen.has(f) || isHiddenFace(hidden, f) || m.faceLen(f) !== 4) return null;
    const c = cornerOnEdge(m, f, from.e);
    if (c === -1) return null;
    const x = m.cornerVert(c);
    const c2 = m.cornerNext(m.cornerNext(c));
    const z = m.cornerVert(c2);
    const w = m.cornerVert(m.cornerNext(c2));
    const opposite = m.cornerEdge(c2);
    const side = from.side === x ? w : z;
    seen.add(f);
    const existing = index.get(opposite);
    if (existing !== undefined) {
      faces.push({ f, a: fromIdx, b: existing });
      if (existing === 0) closed = true;
      return null;
    }
    edges.push({ e: opposite, side });
    const at = edges.length - 1;
    index.set(opposite, at);
    faces.push({ f, a: fromIdx, b: at });
    const across = edgeFaces(m, opposite).filter((g) => g !== f);
    if (edgeFaces(m, opposite).length !== 2 || across.length !== 1) return null;
    return { next: at, f: across[0] as number };
  };
  // Each direction leaves through one face of the seed (a non-manifold seed walks no further).
  if (startFaces.length <= 2) {
    for (const first of startFaces) {
      if (closed) break;
      let cursor = step(0, first);
      while (cursor !== null && !closed) cursor = step(cursor.next, cursor.f);
    }
  }
  return { edges, faces, closed };
}
