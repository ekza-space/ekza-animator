// B2 benches (report only; M6A-SPEC §9 B2 Tests, §5.27): soft weights over 10k vertices (budget ≤ 2 ms; Volume and
// Surface, the E2E-MOD-10 plane), symmetry maps at 10k and 50k triangles, a component transform with soft weights and
// symmetry over 10k vertices, and the walkers on a large torus. Run: pnpm --filter @ekza-studio/mesh-core bench
import { curveEngine } from '@ekza-studio/anim-core';
import { bench, describe } from 'vitest';
import {
  BitSet,
  buildSymmetryMap,
  convertSelection,
  edgeLoop,
  edgeRing,
  editMeshFrom,
  growSelection,
  MESH_OPS,
  primitive,
  selectionOf,
  setKernelDebug,
  softWeights,
} from '../src';

setKernelDebug(false);

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
const plane10k = editMeshFrom(
  primitive('plane', { width: 10, height: 10, subdivisionsWidth: 99, subdivisionsHeight: 99 }),
);
const plane50k = editMeshFrom(primitive('plane', { subdivisionsWidth: 158, subdivisionsHeight: 158 }));
const torus = editMeshFrom(primitive('torus', { subdivisionsAxis: 128, subdivisionsHeight: 64 }));
const centre = 4950; // a vertex next to the plane's centre (99 × 99 grid of 100 × 100 vertices)
const seeds = new BitSet(plane10k.counts.points);
seeds.add(centre);
const out = new Float32Array(plane10k.counts.points);
const many = new BitSet(plane10k.counts.points);
for (let v = 0; v < plane10k.counts.points; v += 37) many.add(v);
const op = MESH_OPS['mesh.transformComponents'] as (typeof MESH_OPS)[string];
const map10k = buildSymmetryMap(plane10k, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
let sink = 0;

describe('soft weights, 10k vertices (≤ 2 ms)', () => {
  bench('Volume, one seed, r = 1.8 (E2E-MOD-10)', () => {
    sink += softWeights(plane10k, seeds, { radius: 1.8, falloff: 'volume', curve: 'smooth', placement: IDENTITY }, out)[
      centre
    ] as number;
  });
  bench('Surface, one seed, r = 1.8', () => {
    sink += softWeights(
      plane10k,
      seeds,
      { radius: 1.8, falloff: 'surface', curve: 'smooth', placement: IDENTITY },
      out,
    )[centre] as number;
  });
  bench('Volume, 271 seeds, r = 0.5', () => {
    sink += softWeights(
      plane10k,
      many,
      { radius: 0.5, falloff: 'volume', curve: 'smooth', placement: IDENTITY },
      out,
    )[0] as number;
  });
});

describe('symmetry maps', () => {
  bench('buildSymmetryMap, 10k vertices', () => {
    sink += buildSymmetryMap(plane10k, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 }).unmatched;
  });
  bench('buildSymmetryMap, 50k triangles', () => {
    sink += buildSymmetryMap(plane50k, { axis: 'x', space: 'world', placement: IDENTITY, tolerance: 0.001 }).unmatched;
  });
});

describe('transformComponents, 10k vertices', () => {
  bench('move one vertex with soft (r = 1.8) and symmetry X, with its undo', () => {
    plane10k.begin(op.id);
    op.run(
      plane10k,
      selectionOf('vertex', [centre + 20], plane10k.counts),
      { translateY: 0.5 },
      {
        symmetry: { map: map10k, preserveSeam: true },
        hidden: null,
        placement: IDENTITY,
        faceted: true,
        soft: { radius: 1.8, falloff: 'volume', curve: 'smooth' },
        curves: curveEngine,
        epsilon: 1e-9,
      },
    );
    plane10k.apply(plane10k.end(), 'backward');
  });
});

describe('walkers (torus 128 × 64: 8,192 quads)', () => {
  bench('edgeLoop + edgeRing', () => {
    sink += edgeLoop(torus, 0).length + edgeRing(torus, 1).length;
  });
  bench('grow a 100-face selection; convert it to edges (perimeter)', () => {
    const s = selectionOf(
      'face',
      Array.from({ length: 100 }, (_, i) => i),
      torus.counts,
    );
    sink += convertSelection(torus, growSelection(torus, s), 'edge', 'perimeter').edges.count();
  });
});

export const keep = (): number => sink;
