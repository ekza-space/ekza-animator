import { mat4Compose, quatFromAxisAngle } from '@ekza-animator/anim-core';
import {
  type ConstraintRecord,
  type ConstraintId,
  type ControlId,
  type ControlRecord,
  controlId,
  type SolverId,
  type SolverRecord,
  type UserId,
} from '@ekza-animator/doc';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoRig,
  compileRig,
  type RigDefinition,
  type RigOpImpl,
  type RigProgram,
  registerRigOp,
  writeControlChannels,
} from '../src';
import { IDS, maxAbsDiff, richHumanoid, syntheticSkeleton } from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);

function evaluateAll(program: RigProgram, seed = 1): Float64Array {
  const ch = program.allocChannels();
  for (let i = 0; i < ch.values.length; i++) {
    const k = i % 9;
    if (k >= 3 && k < 6) ch.values[i] = Math.sin(seed * 7 + i) * 0.6;
  }
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return Float64Array.from([...pose.boneLocal, ...pose.humanLocal]);
}

/** Channels set by control id (independent of slot order). */
function evaluateById(program: RigProgram, values: ReadonlyMap<ControlId, number>): Float64Array {
  const ch = program.allocChannels();
  for (const [control, value] of values) writeControlChannels(program, ch, control, { rx: value, rz: -value });
  const pose = program.allocPose();
  program.evaluate(ch, pose);
  return Float64Array.from(pose.boneWorld);
}

describe('compileRig: schedule determinism', () => {
  const skeleton = richHumanoid();
  const def = autoRig(skeleton, IDS);

  it('builds the same schedule and outputs for any record order (property)', () => {
    const reference = compileRig(def, skeleton);
    const values = new Map(def.controls.map((c, i) => [c.id, Math.sin(i) * 0.4]));
    const expected = evaluateById(reference, values);
    fc.assert(
      fc.property(fc.shuffledSubarray([...def.controls], { minLength: def.controls.length }), (shuffled) => {
        const program = compileRig({ ...def, controls: shuffled }, skeleton);
        expect(program.controlIds).toEqual(reference.controlIds);
        expect([...evaluateById(program, values)]).toEqual([...expected]);
      }),
      { numRuns: 25, seed: 7 },
    );
  });

  it('orders slots parents-first with the smallest id among ready controls', () => {
    const program = compileRig(def, skeleton);
    const slot = new Map(program.controlIds.map((cid, i) => [cid, i]));
    for (const control of program.controls) {
      if (control.parent !== null) expect(slot.get(control.parent) as number).toBeLessThan(slot.get(control.id) as number);
    }
    expect(program.controlIds[0]).toBe(id('root'));
    expect(program.controls).toHaveLength(def.controls.length);
    expect([...program.controlIndex.entries()].every(([cid, i]) => program.controlIds[i] === cid)).toBe(true);
    expect(program.nodeCount).toBe(skeleton.nodes.length);
    expect(program.drivenNodes).toEqual([...program.drivenNodes].sort((a, b) => a - b));
    expect(program.rigId).toBe(IDS.rig);
  });
});

