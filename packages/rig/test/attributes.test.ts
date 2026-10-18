// M2A-SPEC §4.3, §5.1 rules 1–3 and §5.4 rule 1 (A0): attribute slots, defaults, sampling and overrides; the op
// compile context, `compile` after `createProgram` with its `state`, and `run` returning false.
import { curveEngine, mat4Compose, quatFromAxisAngle } from '@ekza-animator/anim-core';
import {
  type AttrDef,
  type ClipId,
  type ControlId,
  type ControlRecord,
  type CurveId,
  type CurveRecord,
  controlId,
  createMemoryStore,
  type KeyId,
  type KeyRecord,
  type LayerId,
  type RigId,
  type SolverId,
  type SolverRecord,
} from '@ekza-animator/doc';
import { makeTestDocument } from '@ekza-animator/doc/testing';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOverrides,
  autoRig,
  channelDefaultValue,
  compileRig,
  createClipSampler,
  createCurveCache,
  type RigDefinition,
  type RigOpCompileContext,
  type RigOpImpl,
  type RigProgram,
  readAttr,
  readRigDefinition,
  registerBuiltinRigOps,
  registerRigOp,
  writeAttr,
  writeControlChannels,
} from '../src';
import { isRigOpSkipped } from '../src/kernel/internals';
import { attrChannelSlot } from '../src/sampler/channels';
import { IDS, syntheticSkeleton } from './helpers';

const id = (key: string): ControlId => controlId(IDS.rig, key);
const float = (fields: Partial<AttrDef> = {}): AttrDef => ({ type: 'float', default: 0, keyable: true, ...fields });

/** The synthetic auto-rig with attributes on a few controls (the IK attributes and a custom one). */
function rigWithAttrs(): RigDefinition {
  const base = autoRig(syntheticSkeleton(), IDS);
  const attrs: Readonly<Record<string, Readonly<Record<string, AttrDef>>>> = {
    'fk.foot.L': {
      roll: float({ unit: 'angle' }),
      ikFk: float({ default: 1, min: 0, max: 1, keyAll: false, stepped: true }),
      bank: float({ unit: 'angle' }),
    },
    'fk.hand.R': { twist: float({ unit: 'angle', mirror: 'negate' }), soft: float({ default: 0.05, max: 0.25 }) },
    cog: { custom: float({ default: -2 }) },
  };
  return {
    ...base,
    controls: base.controls.map((control) => {
      const extra = attrs[control.key];
      return extra === undefined ? control : { ...control, attrs: extra };
    }),
  };
}

const EXPECTED_ORDER = [
  ['cog', 'custom'],
  ['fk.foot.L', 'bank'],
  ['fk.foot.L', 'ikFk'],
  ['fk.foot.L', 'roll'],
  ['fk.hand.R', 'soft'],
  ['fk.hand.R', 'twist'],
] as const;

function slotNames(program: RigProgram): string[] {
  return program.attrSlots.map((slot) => `${slot.control}/@${slot.name}`);
}

