// READY gates of the mesh-core op tests (M6A-SPEC §3 rule 4): probes of what the sibling kernel packages provide, so a
// gated case turns on by itself when its package merges (INT turns every gate into a failure).
// - b2: B2's symmetry maps (`buildSymmetryMap`, `expandSelection`, `mirrorEdgePoint`; B0a stubs throw
//   `not-implemented`) — B4's symmetric cut/slide cases against B2's own maps, P10 with real maps;
// - b3: B3's core ops (`mesh.mergeByDistance` runs) — the Combine + Merge by Distance oracle;
// - b4: B4's shape ops (landed with B4's tests);
// - b13: B13's humanoid body generator (`primitive('humanoidBody', …)`), used by B2's in-seam golden.
import { EkzaError } from '@ekza-animator/anim-core';
import * as kernel from '../src';

function probe(fn: () => unknown): boolean {
  try {
    const out = fn();
    return !(kernel.isRefusal(out) && out.code === 'not-implemented');
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

const b2 = probe(() =>
  kernel.buildSymmetryMap(kernel.editMeshFrom(kernel.primitive('cube', {})), {
    axis: 'x',
    space: 'object',
    placement: IDENTITY,
    tolerance: 0.001,
  }),
);

const b3 = probe(() => {
  const m = kernel.editMeshFrom(kernel.primitive('cube', {}));
  const op = kernel.MESH_OPS['mesh.mergeByDistance'];
  if (op === undefined) return kernel.refuse('not-implemented', 'no mergeByDistance');
  m.begin('probe');
  try {
    return op.run(
      m,
      null,
      {},
      {
        symmetry: null,
        hidden: null,
        placement: IDENTITY,
        faceted: true,
        soft: null,
        curves: { compile: () => ({}) as never, evaluate: () => 0 },
        epsilon: 1e-9,
      },
    );
  } finally {
    m.abort();
  }
});

export const READY = { b2, b3, b4: true, b13: false } as const;
