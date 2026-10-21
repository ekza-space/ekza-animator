// B3 op benches (report only; M6A-SPEC §5.27 "typical topology op ≤ 16 ms: op + caches + GPU", §9 B3): the Node share
// of extrude 100 faces and an Insert Edge Loop on a 200-quad ring — the op in its transaction plus the derived caches
// (full triangulation and normals, as after a topology commit) — and a few heavier B3 ops. Each row runs on one mesh
// and undoes its own delta, so the setup copy is not measured; the "undo + redo" rows give the share of that undo.
// Run: pnpm --filter @ekza-studio/mesh-core bench
import type { ParamValues } from '@ekza-studio/anim-core';
import { bench, describe } from 'vitest';
import {
  type ComponentKind,
  computeNormals,
  editMeshFrom,
  type EditMesh,
  isRefusal,
  MESH_OPS,
  type MeshData,
  type MeshDelta,
  type OpContext,
  primitive,
  selectionOf,
  setKernelDebug,
  triangulate,
} from '../src';

// Production cost: the test setup turns the debug validation on; benches measure without it.
setKernelDebug(false);

const ctx: OpContext = {
  symmetry: null,
  hidden: null,
  placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
  faceted: true,
  soft: null,
  curves: { compile: () => ({}) as never, evaluate: () => 0 },
  epsilon: 1e-9,
};

let sink = 0;

interface Scenario {
  readonly m: EditMesh;
  readonly run: (withCaches: boolean) => MeshDelta;
}

/** One mesh and an op run that undoes itself (op in its transaction, optional caches, then the undo). */
function scenario(
  data: MeshData,
  id: string,
  kind: ComponentKind | null,
  indices: number[],
  args: ParamValues,
): Scenario {
  const m = editMeshFrom(data);
  const op = MESH_OPS[id];
  if (op === undefined) throw new Error(`no op ${id}`);
  const run = (withCaches: boolean): MeshDelta => {
    m.begin(id);
    const result = op.run(m, kind === null ? null : selectionOf(kind, indices, m.counts), args, ctx);
    if (isRefusal(result)) throw new Error(`${id} refused: ${result.code}`);
    const delta = m.end();
    if (withCaches) sink += triangulate(m).tris.length + computeNormals(m).corner.length;
    m.apply(delta, 'backward');
    return delta;
  };
  sink += run(false).bytes;
  return { m, run };
}

/** The undo and redo of a scenario's delta (its share of the rows above). */
function undoRedo(s: Scenario): () => void {
  const delta = s.run(false);
  return () => {
    s.m.apply(delta, 'forward');
    s.m.apply(delta, 'backward');
    sink += delta.bytes;
  };
}

// Extrude 100 faces: a 10 × 10 plane as one region, and 100 scattered faces of a 40 × 40 sphere individually.
const plane = primitive('plane', { subdivisionsWidth: 10, subdivisionsHeight: 10 });
const all100 = Array.from({ length: 100 }, (_, f) => f);
const extrudeRegion = scenario(plane, 'mesh.extrude', 'face', all100, { localTranslateZ: 0.5 });
const sphere = primitive('sphere', { subdivisionsAxis: 40, subdivisionsHeight: 40 });
const scattered = Array.from({ length: 100 }, (_, i) => 40 + i * 13);
const extrudeIndividual = scenario(sphere, 'mesh.extrude', 'face', scattered, {
  localTranslateZ: 0.1,
  keepFacesTogether: false,
});
// Insert Edge Loop on a 200-quad ring: a 200-sided open cylinder (a vertical edge's ring runs round all 200 quads).
const cylinder = primitive('cylinder', { subdivisionsAxis: 200, subdivisionsHeight: 1, subdivisionsCaps: 0 });
const vertical = (() => {
  const m = editMeshFrom(cylinder);
  for (let e = 0; e < m.counts.edges; e++) {
    const a = m.edgeVert(e, 0);
    const b = m.edgeVert(e, 1);
    if (Math.abs((m.position[3 * a + 1] as number) - (m.position[3 * b + 1] as number)) > 0.5) return e;
  }
  return 0;
})();
const loop = scenario(cylinder, 'mesh.insertLoop', 'edge', [vertical], { weight: 0.3 });
const loopMultiple = scenario(cylinder, 'mesh.insertLoop', 'edge', [vertical], { mode: 'multiple', divisions: 3 });
// Inset 100 faces, bevel-free merges and a 64-edge bridge.
const inset = scenario(plane, 'mesh.inset', 'face', all100, { offset: 0.01, individual: true });
const grid = primitive('plane', { subdivisionsWidth: 100, subdivisionsHeight: 100 });
const mergeAll = scenario(grid, 'mesh.mergeByDistance', null, [], { distance: 0.011 });

describe('typical topology ops (budget ≤ 16 ms incl. caches and GPU; this is the Node share without GPU)', () => {
  bench('extrude 100 faces as one region (10 × 10 plane) + triangulate + normals', () => {
    extrudeRegion.run(true);
  });
  bench('extrude 100 faces individually (sphere 40 × 40) + triangulate + normals', () => {
    extrudeIndividual.run(true);
  });
  bench('insert edge loop on a 200-quad ring + triangulate + normals', () => {
    loop.run(true);
  });
  bench('undo + redo share: extrude 100 faces as one region', undoRedo(extrudeRegion));
  bench('undo + redo share: insert edge loop on a 200-quad ring', undoRedo(loop));
});

describe('other B3 ops (op only)', () => {
  bench('extrude 100 faces as one region (op only)', () => {
    extrudeRegion.run(false);
  });
  bench('insert edge loop, multiple 3, on a 200-quad ring', () => {
    loopMultiple.run(false);
  });
  bench('inset 100 faces individually', () => {
    inset.run(false);
  });
  bench('merge by distance: 101 × 101 grid, every vertex pair within reach (10k → 1)', () => {
    mergeAll.run(false);
  });
});

export const keep = (): number => sink;