function expectedNames(): string[] {
  // Code-unit order of the control ids (all share the rig prefix) then of the attribute names.
  return EXPECTED_ORDER.map(([key, name]) => `${id(key)}/@${name}`).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('attribute slots (§5.1 rule 2)', () => {
  const skeleton = syntheticSkeleton();
  const dispose: (() => void)[] = [];
  afterEach(() => {
    for (const d of dispose.splice(0)) d();
  });

  it('are ordered by (control id, attribute name) in code-unit order, with an index', () => {
    const program = compileRig(rigWithAttrs(), skeleton);
    expect(slotNames(program)).toEqual(expectedNames());
    program.attrSlots.forEach((slot, i) => {
      expect(program.attrIndex.get(`${slot.control}/@${slot.name}`)).toBe(i);
    });
    expect(program.limbs).toEqual([]);
  });

  it('do not depend on record order or on constraint and solver records (adding an op renumbers nothing)', () => {
    const def = rigWithAttrs();
    const reference = slotNames(compileRig(def, skeleton));
    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: (_record, ctx) => ({ controls: [id('fk.foot.L')], nodes: [ctx.resolveBone({ humanoid: 'hips' })] }),
        writes: () => ({ controls: [], nodes: [] }),
        run: () => false,
      }),
    );
    const solvers: SolverRecord[] = ['a', 'b', 'c'].map((suffix) => ({
      id: `slv_TestSolver000${suffix}` as SolverId,
      rig: IDS.rig,
      type: 'ik2',
      params: {},
      enabled: true,
      deleted: null,
    }));
    fc.assert(
      fc.property(fc.shuffledSubarray([...def.controls], { minLength: def.controls.length }), fc.nat(3), (order, n) => {
        const program = compileRig({ ...def, controls: order, solvers: solvers.slice(0, n) }, skeleton);
        expect(slotNames(program)).toEqual(reference);
      }),
      { numRuns: 25 },
    );
  });

  it('allocChannels and resetChannels write AttrDef.default; a non-finite default reads 0', () => {
    const def = rigWithAttrs();
    const broken = {
      ...def,
      controls: def.controls.map((control) =>
        control.key === 'cog' ? { ...control, attrs: { custom: float({ default: Number.NaN }) } } : control,
      ),
    };
    const program = compileRig(def, skeleton);
    const ch = program.allocChannels();
    expect(ch.attrs.length).toBe(EXPECTED_ORDER.length);
    const expected = program.attrSlots.map((slot) => slot.def.default);
    expect([...ch.attrs]).toEqual(expected);
    expect(readAttr(program, ch, id('cog'), 'custom')).toBe(-2);
    expect(readAttr(program, ch, id('fk.foot.L'), 'ikFk')).toBe(1);
    ch.attrs.fill(7);
    program.resetChannels(ch);
    expect([...ch.attrs]).toEqual(expected);
    const repaired = compileRig(broken, skeleton);
    expect(readAttr(repaired, repaired.allocChannels(), id('cog'), 'custom')).toBe(0);
  });

  it('readAttr / writeAttr address slots by control and name; unknown ones are ignored', () => {
    const program = compileRig(rigWithAttrs(), skeleton);
    const ch = program.allocChannels();
    writeAttr(program, ch, id('fk.hand.R'), 'twist', 0.5);
    expect(readAttr(program, ch, id('fk.hand.R'), 'twist')).toBe(0.5);
    expect(ch.attrs[program.attrIndex.get(`${id('fk.hand.R')}/@twist`) as number]).toBe(0.5);
    writeAttr(program, ch, id('fk.hand.R'), 'nope', 1);
    writeAttr(program, ch, id('fk.hand.R'), 'twist', Number.NaN);
    writeAttr(program, ch, 'rig_X:gone' as ControlId, 'twist', 1);
    expect(readAttr(program, ch, id('fk.hand.R'), 'twist')).toBe(0.5);
    expect(readAttr(program, ch, id('fk.hand.R'), 'nope')).toBeUndefined();
    expect(readAttr(program, ch, 'rig_X:gone' as ControlId, 'twist')).toBeUndefined();
  });

  it('overrides and writeControlChannels write attribute channels after TRS', () => {
    const program = compileRig(rigWithAttrs(), skeleton);
    const ch = program.allocChannels();
    applyOverrides(
      program,
      ch,
      new Map([
        [id('fk.foot.L'), { '@roll': 0.25, rx: 0.1, '@missing': 3 }],
        ['rig_X:gone' as ControlId, { '@roll': 9 }],
      ]),
    );
    expect(readAttr(program, ch, id('fk.foot.L'), 'roll')).toBe(0.25);
    expect(ch.values[(program.controlIndex.get(id('fk.foot.L')) as number) * 9 + 3]).toBe(0.1);
    writeControlChannels(program, ch, id('cog'), { '@custom': 4, ty: -0.05 });
    expect(readAttr(program, ch, id('cog'), 'custom')).toBe(4);
  });

  it('per-frame attribute writes look slots up without building keys (MVP-SPEC §3 rule 7)', () => {
    const program = compileRig(rigWithAttrs(), skeleton);
    const ch = program.allocChannels();
    const overrides = new Map([[id('fk.foot.L'), { '@roll': 0.25, '@missing': 3 }]]);
    applyOverrides(program, ch, overrides); // builds the program's slot table once
    const index = vi.spyOn(program.attrIndex, 'get');
    const slice = vi.spyOn(String.prototype, 'slice');
    try {
      for (let frame = 0; frame < 3; frame++) {
        applyOverrides(program, ch, new Map([[id('fk.foot.L'), { '@roll': frame, '@missing': 3 }]]));
        writeControlChannels(program, ch, id('cog'), { '@custom': frame });
      }
      expect(index).not.toHaveBeenCalled();
      expect(slice).not.toHaveBeenCalled();
    } finally {
      index.mockRestore();
      slice.mockRestore();
    }
    expect(readAttr(program, ch, id('fk.foot.L'), 'roll')).toBe(2);
    expect(readAttr(program, ch, id('cog'), 'custom')).toBe(2);
    // Every slot is reachable by its channel id, and the table agrees with attrIndex.
    program.attrSlots.forEach((slot, i) => {
      expect(attrChannelSlot(program, slot.control, `@${slot.name}`)).toBe(i);
      expect(program.attrIndex.get(`${slot.control}/@${slot.name}`)).toBe(i);
    });
    expect(attrChannelSlot(program, id('cog'), 'tx')).toBe(-1);
    expect(attrChannelSlot(program, 'rig_X:gone' as ControlId, '@custom')).toBe(-1);
  });

  it('channelDefaultValue takes AttrDef.default for attribute channels', () => {
    expect(channelDefaultValue('sx')).toBe(1);
    expect(channelDefaultValue('rx')).toBe(0);
    expect(channelDefaultValue('@ikFk')).toBe(0);
    expect(channelDefaultValue('@ikFk', float({ default: 1 }))).toBe(1);
    expect(channelDefaultValue('@x', float({ default: Number.POSITIVE_INFINITY }))).toBe(0);
  });
});