describe('compileRig: repair, never throw', () => {
  const skeleton = syntheticSkeleton();
  const base = autoRig(skeleton, IDS);
  const patch = (key: string, fields: Partial<ControlRecord>): RigDefinition => ({
    ...base,
    controls: base.controls.map((c) => (c.key === key ? { ...c, ...fields } : c)),
  });

  it('hangs controls with a missing parent off the character root', () => {
    const program = compileRig(patch('fk.spine', { parent: 'rig_X:gone' as ControlId }), skeleton);
    expect(program.warnings.map((w) => w.code)).toContain('dangling-ref');
    expect(program.warnings.find((w) => w.code === 'dangling-ref')?.ids).toEqual([id('fk.spine')]);
    expect(evaluateAll(program).every(Number.isFinite)).toBe(true);
  });

  it('breaks parent cycles deterministically (the greatest consumer id is detached)', () => {
    // fk.spine ⇄ fk.chest
    const cyclic = patch('fk.spine', { parent: id('fk.chest') });
    const program = compileRig(cyclic, skeleton);
    const cycle = program.warnings.filter((w) => w.code === 'cycle');
    expect(cycle).toHaveLength(1);
    expect(cycle[0]?.message).toContain('fk.spine');
    expect([...(cycle[0]?.ids ?? [])].sort()).toEqual([id('fk.chest'), id('fk.spine')].sort());
    // Zero pose still equals rest.
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    const reference = compileRig(base, skeleton).allocPose();
    compileRig(base, skeleton).evaluate(compileRig(base, skeleton).allocChannels(), reference);
    expect(maxAbsDiff(pose.boneLocal, reference.boneLocal)).toBeLessThan(1e-12);
    // Self-parenting is a cycle as well.
    const self = compileRig(patch('fk.head', { parent: id('fk.head') }), skeleton);
    expect(self.warnings.some((w) => w.code === 'cycle' && w.ids.includes(id('fk.head')))).toBe(true);
  });

  it('reports missing bones and duplicate bindings and keeps evaluating', () => {
    const missing = compileRig(patch('fk.jaw', { drives: { bone: { humanoid: 'leftEye' }, mode: 'rotate' } }), skeleton);
    expect(missing.warnings.map((w) => w.code)).toContain('missing-bone');
    const named = compileRig(
      patch('fk.jaw', { drives: { bone: { name: 'nope', parentName: 'head' }, mode: 'rotate' } }),
      skeleton,
    );
    expect(named.warnings.map((w) => w.code)).toContain('missing-bone');

    const duplicate = compileRig(patch('fk.neck', { drives: { bone: { humanoid: 'head' }, mode: 'rotate' } }), skeleton);
    const warning = duplicate.warnings.find((w) => w.code === 'duplicate-binding');
    // The smaller control id wins: rig:fk.head < rig:fk.neck.
    expect(warning?.ids).toEqual([id('fk.neck'), id('fk.head')]);
    expect(evaluateAll(duplicate).every(Number.isFinite)).toBe(true);
  });

  it('ignores soft-deleted records and records of other rigs, and repairs damaged transforms', () => {
    const deleted = patch('fk.toes.L', { deleted: { by: 'local' as UserId, at: 1 } });
    expect(compileRig(deleted, skeleton).controlIds).not.toContain(id('fk.toes.L'));
    const foreign = patch('fk.toes.R', { rig: 'rig_OtherRigRecord001' as ControlRecord['rig'] });
    const program = compileRig(foreign, skeleton);
    expect(program.controlIds).not.toContain(id('fk.toes.R'));
    expect(program.warnings.some((w) => w.code === 'dangling-ref' && w.ids.includes(id('fk.toes.R')))).toBe(true);
    const broken = patch('fk.head', { restWorld: { t: [Number.NaN, 0, 0], q: [0, 0, 0, 0], s: [0, 1, 1] } });
    expect(evaluateAll(compileRig(broken, skeleton)).every(Number.isFinite)).toBe(true);
  });

  it('reports a dangling mirror and unpaired sided controls', () => {
    const program = compileRig(patch('fk.toes.L', { mirror: 'rig_X:gone' as ControlId }), skeleton);
    expect(program.warnings.some((w) => w.code === 'dangling-ref' && w.ids[0] === id('fk.toes.L'))).toBe(true);
    expect(program.warnings.some((w) => w.code === 'asymmetric-rest' && w.ids[0] === id('fk.toes.L'))).toBe(true);
  });

  it('warns when mirror pairs are not mirror images at rest', () => {
    const moved = patch('fk.hand.L', {
      restWorld: { t: [0.8, 1.39, -0.01], q: [0, 0, 0, 1], s: [1, 1, 1] },
    });
    const program = compileRig(moved, skeleton);
    expect(
      program.warnings.some(
        (w) => w.code === 'asymmetric-rest' && w.ids.includes(id('fk.hand.L')) && w.ids.includes(id('fk.hand.R')),
      ),
    ).toBe(true);
  });
});

