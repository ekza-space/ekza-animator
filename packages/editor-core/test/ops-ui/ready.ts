// READY gates of the B11 tests (M6A-SPEC §3 rule 4, §9 B11): probes of what the packages B11's UI tests build on
// provide, so the gated cases turn on by themselves when those packages merge (INT turns every gate into a failure).
// - b3: B3's core ops (extrude, insert loop, delete) on B1's kernel;
// - b4: B4's shape ops (triangulate, mirror);
// - b5: B5's bevel;
// - b10: B10's component selection service stores selections (the B0a stub's writers throw).
import { EkzaError } from '@ekza-animator/anim-core';
import * as kernel from '@ekza-animator/mesh-core';
import { createComponentSelectionService } from '../../src';

const PLACEMENT = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

function runs(opId: string, kind: 'vertex' | 'edge' | 'face' | null, indices: readonly number[]): boolean {
  try {
    const cube = kernel.editMeshFrom(kernel.primitive('cube', {}));
    const op = kernel.MESH_OPS[opId];
    if (op === undefined) return false;
    const sel = kind === null ? null : kernel.selectionOf(kind, indices, cube.counts);
    cube.begin('probe');
    try {
      const out = op.run(
        cube,
        sel,
        {},
        {
          symmetry: null,
          hidden: null,
          placement: PLACEMENT,
          faceted: true,
          soft: null,
          curves: { compile: () => ({}) as never, evaluate: () => 0 },
          epsilon: 1e-9,
        },
      );
      return !(kernel.isRefusal(out) && out.code === 'not-implemented');
    } finally {
      cube.abort();
    }
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
}

function serviceStores(): boolean {
  try {
    const service = createComponentSelectionService({
      session: { getState: () => ({}) } as never,
      meshes: () => ({ get: () => undefined }) as never,
    });
    service.set('msh_probe' as never, kernel.selectionOf('face', [], kernel.primitive('cube', {}).counts));
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    return true;
  }
}

/** B3 landed: extrude runs on a cube face. */
const b3 = runs('mesh.extrude', 'face', [0]);
/** B4 landed: triangulate runs on a cube. */
const b4 = runs('mesh.triangulate', null, []);
/** B5 landed: bevel runs on a cube edge. */
const b5 = runs('mesh.bevel', 'edge', [0]);
const b10 = serviceStores();

export const READY = { b3, b4, b5, b10 } as const;
