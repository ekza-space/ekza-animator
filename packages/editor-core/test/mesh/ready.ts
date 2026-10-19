// READY gates of the B7 tests (M6A-SPEC §3 rule 4): probes of what the packages B7 builds on provide, so the gated
// cases turn on by themselves when those packages merge (INT turns every gate into a failure).
// - b1: B1's kernel (Euler operators, real ops, sphere/cone/torus); the B0a reference refuses or throws
//   `not-implemented` until then.
// - b10: B10's component selection service stores selections (the B0a stub's writers throw).
import { EkzaError } from '@ekza-animator/anim-core';
import * as kernel from '@ekza-animator/mesh-core';

function probe(fn: () => unknown): boolean {
  try {
    const out = fn();
    return !(kernel.isRefusal(out) && out.code === 'not-implemented');
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

/** B1 landed: the kernel builds every primitive and runs `mesh.extrude`. */
const b1 =
  probe(() => kernel.primitive('sphere', {})) &&
  probe(() => {
    const cube = kernel.editMeshFrom(kernel.primitive('cube', {}));
    const op = kernel.MESH_OPS['mesh.extrude'];
    if (op === undefined) return kernel.refuse('not-implemented', 'no extrude');
    cube.begin('probe');
    try {
      return op.run(
        cube,
        kernel.selectionOf('face', [0], cube.counts),
        {},
        {
          symmetry: null,
          hidden: null,
          placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
          faceted: true,
          soft: null,
          curves: { compile: () => ({}) as never, evaluate: () => 0 },
          epsilon: 1e-9,
        },
      );
    } finally {
      cube.abort();
    }
  });

/**
 * B1's primitives alone (sphere, cone, torus): the kernel builds them while `mesh.extrude` still waits for B3, so the
 * primitive cases gate on this probe, not on the extrude part of `b1` (B13 merge fix: with B1 merged and B3 not,
 * `b1` is false although the reference kernel is gone).
 */
const primitives = probe(() => kernel.primitive('sphere', {}));

export const READY = { b1, primitives } as const;
