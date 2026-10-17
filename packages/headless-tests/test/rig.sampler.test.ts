// WP-3 rig sampling against the shared test kit's store and curve engine (MVP-SPEC §3 convention 12): the curve
// cache, the clip sampler and the step schedule over the synthetic wave document. Switches to the memory store and
// the AnimX engine once WP-2 and WP-1 land (only the factories below change).
import {
  type ClipId,
  type ControlId,
  type CurveId,
  type CurveRecord,
  type DocSnapshot,
  type KeyId,
  type KeyRecord,
  type LayerId,
  type LayerRecord,
  type RigId,
} from '@ekza-animator/doc';
import { readSyntheticFixture } from '@ekza-animator/doc/testing';
import { createNaiveStore, naiveCurveEngine } from '@ekza-animator/editor-core/testing';
import {
  compileRig,
  computeStepSchedule,
  createClipSampler,
  createCurveCache,
  readControlChannels,
  readRigDefinition,
  type SkeletonDesc,
} from '@ekza-animator/rig';
import { afterEach, describe, expect, it } from 'vitest';

const DEG = Math.PI / 180;
const RIG = 'rig_SyntheticWave001' as RigId;
const CLIP = 'clp_SyntheticWave001' as ClipId;
const LAYER = 'lay_SyntheticWave001' as LayerId;
const CURVE = 'crv_SyntheticWave001' as CurveId;
const ARM = `${RIG}:fk.lowerArm.L` as ControlId;
const HEAD = `${RIG}:fk.head` as ControlId;

function setup() {
  const store = createNaiveStore();
  store.load(readSyntheticFixture('wave-doc.json') as DocSnapshot);
  const skeleton = readSyntheticFixture('humanoid-skeleton.json') as SkeletonDesc;
  const def = readRigDefinition(store, RIG);
  if (def === undefined) throw new Error('rig missing');
  const program = compileRig(def, skeleton);
  const cache = createCurveCache(store, naiveCurveEngine);
  const sampler = createClipSampler(store, cache, CLIP, program);
  return { store, program, cache, sampler, skeleton };
}

function curveRecord(
  id: string,
  control: ControlId,
  channel: CurveRecord['channel'],
  fields: Partial<CurveRecord> = {},
): CurveRecord {
  return {
    id: id as CurveId,
    clip: CLIP,
    layer: LAYER,
    control,
    channel,
    weighted: false,
    pre: 'constant',
    post: 'constant',
    staticValue: null,
    locked: false,
    muted: false,
    deleted: null,
    ...fields,
  };
}

