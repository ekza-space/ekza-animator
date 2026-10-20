// B2 goldens (M6A-SPEC §9 B2 Tests, §5.29 P6): the exact index lists of the walkers, the loop table, grow/shrink/
// convert, the symmetry maps and pointer-rule samples, soft weights and transform results (manifest ids). Shared by
// the Node test (which keeps test/goldens/mesh-select.json) and the Chromium test (which compares against it); no
// Node APIs here.
import { curveEngine, sha256Hex } from '@ekza-animator/anim-core';
import {
  BitSet,
  buildSymmetryMap,
  type ComponentKind,
  convertSelection,
  edgeLoop,
  edgeRing,
  type EditMesh,
  editMeshFrom,
  expandSelection,
  faceLoop,
  growSelection,
  isRefusal,
  loopGesture,
  MESH_OPS,
  mirrorEdgePoint,
  partialLoop,
  primitive,
  shrinkSelection,
  softWeights,
  vertexLoop,
  writeRevision,
} from '../../src';
import { rounded } from '../../src/testing';
import { hiddenSet, IDENTITY, sel } from './fixtures';

const list = (xs: ArrayLike<number> | null): number[] | null => (xs === null ? null : Array.from(xs));
const bits = (set: BitSet): number[] => Array.from(set.toArray());
const digest = (values: ArrayLike<number>): string =>
  sha256Hex(new TextEncoder().encode(JSON.stringify(rounded(values, 6))));

function walkers(name: string, m: EditMesh, out: Record<string, unknown>, seeds: readonly number[]): void {
  for (const e of seeds) {
    out[`${name}/edgeLoop/${e}`] = list(edgeLoop(m, e));
    out[`${name}/edgeRing/${e}`] = list(edgeRing(m, e));
    const v = m.edgeVert(e, 0);
    out[`${name}/vertexLoop/${v}/${e}`] = list(vertexLoop(m, v, e));
    const c = m.edgeCorner(e);
    if (c >= 0) out[`${name}/faceLoop/${m.cornerFace(c)}/${e}`] = list(faceLoop(m, m.cornerFace(c), e));
  }
}

