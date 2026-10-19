// Abstract B3 op steps for property tests (M6A-SPEC §5.29): an op, a component kind, selection seeds mapped modulo
// the current counts (so any step is meaningful on any mesh) and args. Shared by the Node and Chromium runs.
import type { ParamValues } from '@ekza-animator/anim-core';
import fc from 'fast-check';
import type { ComponentKind, ComponentSelection, EditMesh } from '../../src';
import { sel } from './support';

export interface OpStep {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly seeds: readonly number[];
  readonly args: ParamValues;
  /** Args move geometry only outward on convex input (the signed-volume check applies). */
  readonly outward: boolean;
  /** Pointer args built from seeds: Target Weld pairs. */
  readonly pairs?: boolean;
}

/** The border loops of `m`: border edges joined through shared vertices (sorted by their first edge). */
export function borderLoopsOf(m: EditMesh): number[][] {
  const parent = new Map<number, number>();
  const find = (v: number): number => {
    let r = v;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as number;
    return r;
  };
  const border: number[] = [];
  for (let e = 0; e < m.counts.edges; e++) {
    if (m.edgeFaceCount(e) !== 1) continue;
    border.push(e);
    const a = find(m.edgeVert(e, 0));
    const b = find(m.edgeVert(e, 1));
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const loops = new Map<number, number[]>();
  for (const e of border) {
    const r = find(m.edgeVert(e, 0));
    loops.set(r, [...(loops.get(r) ?? []), e]);
  }
  return [...loops.values()];
}

/** Vertices of face `f`. */
function verticesOf(m: EditMesh, f: number): number[] {
  const out: number[] = [];
  const start = m.faceCorner(f);
  let c = start;
  do {
    out.push(m.cornerVert(c));
    c = m.cornerNext(c);
  } while (c !== start);
  return out;
}

/** Two bridgeable picks from the seeds: whole border loops of equal length, or two interior faces of one size apart. */
function bridgePicks(m: EditMesh, step: OpStep): number[] | null {
  const [s0 = 0, s1 = 0] = step.seeds.map((x) => Math.floor(x / 4));
  if (step.kind === 'edge') {
    const loops = borderLoopsOf(m);
    if (loops.length < 2) return null;
    const a = loops[s0 % loops.length] as number[];
    const same = loops.filter((l) => l !== a && l.length === a.length);
    const pool = same.length > 0 ? same : loops.filter((l) => l !== a);
    return [...a, ...(pool[s1 % pool.length] as number[])];
  }
  const interior = (f: number): boolean => {
    const start = m.faceCorner(f);
    let c = start;
    do {
      if (m.edgeFaceCount(m.cornerEdge(c)) !== 2) return false;
      c = m.cornerNext(c);
    } while (c !== start);
    return true;
  };
  const a = s0 % m.counts.faces;
  const va = new Set(verticesOf(m, a));
  const candidates: number[] = [];
  for (let f = 0; f < m.counts.faces; f++) {
    const vs = verticesOf(m, f);
    if (f !== a && vs.length === va.size && !vs.some((v) => va.has(v)) && interior(f)) candidates.push(f);
  }
  return candidates.length === 0 ? null : [a, candidates[s1 % candidates.length] as number];
}

const seeds = (min: number, max: number) => fc.array(fc.nat({ max: 1_000_000 }), { minLength: min, maxLength: max });
const unit = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

export function arbOpStep(): fc.Arbitrary<OpStep> {
  return fc.oneof(
    fc.record({
      id: fc.constant('mesh.extrude'),
      kind: fc.constant('face' as const),
      seeds: seeds(1, 4),
      args: fc.record({
        localTranslateZ: unit(0, 1),
        divisions: fc.integer({ min: 1, max: 3 }),
        keepFacesTogether: fc.boolean(),
        offset: unit(0, 0.2),
        thickness: unit(0, 0.2),
      }),
      outward: fc.constant(true),
    }),
    fc.record({
      id: fc.constant('mesh.extrude'),
      kind: fc.constant('face' as const),
      seeds: seeds(1, 4),
      args: fc.record({
        localTranslateX: unit(-0.5, 0.5),
        localTranslateZ: unit(-1, 1),
        localRotateX: unit(-1, 1),
        localRotateZ: unit(-1, 1),
        localScaleX: unit(0, 2),
        localScaleY: unit(0, 2),
        divisions: fc.integer({ min: 1, max: 3 }),
        keepFacesTogether: fc.boolean(),
        space: fc.constantFrom('local', 'world'),
      }),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.extrude'),
      kind: fc.constant('edge' as const),
      seeds: seeds(1, 4),
      args: fc.record({ localTranslateY: unit(-0.5, 0.5), divisions: fc.integer({ min: 1, max: 2 }) }),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.inset'),
      kind: fc.constant('face' as const),
      seeds: seeds(1, 4),
      args: fc.record({
        offset: unit(0, 0.4),
        depth: unit(-0.2, 0.2),
        individual: fc.boolean(),
        evenOffset: fc.boolean(),
        clamp: fc.boolean(),
      }),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.insertLoop'),
      kind: fc.constant('edge' as const),
      seeds: seeds(1, 2),
      args: fc.record({
        mode: fc.constantFrom('relative', 'equal', 'multiple'),
        weight: unit(0.05, 0.95),
        divisions: fc.integer({ min: 1, max: 3 }),
      }),
      outward: fc.constant(true),
    }),
    fc.record({
      id: fc.constant('mesh.offsetLoop'),
      kind: fc.constant('edge' as const),
      seeds: seeds(1, 5),
      args: fc.record({ offset: unit(0.05, 0.45), deleteEnds: fc.boolean() }),
      outward: fc.constant(true),
    }),
    fc.record({
      id: fc.constant('mesh.connect'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const),
      seeds: seeds(2, 5),
      args: fc.record({ weight: unit(0.1, 0.9) }),
      outward: fc.constant(true),
    }),
    fc.record({
      id: fc.constantFrom('mesh.merge', 'mesh.mergeToCenter', 'mesh.collapse'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const, 'face' as const),
      seeds: seeds(1, 4),
      args: fc.record({ distance: unit(0, 0.6) }),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.mergeByDistance'),
      kind: fc.constant('vertex' as const),
      seeds: seeds(0, 0),
      args: fc.record({ distance: unit(0, 0.4) }),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.targetWeld'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const),
      seeds: seeds(2, 4),
      args: fc.record({ mode: fc.constantFrom('target', 'center') }),
      outward: fc.constant(false),
      pairs: fc.constant(true),
    }),
    fc.record({
      id: fc.constantFrom('mesh.delete', 'mesh.deleteEdgeVertex'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const, 'face' as const),
      seeds: seeds(1, 3),
      args: fc.constant({}),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.fillHole'),
      kind: fc.constantFrom('vertex' as const, 'edge' as const),
      seeds: seeds(1, 3),
      args: fc.constant({}),
      outward: fc.constant(false),
    }),
    fc.record({
      id: fc.constant('mesh.bridge'),
      kind: fc.constantFrom('edge' as const, 'face' as const),
      seeds: seeds(2, 12),
      args: fc.record({
        divisions: fc.integer({ min: 0, max: 3 }),
        twist: fc.integer({ min: -2, max: 2 }),
        taper: unit(0.5, 1.5),
      }),
      outward: fc.constant(false),
    }),
  );
}

/** Growth steps (they add faces); sequences skip them above their face cap. */
export const GROWTH: ReadonlySet<string> = new Set([
  'mesh.extrude',
  'mesh.inset',
  'mesh.insertLoop',
  'mesh.offsetLoop',
  'mesh.connect',
  'mesh.bridge',
  'mesh.fillHole',
]);

/** The selection and args of a step on the current mesh (seeds modulo the counts; border edges for bridges). */
export function resolveStep(
  m: EditMesh,
  step: OpStep,
): { selection: ComponentSelection | null; args: ParamValues } | null {
  const count = step.kind === 'vertex' ? m.counts.points : step.kind === 'edge' ? m.counts.edges : m.counts.faces;
  if (count === 0) return null;
  if (step.id === 'mesh.mergeByDistance') return { selection: null, args: step.args };
  // Bridge: three steps in four pick two bridgeable sides from the seeds (whole border loops, or two interior faces of
  // one size apart); the rest pick raw border edges or faces (the refusal paths).
  if (step.id === 'mesh.bridge' && (step.seeds[0] ?? 0) % 4 !== 0) {
    const picks = bridgePicks(m, step);
    if (picks !== null) return { selection: sel(m, step.kind, picks), args: step.args };
  }
  let pool: number[] | null = null;
  if (step.id === 'mesh.bridge' && step.kind === 'edge') {
    pool = [];
    for (let e = 0; e < m.counts.edges; e++) if (m.edgeFaceCount(e) === 1) pool.push(e);
    if (pool.length === 0) return null;
  }
  const indices = step.seeds.map((s) => (pool === null ? s % count : (pool[s % pool.length] as number)));
  if (step.pairs === true) {
    const pairs: [number, number][] = [];
    for (let i = 0; i + 1 < indices.length; i += 2) {
      if (indices[i] !== indices[i + 1]) pairs.push([indices[i] as number, indices[i + 1] as number]);
    }
    return { selection: sel(m, step.kind, []), args: { ...step.args, pairs } };
  }
  return { selection: sel(m, step.kind, indices), args: step.args };
}