describe('attribute sampling (§5.1 rule 3)', () => {
  // A memory-store document whose first control carries three attributes: one keyed, one key-less with a static
  // value, one without a curve.
  function setup() {
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 2 });
    const store = createMemoryStore();
    store.load(doc);
    const rig = Object.keys(doc.tables.rigs)[0] as RigId;
    const clip = Object.keys(doc.tables.clips)[0] as ClipId;
    const layer = Object.keys(doc.tables.layers)[0] as LayerId;
    const root = controlId(rig, 'root');
    store.transact({ label: 'attrs' }, (tx) => {
      tx.patch('controls', root, {
        attrs: {
          keyed: float({ default: 5 }),
          still: float({ default: 6 }),
          plain: float({ default: 7 }),
        },
      });
      const curve = (cid: string, channel: CurveRecord['channel'], staticValue: number | null): CurveRecord => ({
        id: cid as CurveId,
        clip,
        layer,
        control: root,
        channel,
        weighted: false,
        pre: 'constant',
        post: 'constant',
        staticValue,
        locked: false,
        muted: false,
        deleted: null,
      });
      tx.put('curves', curve('crv_AttrKeyed000001', '@keyed', null));
      tx.put('curves', curve('crv_AttrStatic00001', '@still', 0.5));
      const key = (kid: string, t: number, v: number): KeyRecord => ({
        id: kid as KeyId,
        clip,
        curve: 'crv_AttrKeyed000001' as CurveId,
        t,
        v,
        inType: 'linear',
        outType: 'linear',
        inHandle: { dt: 0, dv: 0 },
        outHandle: { dt: 0, dv: 0 },
        broken: false,
        weightLocked: true,
      });
      tx.put('keys', key('k_AttrKey00001', 0, 0));
      tx.put('keys', key('k_AttrKey00002', 10, 1));
    });
    const def = readRigDefinition(store, rig);
    if (def === undefined) throw new Error('rig missing');
    const program = compileRig(def, syntheticSkeleton());
    const cache = createCurveCache(store, curveEngine);
    const sampler = createClipSampler(store, cache, clip, program);
    return { store, program, sampler, root, doc };
  }

  it('keyed curves evaluate, key-less curves give staticValue, no curve gives the default', () => {
    const { program, sampler, root } = setup();
    const ch = program.allocChannels();
    sampler.sample(5, ch);
    expect(readAttr(program, ch, root, 'keyed')).toBeCloseTo(0.5, 12);
    expect(readAttr(program, ch, root, 'still')).toBe(0.5);
    expect(readAttr(program, ch, root, 'plain')).toBe(7);
    expect(sampler.value(root, '@keyed', 10)).toBe(1);
    expect(sampler.value(root, '@plain', 10)).toBeUndefined();
    expect(sampler.keyTimes([root])).toContain(10);
  });

  it('a key-less curve without a static value gives AttrDef.default; overrides apply after sampling', () => {
    const { store, program, sampler, root } = setup();
    store.transact({ label: 'clear' }, (tx) =>
      tx.patch('curves', 'crv_AttrStatic00001' as CurveId, { staticValue: null }),
    );
    const ch = program.allocChannels();
    sampler.sample(0, ch);
    expect(readAttr(program, ch, root, 'still')).toBe(6);
    applyOverrides(program, ch, new Map([[root, { '@keyed': -1 }]]));
    expect(readAttr(program, ch, root, 'keyed')).toBe(-1);
    // Values are never clamped by sampling or overrides (§5.1 rule 3: clamped where consumed).
    applyOverrides(program, ch, new Map([[root, { '@plain': 1e6 }]]));
    expect(readAttr(program, ch, root, 'plain')).toBe(1e6);
  });
});

