// B0a stubs of B4's MeshSetOp remap helpers (M6A-SPEC §4.3, §5.13): throw until B4 lands `src/subset/**`.
import type { ReadonlyXf } from '@ekza-animator/anim-core';
import type { BitSet } from '../bitset';
import { notImplemented } from '../kernel';
import type { AppendResult, EditMesh, MeshData, SubsetResult } from '../types';

export function copySubset(
  _m: EditMesh,
  _faces: BitSet,
  _opts?: { readonly layers?: 'all' | readonly string[] },
): SubsetResult {
  throw notImplemented('copySubset');
}
/** Appends b (b-local → a-local by `xf`) into a inside a's open transaction; det(xf) < 0 reverses winding. */
export function appendMesh(
  _a: EditMesh,
  _b: MeshData,
  _xf: ReadonlyXf,
  _opts: { readonly materials: readonly [readonly string[], readonly string[]] },
): AppendResult {
  throw notImplemented('appendMesh');
}
