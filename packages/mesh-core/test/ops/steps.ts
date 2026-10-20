// Abstract B4 op steps for the property tests and the determinism scripts (M6A-SPEC §5.29): a step is plain seeds; it
// resolves against the current mesh (component indices modulo the counts, args from the seeds), so any sequence is
// meaningful on any mesh, and fast-check samples with fixed seeds give the same steps in Node and in Chromium. No Node
// APIs here.
import type { ParamValues } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import {
  type ComponentKind,
  type ComponentSelection,
  type EditMesh,
  MESH_OPS,
  type MeshOp,
  type OpContext,
  selectionOf,
} from '../../src';
import { context } from './harness';
import { expand, testSymmetryMap } from './symmetry-fixture';

export const B4_OPS = [
  'mesh.harden',
  'mesh.soften',
  'mesh.setNormalAngle',
  'mesh.reverse',
  'mesh.conform',
  'mesh.triangulate',
  'mesh.quadrangulate',
  'mesh.spinEdge',
  'mesh.flipTriangleEdge',
  'mesh.applyTransform',
  'mesh.averageVertices',
  'mesh.slide',
  'mesh.cut',
  'mesh.mirror',
  'mesh.symmetrize',
] as const;

export type B4OpId = (typeof B4_OPS)[number];

export interface OpStep {
  readonly op: number; // index into B4_OPS (mod)
  readonly kind: number; // 0 vertex, 1 edge, 2 face, 3 object (null selection)
  readonly picks: readonly number[];
  readonly values: readonly number[]; // numeric seeds for args
  readonly symmetric: boolean;
}

export function arbOpStep(only?: readonly B4OpId[]): fc.Arbitrary<OpStep> {
  const ops = only ?? B4_OPS;
  return fc.record({
    op: fc.integer({ min: 0, max: ops.length - 1 }).map((i) => B4_OPS.indexOf(ops[i] as B4OpId)),
    kind: fc.integer({ min: 0, max: 3 }),
    picks: fc.array(fc.nat(), { minLength: 0, maxLength: 6 }),
    values: fc.array(fc.nat({ max: 1000 }), { minLength: 8, maxLength: 8 }),
    symmetric: fc.boolean(),
  });
}

export interface ResolvedOpStep {
  readonly op: MeshOp;
  readonly sel: ComponentSelection | null;
  readonly args: ParamValues;
  readonly ctx: OpContext;
  readonly label: string;
}

const KINDS: readonly ComponentKind[] = ['vertex', 'edge', 'face'];

function frac(seed: number): number {
  return (seed % 1001) / 1000;
}

/** A matrix from seeds: rotation about Y, non-uniform scale (sign from a seed), translation. */
function matrix(values: readonly number[]): number[] {
  const angle = frac(values[0] ?? 0) * 2 * Math.PI;
  const sx = (0.5 + frac(values[1] ?? 0) * 1.5) * ((values[2] ?? 0) % 3 === 0 ? -1 : 1);
  const sy = 0.5 + frac(values[3] ?? 0);
  const sz = 0.5 + frac(values[4] ?? 0);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    c * sx,
    0,
    -s * sx,
    0,
    0,
    sy,
    0,
    0,
    s * sz,
    0,
    c * sz,
    0,
    frac(values[5] ?? 0) - 0.5,
    0,
    frac(values[6] ?? 0),
    1,
  ];
}

/** Cut points: a walk across faces from the picks (edge points and vertices). */
function cutPoints(m: EditMesh, picks: readonly number[], values: readonly number[]): unknown[] {
  if (m.counts.faces === 0) return [];
  const out: unknown[] = [];
  let face = (picks[0] ?? 0) % m.counts.faces;
  const steps = Math.max(2, picks.length);
  for (let i = 0; i < steps; i++) {
    const seed = picks[i] ?? i * 7 + 3;
    const corners: number[] = [];
    const start = m.faceCorner(face);
    let c = start;
    do {
      corners.push(c);
      c = m.cornerNext(c);
    } while (c !== start);
    const corner = corners[seed % corners.length] as number;
    if ((values[i % values.length] ?? 0) % 4 === 0) out.push({ kind: 'vertex', vertex: m.cornerVert(corner) });
    else
      out.push({
        kind: 'edge',
        edge: m.cornerEdge(corner),
        t: 0.05 + frac(values[(i + 1) % values.length] ?? 0) * 0.9,
      });
    const e = m.cornerEdge(corner);
    const radial: number[] = [];
    const r0 = m.edgeCorner(e);
    let r = r0;
    do {
      radial.push(m.cornerFace(r));
      r = m.cornerRadialNext(r);
    } while (r !== r0);
    face = radial[seed % radial.length] as number;
  }
  return out;
}