function keyRecord(id: string, curve: string, t: number, v: number, fields: Partial<KeyRecord> = {}): KeyRecord {
  return {
    id: id as KeyId,
    clip: CLIP,
    curve: curve as CurveId,
    t,
    v,
    inType: 'linear',
    outType: 'linear',
    inHandle: { dt: 0, dv: 0 },
    outHandle: { dt: 0, dv: 0 },
    broken: false,
    weightLocked: true,
    ...fields,
  };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

describe('rig: curve cache and clip sampler (shared test kit store)', () => {
  it('samples base-layer curves into the channel buffer (defaults elsewhere)', () => {
    const { program, sampler, cache } = setup();
    disposers.push(
      () => sampler.dispose(),
      () => cache.dispose(),
    );
    const ch = program.allocChannels();
    sampler.sample(0, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(30 * DEG, 12);
    sampler.sample(15, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(-30 * DEG, 12);
    expect(readControlChannels(program, ch, HEAD)).toEqual({
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      ry: 0,
      rz: 0,
      sx: 1,
      sy: 1,
      sz: 1,
    });
    expect(sampler.value(ARM, 'rz', 30)).toBeCloseTo(30 * DEG, 12);
    expect(sampler.value(ARM, 'rx', 30)).toBeUndefined();
    expect(sampler.keyTimes(null)).toEqual([0, 15, 30]);
    expect(sampler.keyTimes([HEAD])).toEqual([]);
    expect(sampler.curveInfo(ARM)).toEqual([
      { channel: 'rz', keyTimes: [0, 15, 30], steppedThroughout: false, pre: 'constant', post: 'constant' },
    ]);
    expect(sampler.clip).toBe(CLIP);
  });

  it('drives the rig: the sampled wave rotates the lower arm bone', () => {
    const { program, sampler } = setup();
    const ch = program.allocChannels();
    const pose = program.allocPose();
    sampler.sample(15, ch);
    program.evaluate(ch, pose);
    const h = 19; // HUMAN_BONE_NAMES.indexOf('leftLowerArm')
    // N_leftLowerArm = rotation of −30° about Z (world-aligned control).
    expect(pose.humanLocal[h * 4 + 2]).toBeCloseTo(Math.sin(-15 * DEG), 12);
    expect(pose.humanLocal[h * 4 + 3]).toBeCloseTo(Math.cos(15 * DEG), 12);
  });

  it('invalidates compiled curves on commits and preview batches', () => {
    const { store, program, sampler, cache } = setup();
    const ch = program.allocChannels();
    const before = cache.version;
    store.transact({ label: 'Edit' }, (tx) =>
      tx.put('keys', { ...(tx.get('keys', 'k_SynthWave002' as KeyId) as KeyRecord), v: 10 * DEG }),
    );
    expect(cache.version).toBeGreaterThan(before);
    sampler.sample(15, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(10 * DEG, 12);

    const preview = store.beginPreview('Drag');
    preview.update((tx) =>
      tx.put('keys', { ...(tx.get('keys', 'k_SynthWave002' as KeyId) as KeyRecord), v: 50 * DEG }),
    );
    sampler.sample(15, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(50 * DEG, 12);
    preview.cancel();
    sampler.sample(15, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(10 * DEG, 12);
  });

  it('uses staticValue for key-less curves and the channel default without one', () => {
    const { store, program, sampler } = setup();
    store.transact({ label: 'Static' }, (tx) => {
      tx.put('curves', curveRecord('crv_StaticHeadRx001', HEAD, 'rx', { staticValue: 0.25 }));
      tx.put('curves', curveRecord('crv_StaticHeadSx001', HEAD, 'sx'));
    });
    const ch = program.allocChannels();
    sampler.sample(3, ch);
    expect(readControlChannels(program, ch, HEAD)).toMatchObject({ rx: 0.25, sx: 1 });
    expect(sampler.value(HEAD, 'rx', 3)).toBe(0.25);
    expect(sampler.curveInfo(HEAD).map((info) => info.channel)).toEqual(['rx', 'sx']);
    expect(sampler.keyTimes([HEAD])).toEqual([]);
  });

  it('unions duplicate curves of one channel and recompiles when a duplicate changes', () => {
    const { store, program, sampler, cache } = setup();
    // A duplicate curve (greater id) of the wave channel with an extra key at frame 7.
    store.transact({ label: 'Duplicate' }, (tx) => {
      tx.put('curves', curveRecord('crv_ZDuplicateWave01', ARM, 'rz'));
      tx.put('keys', keyRecord('k_DuplicateK01', 'crv_ZDuplicateWave01', 7, 0));
    });
    expect(sampler.keyTimes([ARM])).toEqual([0, 7, 15, 30]);
    const v = cache.version;
    store.transact({ label: 'Move' }, (tx) =>
      tx.put('keys', keyRecord('k_DuplicateK01', 'crv_ZDuplicateWave01', 7, 1)),
    );
    expect(cache.version).toBeGreaterThan(v);
    expect(sampler.value(ARM, 'rz', 7)).toBe(1);
    const ch = program.allocChannels();
    sampler.sample(7, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBe(1);
  });

  it('samples only the canonical (smallest id) curve when the store also lists duplicates', () => {
    const { store, program } = setup();
    store.transact({ label: 'Duplicate' }, (tx) => {
      tx.put('curves', curveRecord('crv_ZDuplicateWave01', ARM, 'rz', { staticValue: 5 }));
    });
    // A store whose curvesOfClip lists every curve record, duplicates included (the contract leaves it open).
    const all = (clip: ClipId): readonly CurveRecord[] =>
      store.list('curves').filter((curve) => curve.clip === clip && curve.deleted === null);
    const query = new Proxy(store.query, {
      get: (target, prop) => (prop === 'curvesOfClip' ? all : (Reflect.get(target, prop, target) as unknown)),
    });
    const view = new Proxy(store, {
      get: (target, prop) => {
        if (prop === 'query') return query;
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function'
          ? ((value as (...args: unknown[]) => unknown).bind(target) as unknown)
          : value;
      },
    });
    expect(view.query.curvesOfClip(CLIP).filter((curve) => curve.control === ARM)).toHaveLength(2);
    const cache = createCurveCache(view, naiveCurveEngine);
    const sampler = createClipSampler(view, cache, CLIP, program);
    disposers.push(
      () => sampler.dispose(),
      () => cache.dispose(),
    );
    const ch = program.allocChannels();
    sampler.sample(15, ch);
    expect(readControlChannels(program, ch, ARM).rz).toBeCloseTo(-30 * DEG, 12);
    expect(sampler.curveInfo(ARM).map((info) => info.channel)).toEqual(['rz']);
  });

  it('ignores curves of other layers and of controls outside the program', () => {
    const { store, program, sampler } = setup();
    const second: LayerRecord = {
      id: 'lay_SecondLayer00001' as LayerId,
      clip: CLIP,
      name: 'Layer 2',
      mode: 'additive',
      weight: 1,
      mute: false,
      solo: false,
      owner: null,
      order: 'a1',
      deleted: null,
    };
    store.transact({ label: 'Layers' }, (tx) => {
      tx.put('layers', second);
      tx.put('curves', curveRecord('crv_SecondLayerRx01', HEAD, 'rx', { layer: second.id, staticValue: 9 }));
      tx.put('curves', curveRecord('crv_ForeignControl1', 'rig_Other:fk.head' as ControlId, 'rx', { staticValue: 9 }));
    });
    const ch = program.allocChannels();
    sampler.sample(0, ch);
    expect(readControlChannels(program, ch, HEAD).rx).toBe(0);
    expect(sampler.value(HEAD, 'rx', 0)).toBeUndefined();
  });

  it('clears on load and stops listening when disposed', () => {
    const { store, cache, sampler } = setup();
    cache.get(CURVE);
    const v = cache.version;
    store.load(store.snapshot());
    expect(cache.version).toBe(v + 1);
    sampler.dispose();
    cache.dispose();
    store.transact({ label: 'Edit' }, (tx) =>
      tx.put('keys', { ...(tx.get('keys', 'k_SynthWave001' as KeyId) as KeyRecord), v: 0 }),
    );
    expect(cache.version).toBe(v + 1);
    expect(() => createCurveCache(store, naiveCurveEngine).get('crv_Missing0000000001' as CurveId)).toThrow(
      /does not exist/,
    );
  });
});

describe('rig: step schedule over a real sampler', () => {
  it('schedules STEP tracks once every key of the influencing curves is stepped', () => {
    const { store, program, sampler } = setup();
    const range = { start: 0, end: 30 };
    expect(computeStepSchedule(program, sampler, range, 'raw').size).toBe(0);
    store.transact({ label: 'Stepped' }, (tx) => {
      for (const key of tx.query.keysOfCurve(CURVE)) tx.put('keys', { ...key, outType: 'step' });
    });
    const schedule = computeStepSchedule(program, sampler, range, 'raw');
    const lowerArm = 10; // node of leftLowerArm in humanoid-skeleton.json
    expect(schedule.get(`${lowerArm}/rotation`)).toEqual([0, 15, 30]);
    expect(computeStepSchedule(program, sampler, range, 'humanoid').get('19/rotation')).toEqual([0, 15, 30]);
  });
});