describe('compileRig: constraint and solver slots', () => {
  const skeleton = syntheticSkeleton();
  const base = autoRig(skeleton, IDS);
  const constraint: ConstraintRecord = {
    id: 'cns_TestConstraint01' as ConstraintId,
    rig: IDS.rig,
    type: 'orient',
    driven: { control: id('fk.head') },
    targets: { t0: { target: { kind: 'control', id: id('fk.neck') }, weight: 1 } },
    maintainOffset: true,
    params: {},
    enabled: true,
    deleted: null,
  };
  const solver: SolverRecord = {
    id: 'slv_TestSolverRec001' as SolverId,
    rig: IDS.rig,
    type: 'ik2',
    params: {},
    enabled: true,
    deleted: null,
  };
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('compiles MVP records to disabled ops with an unsupported-op warning', () => {
    const program = compileRig({ ...base, constraints: [constraint], solvers: [solver, { ...solver, id: 'slv_Off' as SolverId, enabled: false }] }, skeleton);
    const unsupported = program.warnings.filter((w) => w.code === 'unsupported-op');
    expect(unsupported.map((w) => w.ids[0])).toEqual([constraint.id, solver.id]);
    const plain = compileRig(base, skeleton);
    expect([...evaluateAll(program)]).toEqual([...evaluateAll(plain)]);
  });

  it('schedules registered ops after the worlds they read and before what they feed (V1 extension point)', () => {
    const headNode = skeleton.humanoid?.head as number;
    const calls: string[] = [];
    const impl: RigOpImpl = {
      reads: () => ({ controls: [id('fk.neck')], nodes: [] }),
      writes: () => ({ controls: [], nodes: [headNode] }),
      run: (record, ctx) => {
        calls.push(record.id);
        // Rotate the head bone world by 90° about +Y around its own position.
        const world = ctx.pose.boneWorld.subarray(headNode * 16, headNode * 16 + 16);
        const t: [number, number, number] = [world[12] as number, world[13] as number, world[14] as number];
        world.set(mat4Compose({ t, q: quatFromAxisAngle([0, 1, 0], Math.PI / 2), s: [1, 1, 1] }));
      },
    };
    dispose = registerRigOp('constraint', 'orient', impl);
    expect(() => registerRigOp('constraint', 'orient', impl)).toThrow(/already registered/);
    const program = compileRig({ ...base, constraints: [constraint] }, skeleton);
    expect(program.warnings.filter((w) => w.code === 'unsupported-op')).toEqual([]);
    const pose = program.allocPose();
    program.evaluate(program.allocChannels(), pose);
    expect(calls).toEqual([constraint.id]);
    // The head's raw local and its child (jaw) follow the overridden world.
    const local = pose.boneLocal.subarray(headNode * 10 + 3, headNode * 10 + 7);
    expect(Math.abs(local[1] as number)).toBeCloseTo(Math.SQRT1_2, 9);
    const jaw = skeleton.humanoid?.jaw as number;
    expect(pose.boneWorld[jaw * 16 + 12]).toBeCloseTo(0.05, 9);
    dispose();
    dispose = null;
    expect(compileRig({ ...base, constraints: [constraint] }, skeleton).warnings.map((w) => w.code)).toContain(
      'unsupported-op',
    );
  });

  it('disables registered ops with dangling references or failing declarations', () => {
    dispose = registerRigOp('solver', 'ik2', {
      reads: () => ({ controls: ['rig_X:gone' as ControlId], nodes: [] }),
      writes: () => ({ controls: [], nodes: [] }),
      run: () => {
        throw new Error('must not run');
      },
    });
    const program = compileRig({ ...base, solvers: [solver] }, skeleton);
    expect(program.warnings.some((w) => w.code === 'dangling-ref' && w.ids[0] === solver.id)).toBe(true);
    expect(() => program.evaluate(program.allocChannels(), program.allocPose())).not.toThrow();
  });

  it('disables registered ops that close a dependency cycle', () => {
    // Writes the neck control and reads the head control below it: head depends on neck.
    dispose = registerRigOp('constraint', 'aim', {
      reads: () => ({ controls: [id('fk.head')], nodes: [] }),
      writes: () => ({ controls: [id('fk.neck')], nodes: [] }),
      run: () => {
        throw new Error('must not run');
      },
    });
    const program = compileRig({ ...base, constraints: [{ ...constraint, type: 'aim' }] }, skeleton);
    expect(program.warnings.some((w) => w.code === 'cycle' && w.ids.includes(constraint.id))).toBe(true);
    expect(() => program.evaluate(program.allocChannels(), program.allocPose())).not.toThrow();
  });
});