function argsFor(id: B4OpId, m: EditMesh, step: OpStep): ParamValues {
  const v = step.values;
  switch (id) {
    case 'mesh.setNormalAngle':
      return { angle: frac(v[0] ?? 0) * Math.PI };
    case 'mesh.quadrangulate':
      return {
        angle: frac(v[0] ?? 0) * Math.PI,
        keepHardEdges: (v[1] ?? 0) % 2 === 0,
        keepSeams: (v[2] ?? 0) % 2 === 0,
        keepMaterials: (v[3] ?? 0) % 2 === 0,
      };
    case 'mesh.spinEdge':
      return { direction: (v[0] ?? 0) % 2 === 0 ? 'forward' : 'back' };
    case 'mesh.applyTransform':
      return { matrix: matrix(v) };
    case 'mesh.averageVertices':
      return { iterations: 1 + ((v[0] ?? 0) % 4), strength: frac(v[1] ?? 0) };
    case 'mesh.slide': {
      // |percent| < 1: a full slide lands on the rail's far vertex (coincident vertices, which no map can pair).
      const percent = (frac(v[0] ?? 0) * 2 - 1) * 0.9;
      const vertex = m.counts.points === 0 ? 0 : (v[1] ?? 0) % m.counts.points;
      const rail = m.vertEdge(vertex);
      return { percent, reference: rail === -1 ? null : { vertex, rail } };
    }
    case 'mesh.cut':
      return { points: cutPoints(m, step.picks, v) as never };
    case 'mesh.mirror':
      return {
        axis: (['x', 'y', 'z'] as const)[(v[0] ?? 0) % 3] as string,
        keep: (v[1] ?? 0) % 2 === 0 ? 'positive' : 'negative',
        cutMesh: (v[2] ?? 0) % 3 !== 0,
        mergeMode: (v[3] ?? 0) % 4 === 0 ? 'none' : 'merge',
        mergeThreshold: frac(v[4] ?? 0) * 0.01,
        flipUVs: (v[5] ?? 0) % 2 === 0,
      };
    case 'mesh.symmetrize':
      return {
        axis: (['x', 'y', 'z'] as const)[(v[0] ?? 0) % 3] as string,
        keep: (v[1] ?? 0) % 2 === 0 ? 'positive' : 'negative',
        tolerance: frac(v[2] ?? 0) * 0.05,
      };
    case 'mesh.harden':
    case 'mesh.soften':
    case 'mesh.reverse':
    case 'mesh.conform':
    case 'mesh.triangulate':
    case 'mesh.flipTriangleEdge':
      return {};
  }
}

/** The step against the current mesh: op, selection (expanded for 'expand' ops under symmetry), args, context. */
export function resolveOpStep(m: EditMesh, step: OpStep): ResolvedOpStep {
  const id = B4_OPS[step.op % B4_OPS.length] as B4OpId;
  const op = MESH_OPS[id] as MeshOp;
  const counts = m.counts;
  let sel: ComponentSelection | null = null;
  if (step.kind < 3) {
    const kind = KINDS[step.kind] as ComponentKind;
    const n = kind === 'vertex' ? counts.points : kind === 'edge' ? counts.edges : counts.faces;
    sel = selectionOf(kind, n === 0 ? [] : step.picks.map((p) => p % n), counts);
  }
  let ctx = context({ epsilon: 1e-7 });
  if (step.symmetric) {
    const map = testSymmetryMap(m, { tolerance: 1e-4 });
    ctx = context({ epsilon: 1e-7, symmetry: { map, preserveSeam: (step.values[7] ?? 0) % 2 === 0 } });
    if (sel !== null && op.symmetry === 'expand') sel = expand(sel, map);
  }
  return { op, sel, args: argsFor(id, m, step), ctx, label: `${id}${step.symmetric ? ' (sym)' : ''}` };
}
