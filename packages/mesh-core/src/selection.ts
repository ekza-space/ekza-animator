// Component selections as kernel values (M6A-SPEC §4.3, §12.2 S2). Eager-safe.
import { EkzaError } from '@ekza-animator/anim-core';
import { BitSet } from './bitset';
import type { ComponentKind, ComponentSelection, MeshCounts } from './types';

/**
 * A selection of `kind` holding `indices` (pick order kept in `order`, duplicates dropped; the last pick is
 * `active`), with empty bitsets of the mesh's sizes for the other kinds. Out-of-range indices throw
 * `EkzaError('out-of-range')`.
 */
export function selectionOf(kind: ComponentKind, indices: ArrayLike<number>, counts: MeshCounts): ComponentSelection {
  const verts = new BitSet(counts.points);
  const edges = new BitSet(counts.edges);
  const faces = new BitSet(counts.faces);
  const target = kind === 'vertex' ? verts : kind === 'edge' ? edges : faces;
  const order: number[] = [];
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i] as number;
    if (!Number.isInteger(index) || index < 0 || index >= target.size) {
      throw new EkzaError('out-of-range', `selectionOf: ${kind} ${index} is outside 0…${target.size - 1}`);
    }
    if (target.has(index)) continue;
    target.add(index);
    order.push(index);
  }
  return {
    kind,
    verts,
    edges,
    faces,
    order: order.length === 0 ? null : Uint32Array.from(order),
    active: order.length === 0 ? -1 : (order.at(-1) as number),
  };
}
