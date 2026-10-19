// P6 for the B4 ops (M6A-SPEC §5.29) and the B4 count oracles: the values both runtimes must agree on — V/E/F and
// manifest ids of the oracle cases (Triangulate cube, half cube → Mirror, the mirrored-duplicate Combine, Spin), and the
// manifest after fixed scripts of random B4 ops (fast-check samples with fixed seeds are the same in every engine).
// Shared by the Node test (which keeps test/goldens/ops-shape.json) and the Chromium test. No Node APIs.
import fc from 'fast-check';
import {
  type EditMesh,
  editMeshFrom,
  isRefusal,
  MESH_OPS,
  MESH_SET_OPS,
  type MeshData,
  type MeshOp,
  type MeshSetOp,
  primitive,
  selectionOf,
  writeRevision,
} from '../../src';
import { removeFaces } from '../../src/subset/setops';
import { vef } from '../../src/testing';
import { context } from './harness';
import { arbOpStep, resolveOpStep } from './steps';

const op = (id: string): MeshOp => MESH_OPS[id] as MeshOp;

/** Runs `id` in its own transaction (aborted on a refusal); returns whether it ran. */
function run(m: EditMesh, id: string, sel: Parameters<MeshOp['run']>[1], args: Record<string, unknown> = {}): boolean {
  m.begin(id);
  const result = op(id).run(m, sel, args as never, context());
  if (isRefusal(result)) {
    m.abort();
    return false;
  }
  m.end();
  return true;
}

function position(m: EditMesh, v: number): number[] {
  return [m.position[3 * v] as number, m.position[3 * v + 1] as number, m.position[3 * v + 2] as number];
}

/** The +X half of a unit cube (8/12/5): a centre loop by Multi-Cut, then the −X faces removed (E2E-MOD-09). */
export function halfCube(): EditMesh {
  const m = editMeshFrom(primitive('cube', {}));
  const at = (y: number, z: number): number => {
    for (let e = 0; e < m.counts.edges; e++) {
      const a = position(m, m.edgeVert(e, 0));
      const b = position(m, m.edgeVert(e, 1));
      if (a[1] === y && b[1] === y && a[2] === z && b[2] === z) return e;
    }
    return -1;
  };
  const ring = [at(0.5, 0.5), at(0.5, -0.5), at(-0.5, -0.5), at(-0.5, 0.5)].map((edge) => ({
    kind: 'edge',
    edge,
    t: 0.5,
  }));
  run(m, 'mesh.cut', null, { points: [...ring, ring[0]] });
  m.begin('delete half');
  const left: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    let x = 0;
    let n = 0;
    const s = m.faceCorner(f);
    let c = s;
    do {
      x += m.position[3 * m.cornerVert(c)] as number;
      n++;
      c = m.cornerNext(c);
    } while (c !== s);
    if (x / n < 0) left.push(f);
  }
  removeFaces(m, left);
  m.end();
  return m;
}

/** A half cube spanning x ∈ [0, 1], open towards −X (the duplicate-and-flip route of §5.13). */
function openBox(): EditMesh {
  const m = editMeshFrom(primitive('cube', {}));
  m.begin('open');
  const minusX: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const s = m.faceCorner(f);
    let c = s;
    let all = true;
    do {
      if (m.position[3 * m.cornerVert(c)] !== -0.5) all = false;
      c = m.cornerNext(c);
    } while (c !== s);
    if (all) minusX.push(f);
  }
  removeFaces(m, minusX);
  for (let v = 0; v < m.counts.points; v++) {
    const p = position(m, v);
    m.setPosition(v, (p[0] as number) + 0.5, p[1] as number, p[2] as number);
  }
  m.end();
  return m;
}

function combine(a: EditMesh, b: EditMesh): MeshData {
  const set = MESH_SET_OPS['mesh.combine'] as MeshSetOp;
  const identity = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
  const inputs = [
    { key: 'a', mesh: a, placement: identity },
    { key: 'b', mesh: b, placement: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [-1, 1, 1] } as const },
  ].map((i) => ({
    ...i,
    selection: null,
    palette: null,
    skeleton: null,
    assetBacked: false,
    materials: ['preset:unlit'],
  }));
  for (const input of inputs) input.mesh.begin('combine');
  const result = set.run(inputs, {}, { hidden: null, faceted: true, curves: context().curves, epsilon: 1e-9 });
  for (const input of inputs) input.mesh.abort();
  if (isRefusal(result)) throw new Error(result.reason);
  return (result.outputs[0] as { data: MeshData }).data;
}

/** Runs a fixed script of `steps` random B4 ops (seeded sample) on `start`; returns the final manifest id. */
function script(start: MeshData, seed: number, steps: number): string {
  const m = editMeshFrom(start);
  const [list] = fc.sample(fc.array(arbOpStep(), { minLength: steps, maxLength: steps }), { numRuns: 1, seed });
  for (const step of list ?? []) {
    const { op: o, sel, args, ctx } = resolveOpStep(m, step);
    m.begin(o.id);
    const result = o.run(m, sel, args, ctx);
    if (isRefusal(result)) m.abort();
    else m.end();
  }
  return writeRevision(m).manifestId;
}

export function opsShapeValues(): Record<string, string> {
  const out: Record<string, string> = {};
  // Count oracles (§5.29) with their manifests.
  const cube = editMeshFrom(primitive('cube', {}));
  run(cube, 'mesh.triangulate', null);
  out['oracle/triangulate-cube'] = `${vef(cube)} ${writeRevision(cube).manifestId}`;
  const half = halfCube();
  out['oracle/half-cube'] = vef(half);
  run(half, 'mesh.mirror', null);
  out['oracle/half-cube-mirror'] = `${vef(half)} ${writeRevision(half).manifestId}`;
  const combined = combine(openBox(), openBox());
  out['oracle/mirrored-duplicate-combine'] = `${vef(combined)} ${writeRevision(combined).manifestId}`;
  const spun = editMeshFrom(primitive('cube', {}));
  run(spun, 'mesh.spinEdge', selectionOf('edge', [0], spun.counts));
  out['oracle/spin-cube-edge'] = `${vef(spun)} ${writeRevision(spun).manifestId}`;
  const plane = editMeshFrom(primitive('plane', { width: 2, subdivisionsWidth: 2 }));
  run(plane, 'mesh.cut', null, {
    points: [
      { kind: 'edge', edge: 0, t: 0.5 },
      { kind: 'edge', edge: 2, t: 0.5 },
      { kind: 'edge', edge: 5, t: 0.5 },
    ],
  });
  out['oracle/cut-plane'] = `${vef(plane)} ${writeRevision(plane).manifestId}`;
  // Fixed scripts of random B4 ops.
  out['script/cube/1'] = script(primitive('cube', { subdivisionsWidth: 2, subdivisionsHeight: 2 }), 1, 60);
  out['script/cylinder/2'] = script(primitive('cylinder', { subdivisionsHeight: 3 }), 2, 60);
  out['script/sphere/3'] = script(primitive('sphere', {}), 3, 60);
  out['script/torus/4'] = script(primitive('torus', {}), 4, 40);
  return out;
}
