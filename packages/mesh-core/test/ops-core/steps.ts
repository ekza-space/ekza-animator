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

/** The selection and args of a step on the current mesh (seeds modulo the counts; border edges for bridges). */
export function resolveStep(
  m: EditMesh,
  step: OpStep,
): { selection: ComponentSelection | null; args: ParamValues } | null {
  const count = step.kind === 'vertex' ? m.counts.points : step.kind === 'edge' ? m.counts.edges : m.counts.faces;
  if (count === 0) return null;
  if (step.id === 'mesh.mergeByDistance') return { selection: null, args: step.args };
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