export function b2GoldenValues(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cube = editMeshFrom(primitive('cube', {}));
  const cyl = editMeshFrom(primitive('cylinder', { subdivisionsHeight: 3 }));
  const torus = editMeshFrom(primitive('torus', {}));
  const sphere = editMeshFrom(primitive('sphere', {}));
  const plane = editMeshFrom(primitive('plane', { subdivisionsWidth: 3, subdivisionsHeight: 3 }));
  walkers('cube', cube, out, [0, 5, 11]);
  walkers('cylinder', cyl, out, [0, 1, 2, 3, 24, 40]);
  walkers('torus', torus, out, [0, 1, 2, 3, 77]);
  walkers('sphere', sphere, out, [0, 13, 50, 100]);
  walkers('plane', plane, out, [0, 1, 7, 12]);

  // Partial loops (edges, vertices, faces) on the torus; hidden stops.
  const loop0 = Array.from(edgeLoop(torus, 0));
  out['torus/partial/edge'] = list(partialLoop(torus, 0, loop0[4] as number, 'edge'));
  out['torus/partial/edge-tie'] = list(partialLoop(torus, 0, loop0[loop0.length / 2] as number, 'edge'));
  out['torus/partial/vertex'] = list(partialLoop(torus, 0, 3, 'vertex'));
  out['torus/partial/face'] = list(partialLoop(torus, 0, 4, 'face'));
  const hidden = hiddenSet(torus, { edges: [loop0[5] as number], verts: [9], faces: [20] });
  for (const e of [0, 1, 2, 3]) {
    out[`torus/hidden/edgeLoop/${e}`] = list(edgeLoop(torus, e, hidden));
    out[`torus/hidden/edgeRing/${e}`] = list(edgeRing(torus, e, hidden));
  }

  // The loop table.
  const gestures: readonly [ComponentKind, readonly number[], number, 'double' | 'shift-double' | 'mod-double'][] = [
    ['edge', [], 0, 'double'],
    ['edge', [0], loop0[1] as number, 'shift-double'],
    ['edge', [0], loop0[4] as number, 'shift-double'],
    ['edge', [0], edgeRing(torus, 0)[2] as number, 'shift-double'],
    ['edge', loop0, loop0[3] as number, 'mod-double'],
    ['vertex', [0], 1, 'shift-double'],
    ['vertex', [0], 3, 'shift-double'],
    ['face', [0], 1, 'shift-double'],
    ['face', [0], 4, 'shift-double'],
  ];
  gestures.forEach(([kind, picks, c, g], i) => {
    const after = loopGesture(torus, sel(torus, kind, picks), kind, c, g);
    const set = kind === 'vertex' ? after.verts : kind === 'edge' ? after.edges : after.faces;
    out[`torus/gesture/${i}`] = { members: bits(set), order: list(after.order), active: after.active };
  });

  // Grow, shrink, convert.
  const grid = editMeshFrom(primitive('plane', { subdivisionsWidth: 4, subdivisionsHeight: 4 }));
  out['grid/grow/vertex'] = bits(growSelection(grid, sel(grid, 'vertex', [12])).verts);
  out['grid/grow/face'] = bits(growSelection(grid, sel(grid, 'face', [5])).faces);
  out['grid/shrink/face'] = bits(shrinkSelection(grid, growSelection(grid, sel(grid, 'face', [5]))).faces);
  for (const mode of ['touching', 'contained', 'perimeter', 'border', 'shell', 'loop', 'ring'] as const) {
    for (const to of ['vertex', 'edge', 'face'] as const) {
      const s = convertSelection(grid, sel(grid, 'face', [0, 5, 6]), to, mode);
      out[`grid/convert/${mode}/${to}`] = bits(to === 'vertex' ? s.verts : to === 'edge' ? s.edges : s.faces);
    }
  }

  // Symmetry maps and the pointer rule.
  const maps: readonly [string, EditMesh][] = [
    ['cube', cube],
    ['cube2', editMeshFrom(primitive('cube', { subdivisionsWidth: 2 }))],
    ['torus', torus],
    ['sphere', sphere],
  ];
  for (const [name, m] of maps) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const map = buildSymmetryMap(m, { axis, space: 'object', placement: IDENTITY, tolerance: 0.001 });
      out[`symmetry/${name}/${axis}`] = {
        vertex: list(map.vertex),
        edge: list(map.edge),
        edgeReversed: list(map.edgeReversed),
        edgeSelf: list(map.edgeSelf),
        face: list(map.face),
        unmatched: map.unmatched,
      };
    }
  }
  const cubeMap = buildSymmetryMap(cube, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
  out['symmetry/cube/x/pointer'] = [0, 1, 2, 3, 4, 5].flatMap((e) =>
    [0, 0.3, 0.4996, 0.5, 0.9].map((t) => mirrorEdgePoint(cube, cubeMap, { edge: e, t })),
  );
  const world = buildSymmetryMap(cube, {
    axis: 'x',
    space: 'world',
    placement: { t: [0.02, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    tolerance: 0.05,
  });
  out['symmetry/cube/world-offset/pointer'] = [0, 2, 5, 8].map((e) =>
    mirrorEdgePoint(cube, world, { edge: e, t: 0.5 }),
  );
  out['symmetry/cube/expand'] = bits(expandSelection(sel(cube, 'face', [4]), cubeMap).faces);

  // Soft weights.
  for (const falloff of ['volume', 'surface'] as const) {
    for (const curve of ['smooth', 'linear', 'sharp', 'root', 'sphere', 'constant'] as const) {
      const seeds = new BitSet(torus.counts.points);
      seeds.add(0);
      seeds.add(40);
      out[`soft/torus/${falloff}/${curve}`] = digest(
        softWeights(torus, seeds, { radius: 0.6, falloff, curve, placement: IDENTITY }),
      );
    }
  }

  // Transforms: manifests after fixed runs (with symmetry and soft selection).
  const op = MESH_OPS['mesh.transformComponents'] as (typeof MESH_OPS)[string];
  const runs: readonly [string, ComponentKind, readonly number[], Record<string, number | string>, boolean, boolean][] =
    [
      ['move', 'vertex', [3], { translateX: 0.1, translateY: -0.2 }, false, false],
      ['rotate-component', 'face', [0, 1], { rotateZ: 0.7, space: 'component' }, false, false],
      ['scale-soft', 'edge', [5, 9], { scaleX: 1.3, scaleY: 0.8 }, true, false],
      ['symmetric', 'face', [2, 3], { translateX: 0.2, rotateY: 0.3 }, false, true],
      ['symmetric-soft', 'vertex', [10], { translateY: 0.4, scaleZ: 1.2, space: 'object' }, true, true],
    ];
  for (const [name, kind, picks, args, soft, symmetric] of runs) {
    const m = editMeshFrom(primitive('torus', {}));
    const map = buildSymmetryMap(m, { axis: 'x', space: 'object', placement: IDENTITY, tolerance: 0.001 });
    m.begin(op.id);
    const result = op.run(m, sel(m, kind, picks), args, {
      symmetry: symmetric ? { map, preserveSeam: true } : null,
      hidden: null,
      placement: { t: [0, 1, 0], q: [0, 0, 0.3826834, 0.9238795], s: [1, 2, 1] },
      faceted: true,
      soft: soft ? { radius: 0.5, falloff: 'surface', curve: 'smooth' } : null,
      curves: curveEngine,
      epsilon: 1e-9,
    });
    m.end();
    out[`transform/${name}`] = isRefusal(result) ? result.code : writeRevision(m).manifestId;
  }
  return out;
}