describe('op compile context and run (§4.3, §5.4 rule 1)', () => {
  const skeleton = syntheticSkeleton();
  const solver: SolverRecord = {
    id: 'slv_TestSolverRec001' as SolverId,
    rig: IDS.rig,
    type: 'ik2',
    params: {},
    enabled: true,
    deleted: null,
  };
  const dispose: (() => void)[] = [];
  afterEach(() => {
    for (const d of dispose.splice(0)) d();
  });

  it('hands reads/writes a context with attribute slots, children and bone resolution', () => {
    const def = rigWithAttrs();
    const seen: RigOpCompileContext[] = [];
    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: (_record, ctx) => {
          seen.push(ctx);
          return { controls: [], nodes: [] };
        },
        writes: () => ({ controls: [], nodes: [] }),
        run: () => false,
      }),
    );
    const program = compileRig({ ...def, solvers: [solver] }, skeleton);
    expect(seen).toHaveLength(1);
    const ctx = seen[0] as RigOpCompileContext;
    // Known before scheduling: the same slot numbers as the finished program.
    expect(ctx.attrSlot(id('fk.foot.L'), 'roll')).toBe(program.attrIndex.get(`${id('fk.foot.L')}/@roll`));
    expect(ctx.attrSlot(id('fk.foot.L'), 'nope')).toBe(-1);
    expect(ctx.attrSlot('rig_X:gone' as ControlId, 'roll')).toBe(-1);
    expect(ctx.skeleton).toBe(skeleton);
    expect(ctx.controls.get(id('cog'))?.key).toBe('cog');
    const hips = skeleton.humanoid?.hips as number;
    expect(ctx.resolveBone({ humanoid: 'hips' })).toBe(hips);
    expect(ctx.resolveBone({ name: 'nope', parentName: null })).toBe(-1);
    expect(ctx.nodeChildren(hips)).toEqual(
      skeleton.nodes.filter((node) => node.parent === hips).map((node) => node.index),
    );
    // Control children by order, then id.
    const children = ctx.controlChildren(id('cog'));
    const records = children.map((child) => ctx.controls.get(child) as ControlRecord);
    expect(records.every((record) => record.parent === id('cog'))).toBe(true);
    const sorted = [...records].sort((a, b) =>
      a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.id < b.id ? -1 : 1,
    );
    expect(children).toEqual(sorted.map((record) => record.id));
    expect(children.length).toBe(def.controls.filter((c) => c.parent === id('cog')).length);
    expect(ctx.controlChildren(id('fk.head'))).toEqual(
      def.controls
        .filter((c) => c.parent === id('fk.head'))
        .sort((a, b) => (a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.id < b.id ? -1 : 1))
        .map((c) => c.id),
    );
  });

  it('compile runs after createProgram with the finished program; its result is the run state', () => {
    const events: string[] = [];
    let compiledWith: RigProgram | null = null;
    const states: unknown[] = [];
    const impl: RigOpImpl = {
      reads: () => {
        events.push('reads');
        return { controls: [id('cog')], nodes: [] };
      },
      writes: () => {
        events.push('writes');
        return { controls: [], nodes: [] };
      },
      compile: (record, ctx) => {
        events.push('compile');
        compiledWith = ctx.program;
        expect(ctx.program.attrSlots.length).toBe(EXPECTED_ORDER.length);
        expect(ctx.program.limbs).toEqual([]);
        expect(ctx.attrSlot(id('cog'), 'custom')).toBe(ctx.program.attrIndex.get(`${id('cog')}/@custom`));
        return { scratch: new Float64Array(3), id: record.id };
      },
      run: (_record, ctx) => {
        states.push(ctx.state);
        return false;
      },
    };
    dispose.push(registerRigOp('solver', 'ik2', impl));
    const program = compileRig({ ...rigWithAttrs(), solvers: [solver] }, skeleton);
    expect(events).toEqual(['reads', 'writes', 'compile']);
    expect(compiledWith).toBe(program);
    program.evaluate(program.allocChannels(), program.allocPose());
    program.evaluate(program.allocChannels(), program.allocPose());
    expect(states).toHaveLength(2);
    expect(states[0]).toEqual({ scratch: new Float64Array(3), id: solver.id });
    expect(states[1]).toBe(states[0]);
  });

  it('an op without compile runs with state undefined; a compile that throws skips the op and warns', () => {
    const states: unknown[] = [];
    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: () => ({ controls: [], nodes: [] }),
        writes: () => ({ controls: [], nodes: [] }),
        run: (_record, ctx) => {
          states.push(ctx.state);
        },
      }),
    );
    const program = compileRig({ ...rigWithAttrs(), solvers: [solver] }, skeleton);
    program.evaluate(program.allocChannels(), program.allocPose());
    expect(states).toEqual([undefined]);
    expect(isRigOpSkipped(program, solver.id)).toBe(false);
    dispose.splice(0).forEach((d) => d());

    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: () => ({ controls: [], nodes: [] }),
        writes: () => ({ controls: [], nodes: [] }),
        compile: () => {
          throw new Error('bad params');
        },
        run: () => {
          throw new Error('must not run');
        },
      }),
    );
    const skipped = compileRig({ ...rigWithAttrs(), solvers: [solver] }, skeleton);
    expect(skipped.warnings.some((w) => w.code === 'unsupported-op' && w.ids[0] === solver.id)).toBe(true);
    expect(() => skipped.evaluate(skipped.allocChannels(), skipped.allocPose())).not.toThrow();
    // §5.4 rule 4: the op stays scheduled and says it is skipped (evaluation.ikFk reads its limb as 0).
    expect(isRigOpSkipped(skipped, solver.id)).toBe(true);
    expect(isRigOpSkipped(skipped, 'slv_unknown')).toBe(false);
    expect(isRigOpSkipped(compileRig(rigWithAttrs(), skeleton), solver.id)).toBe(false);
  });

  it('run returning false leaves every bone local bit-identical to the program without the op', () => {
    const headNode = skeleton.humanoid?.head as number;
    const garbage = mat4Compose({ t: [9, 9, 9], q: quatFromAxisAngle([0, 1, 0], 1), s: [2, 2, 2] });
    let wrote = false;
    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: () => ({ controls: [id('fk.neck')], nodes: [] }),
        writes: () => ({ controls: [], nodes: [headNode] }),
        run: (_record, ctx) => {
          // Scribbles on the worlds it declared, then reports whether that counts.
          ctx.pose.boneWorld.set(garbage, headNode * 16);
          return wrote;
        },
      }),
    );
    const def = rigWithAttrs();
    const plain = compileRig(def, skeleton);
    const withOp = compileRig({ ...def, solvers: [solver] }, skeleton);
    const evaluate = (program: RigProgram): { local: number[]; human: number[]; hips: number[] } => {
      const ch = program.allocChannels();
      for (const control of program.controlIds) {
        writeControlChannels(program, ch, control, { rx: 0.2, ry: -0.1, rz: 0.3 });
      }
      const pose = program.allocPose();
      program.evaluate(ch, pose);
      return { local: [...pose.boneLocal], human: [...pose.humanLocal], hips: [...pose.hipsPosition] };
    };
    expect(withOp.warnings.filter((w) => w.ids.includes(solver.id))).toEqual([]);
    const reference = evaluate(plain);
    expect(evaluate(withOp)).toEqual(reference);
    wrote = true;
    expect(evaluate(withOp).local).not.toEqual(reference.local);
  });

  it('registerBuiltinRigOps is reference-counted and registers nothing before A1', () => {
    const first = registerBuiltinRigOps();
    const second = registerBuiltinRigOps();
    const program = compileRig({ ...rigWithAttrs(), solvers: [solver] }, skeleton);
    expect(program.warnings.some((w) => w.code === 'unsupported-op' && w.ids[0] === solver.id)).toBe(true);
    first();
    first();
    second();
    // A host op of the same type can still register afterwards.
    dispose.push(
      registerRigOp('solver', 'ik2', {
        reads: () => ({ controls: [], nodes: [] }),
        writes: () => ({ controls: [], nodes: [] }),
        run: () => false,
      }),
    );
  });
});
