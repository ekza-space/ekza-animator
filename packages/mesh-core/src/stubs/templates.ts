// B0a stub of B13's humanoid body generator (M6A-SPEC §4.3, §5.16): throws until B13 lands `src/templates/**`.
import { notImplemented } from '../kernel';
import type { MeshData } from '../types';

export function humanoidBody(_params: { readonly style: 'smooth' | 'segmented'; readonly height: number }): MeshData {
  throw notImplemented('humanoidBody');
}
