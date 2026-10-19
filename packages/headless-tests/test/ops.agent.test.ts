// MCP-SPEC §8 P1 on the licensed fixtures, headless (`createHeadlessEditorApp`): `pose.goals` aims reach within 0.5°
// on Seed-san (T-pose) and Polybot (A-pose) when unconstrained and IK goals within 1 mm in reach; `ensureIk: 'never'`
// poll-fails on an FK limb and `'auto'` switches only its range (FK keys outside `[start − 1, end + 1]` stay byte
// for byte); `clip.makeLoop` closes a walk's seam in value and slope (E2E-M2A-23's check); `rig.ikFk.matchRange
// {clip}` runs for an agent on a clip that is not the user's and keeps the user's session.
import { type CharacterId, type ClipId, type ControlId, type CurveId, seededIdSource } from '@ekza-animator/doc';
import { readFixture } from '@ekza-animator/doc/testing';
import {
  AGENT_PROTECTED_SESSION_FIELDS,
  createHeadlessEditorApp,
  type EditorApp,
  type ImportResult,
  type RunActor,
  type RunContext,
  type SampleDef,
} from '@ekza-animator/editor-core';
import { describe, expect, it } from 'vitest';
import { BLOCKED, runOk, runtimeOf, SIBLINGS_READY } from './ops.support';

const DEG = Math.PI / 180;
const AGENT: RunActor = { kind: 'agent', id: 'agt_P1HeadlessTest', name: 'P1 Headless' };
const AS_AGENT: RunContext = { source: 'api', actor: AGENT, access: 'edit' };

const readSample = (sample: SampleDef): Promise<Uint8Array> =>
  Promise.resolve(readFixture(sample.file as 'polybot.vrm' | 'seed-san.vrm'));

interface Bot {
  readonly app: EditorApp;
  readonly character: CharacterId;
  /** An empty clip 0…30 the agent edits (the user's active clip is another one). */
  readonly clip: ClipId;
  readonly userClip: ClipId;
}

async function load(sample: 'polybot' | 'seed-san', seed = 31): Promise<Bot> {
  const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(seed) });
  const imported = (await runOk(app, 'file.loadSample', { sample })) as ImportResult;
  await runtimeOf(app, imported.character);
  const { clip } = (await runOk(app, 'clip.new', {
    character: imported.character,
    name: 'agent',
    range: { start: 0, end: 30 },
  })) as { clip: ClipId };
  const { clip: userClip } = (await runOk(app, 'clip.new', {
    character: imported.character,
    name: 'user',
    range: { start: 0, end: 30 },
  })) as { clip: ClipId };
  return { app, character: imported.character, clip, userClip };
}

function control(bot: Bot, key: string): ControlId {
  const rig = bot.app.store.query.rigOfCharacter(bot.character);
  const record = rig === undefined ? undefined : bot.app.store.query.controlByKey(rig.id, key);
  if (record === undefined) throw new Error(`no control ${key}`);
  return record.id;
}

async function agent(app: EditorApp, id: string, args: unknown): Promise<unknown> {
  const result = await app.runUntyped(id, args, AS_AGENT);
  if (result.status !== 'finished') throw new Error(`${id} did not finish: ${JSON.stringify(result)}`);
  return result.value;
}

async function refusal(app: EditorApp, id: string, args: unknown): Promise<string> {
  const result = await app.runUntyped(id, args, AS_AGENT);
  if (result.status !== 'cancelled') throw new Error(`${id} was not refused: ${JSON.stringify(result)}`);
  return result.reason;
}

function sessionRecord(app: EditorApp): unknown[] {
  const state = app.session.getState() as unknown as Readonly<Record<string, unknown>>;
  return [...AGENT_PROTECTED_SESSION_FIELDS.map((field) => state[field]), app.prefs.getState()];
}

/** A user session with a selection, a frame, a band and an override on the user's own clip. */
function seedUser(bot: Bot): void {
  const { app } = bot;
  const state = app.session.getState();
  app.session.setState({
    activeClip: { ...state.activeClip, [bot.character]: bot.userClip },
    selection: { ...state.selection, controls: [control(bot, 'fk.hand.R')] },
    time: { ...state.time, sceneFrame: 12, band: { start: 5, end: 10 } },
  });
  app.session.setState({ overrides: new Map([[control(bot, 'fk.head'), { rx: 10 * DEG }]]) });
}

/** World position of a humanoid bone at a clip frame (keyed pose, no overrides). */
function boneAt(bot: Bot, bone: string, frame: number, clip: ClipId = bot.clip): [number, number, number] {
  const runtime = bot.app.characters.get(bot.character);
  const node = runtime?.skeleton.humanoid?.[bone as 'hips'];
  if (runtime === undefined || node === undefined) throw new Error(`no bone ${bone}`);
  const pose = runtime.program.allocPose();
  bot.app.evaluation.evaluateAt(bot.character, clip, frame, pose, { withOverrides: false });
  const w = pose.boneWorld;
  return [w[node * 16 + 12] as number, w[node * 16 + 13] as number, w[node * 16 + 14] as number];
}

function sub(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
}

function angle(a: readonly number[], b: readonly number[]): number {
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  const dot = ((a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

function curveOf(bot: Bot, key: string, channel: string, clip: ClipId = bot.clip): CurveId | undefined {
  const layer = bot.app.store.query.baseLayer(clip);
  return layer === undefined
    ? undefined
    : bot.app.store.query.curveFor(clip, layer.id, control(bot, key), channel as never)?.id;
}

interface GoalsResult {
  readonly aims: readonly { readonly bone: string; readonly errorRad: number }[];
  readonly ik: readonly {
    readonly limb: string;
    readonly reached: boolean;
    readonly errorM: number;
    readonly switched: unknown;
  }[];
  readonly keyed: number;
}

describe.skipIf(!SIBLINGS_READY)(`pose.goals (MCP-SPEC §4.10) ${SIBLINGS_READY ? '' : BLOCKED}`, () => {
  for (const sample of ['seed-san', 'polybot'] as const) {
    it(`aims reach within 0.5° on ${sample} (the wave script's arm aims, keyed at each frame)`, async () => {
      const bot = await load(sample);
      seedUser(bot);
      const before = sessionRecord(bot.app);
      for (let i = 0; i <= 6; i++) {
        const lower = i % 2 === 0 ? [0.55, 0.83, 0.1] : [-0.25, 0.97, 0.1];
        const result = (await agent(bot.app, 'pose.goals', {
          clip: bot.clip,
          frame: 10 * i,
          aims: [
            { bone: 'leftUpperArm', direction: [0.8, 0.6, 0], keepTwist: true, weight: 1 },
            { bone: 'leftLowerArm', direction: lower, keepTwist: true, weight: 1 },
          ],
          extendRange: true,
          label: `Aim pose (2 bones) @ f${10 * i}`,
        })) as GoalsResult;
        expect(result.aims.map((aim) => aim.errorRad < 0.5 * DEG)).toEqual([true, true]);
        // Independently: the evaluated bones point where asked.
        const upper = sub(boneAt(bot, 'leftLowerArm', 10 * i), boneAt(bot, 'leftUpperArm', 10 * i));
        const forearm = sub(boneAt(bot, 'leftHand', 10 * i), boneAt(bot, 'leftLowerArm', 10 * i));
        expect(angle(upper, [0.8, 0.6, 0])).toBeLessThan(0.5 * DEG);
        expect(angle(forearm, lower)).toBeLessThan(0.5 * DEG);
      }
      // Keys at exactly 0, 10, …, 60 on the aimed controls; the user's session never moved.
      const rz = curveOf(bot, 'fk.lowerArm.L', 'rz') as CurveId;
      expect(bot.app.store.query.keysOfCurve(rz).map((key) => key.t)).toEqual([0, 10, 20, 30, 40, 50, 60]);
      expect(sessionRecord(bot.app).every((value, i) => value === before[i])).toBe(true);
      bot.app.dispose();
    });
  }

  it('keys the solved controls at the frame only, one AI step per call', async () => {
    const bot = await load('polybot');
    const result = (await agent(bot.app, 'pose.goals', {
      clip: bot.clip,
      frame: 40,
      extendRange: true,
      aims: [{ bone: 'leftUpperArm', direction: [0.8, 0.6, 0], keepTwist: true, weight: 1 }],
      label: 'Aim pose (1 bone) @ f40',
    })) as GoalsResult;
    expect(result.keyed).toBeGreaterThan(0);
    const curve = curveOf(bot, 'fk.upperArm.L', 'rz') as CurveId;
    expect(bot.app.store.query.keysOfCurve(curve).map((key) => key.t)).toEqual([40]);
    expect(bot.app.store.get('clips', bot.clip)?.range).toEqual({ start: 0, end: 40 });
    expect(bot.app.history.peekUndo()?.label).toBe('AI: Aim pose (1 bone) @ f40');
    bot.app.dispose();
  });

  it('weights, split and keepTwist: false', async () => {
    const bot = await load('seed-san');
    const half = (await agent(bot.app, 'pose.goals', {
      clip: bot.clip,
      frame: 5,
      aims: [{ bone: 'leftUpperArm', direction: [0, -1, 0], keepTwist: false, weight: 0.5 }],
    })) as GoalsResult;
    // Half way from the T-pose (along +X) to straight down: about 45° off the requested direction.
    expect(half.aims[0]?.errorRad).toBeGreaterThan(30 * DEG);
    expect(half.aims[0]?.errorRad).toBeLessThan(60 * DEG);
    const look = (await agent(bot.app, 'pose.goals', {
      clip: bot.clip,
      frame: 10,
      aims: [{ bone: 'head', direction: [1, 0, 1], keepTwist: true, weight: 1, split: { neck: 0.4, head: 0.6 } }],
    })) as GoalsResult;
    expect(look.aims[0]?.errorRad).toBeLessThan(0.5 * DEG);
    expect(bot.app.store.query.keysOfCurve(curveOf(bot, 'fk.neck', 'ry') as CurveId)).toHaveLength(1);
    bot.app.dispose();
  });

  it("ensureIk: 'never' poll-fails on an FK limb; a bone of an IK limb is refused for aims", async () => {
    const bot = await load('polybot');
    const hand = boneAt(bot, 'leftHand', 10);
    expect(
      await refusal(bot.app, 'pose.goals', {
        clip: bot.clip,
        frame: 10,
        ik: [{ limb: 'arm.L', position: [hand[0], hand[1] + 0.05, hand[2]], ensureIk: 'never' }],
      }),
    ).toBe("the limb is FK at this frame; use pose_aim, or pass ensureIk 'auto' with a switch range");
    await agent(bot.app, 'pose.goals', {
      clip: bot.clip,
      frame: 10,
      ik: [{ limb: 'arm.L', position: hand, ensureIk: 'auto', switchRange: { start: 5, end: 15 } }],
    });
    expect(
      await refusal(bot.app, 'pose.goals', {
        clip: bot.clip,
        frame: 10,
        aims: [{ bone: 'leftLowerArm', direction: [0, 1, 0], keepTwist: true, weight: 1 }],
      }),
    ).toMatch(/is IK-driven .*use pose_ik_target/);
    bot.app.dispose();
  });

  for (const [sample, limb, end] of [
    ['polybot', 'leg.L', 'leftFoot'],
    ['seed-san', 'leg.R', 'rightFoot'],
  ] as const) {
    it(`places an IK ${limb} within 1 mm (${sample}, IK at rest)`, async () => {
      const bot = await load(sample);
      const at = boneAt(bot, end, 10);
      const target: [number, number, number] = [at[0] + 0.03, at[1] + 0.08, at[2] + 0.05];
      const result = (await agent(bot.app, 'pose.goals', {
        clip: bot.clip,
        frame: 10,
        ik: [{ limb, position: target, ensureIk: 'never' }],
      })) as GoalsResult;
      expect(result.ik[0]).toMatchObject({ limb, reached: true, switched: null });
      expect(Math.hypot(...sub(boneAt(bot, end, 10), target))).toBeLessThan(1e-3);
      // Out of reach: the goal is not met, and the call says so instead of failing.
      const far = (await agent(bot.app, 'pose.goals', {
        clip: bot.clip,
        frame: 20,
        ik: [{ limb, position: [at[0], at[1] + 3, at[2]], ensureIk: 'never' }],
      })) as GoalsResult;
      expect(far.ik[0]?.reached).toBe(false);
      expect(far.ik[0]?.errorM).toBeGreaterThan(0.5);
      bot.app.dispose();
    });
  }

  for (const [sample, limb, end] of [
    ['polybot', 'arm.L', 'leftHand'],
    ['seed-san', 'arm.L', 'leftHand'],
  ] as const) {
    it(`ensureIk: 'auto' switches only its range and places ${limb} within 1 mm (${sample})`, async () => {
      const bot = await load(sample);
      seedUser(bot);
      const before = sessionRecord(bot.app);
      const limbKey = limb.startsWith('arm') ? 'fk.upperArm.L' : 'fk.upperLeg.L';
      // FK keys before, inside and after the switch range.
      await agent(bot.app, 'key.write', {
        clip: bot.clip,
        keys: [0, 2, 10, 20, 30].map((frame) => ({
          control: control(bot, limbKey),
          channel: 'rx',
          value: (frame - 15) * 0.5 * DEG,
          frame,
        })),
      });
      const fkCurve = curveOf(bot, limbKey, 'rx') as CurveId;
      const outside = bot.app.store.query.keysOfCurve(fkCurve).filter((key) => key.t < 7 || key.t > 13);
      // In reach: 15 % of the way from the hand to the shoulder joint, a little up and forward (Seed-san's T-pose
      // arm is straight, so anything farther out is out of reach).
      const at = boneAt(bot, end, 10);
      const shoulder = boneAt(bot, 'leftUpperArm', 10);
      const target: [number, number, number] = [
        at[0] + 0.15 * (shoulder[0] - at[0]),
        at[1] + 0.15 * (shoulder[1] - at[1]) + 0.02,
        at[2] + 0.15 * (shoulder[2] - at[2]) + 0.04,
      ];
      const result = (await agent(bot.app, 'pose.goals', {
        clip: bot.clip,
        frame: 10,
        ik: [{ limb, position: target, ensureIk: 'auto', switchRange: { start: 8, end: 12 } }],
      })) as GoalsResult;
      expect(result.ik[0]).toMatchObject({ reached: true, switched: { start: 8, end: 12 } });
      expect(result.ik[0]?.errorM).toBeLessThan(1e-3);
      expect(Math.hypot(...sub(boneAt(bot, end, 10), target))).toBeLessThan(1e-3);
      // FK keys outside [7, 13] are byte-identical; @ikFk steps 0 → 1 → 0 around the range.
      const after = bot.app.store.query.keysOfCurve(fkCurve).filter((key) => key.t < 7 || key.t > 13);
      expect(JSON.stringify(after)).toBe(JSON.stringify(outside));
      const runtime = bot.app.characters.get(bot.character);
      const ikControl = runtime?.program.limbs.find((candidate) => candidate.id === limb)?.params.ikControl;
      const layer = bot.app.store.query.baseLayer(bot.clip);
      if (layer === undefined || ikControl === undefined) throw new Error('no limb');
      const ikFk = bot.app.store.query.curveFor(bot.clip, layer.id, ikControl, '@ikFk');
      expect(bot.app.store.query.keysOfCurve(ikFk?.id as CurveId).map((key) => [key.t, key.v, key.outType])).toEqual([
        [7, 0, 'step'],
        [8, 1, 'step'],
        [12, 1, 'step'],
        [13, 0, 'step'],
      ]);
      // Before and after the range the limb plays its FK keys unchanged.
      expect(sessionRecord(bot.app).every((value, i) => value === before[i])).toBe(true);
      bot.app.dispose();
    });
  }
});

describe.skipIf(!SIBLINGS_READY)(`clip.makeLoop on a walk (E2E-M2A-23's seam) ${SIBLINGS_READY ? '' : BLOCKED}`, () => {
  /** A Polybot walk 0…24 whose seam is broken in value and slope, with 0.6 m of root travel in z. */
  async function walk(): Promise<Bot> {
    const bot = await load('polybot', 41);
    await runOk(bot.app, 'clip.setSettings', { clip: bot.clip, range: { start: 0, end: 24 } });
    const k = (key: string, channel: string, pairs: readonly (readonly [number, number])[]) =>
      pairs.map(([frame, value]) => ({ control: control(bot, key), channel, frame, value }));
    await agent(bot.app, 'key.write', {
      clip: bot.clip,
      keys: [
        ...k('cog', 'ty', [
          [0, -0.05],
          [6, -0.02],
          [12, -0.05],
          [18, -0.02],
          [24, -0.04],
        ]),
        ...k('cog', 'tx', [
          [0, 0],
          [6, 0.02],
          [12, 0],
          [18, -0.02],
          [24, 0.01],
        ]),
        ...k('cog', 'tz', [
          [0, 0],
          [24, 0.6],
        ]),
        ...k('fk.upperLeg.L', 'rx', [
          [0, 20 * DEG],
          [12, -20 * DEG],
          [24, 15 * DEG],
        ]),
        ...k('fk.upperLeg.R', 'rx', [
          [0, -20 * DEG],
          [12, 20 * DEG],
          [24, -25 * DEG],
        ]),
      ],
    });
    return bot;
  }

  /** E2E-M2A-23's seam check on every animated curve: value (1e-6) and one-sided slopes (1e-9). */
  function seamOk(bot: Bot, skipTravel: boolean): string[] {
    const bad: string[] = [];
    const layer = bot.app.store.query.baseLayer(bot.clip);
    for (const curve of bot.app.store.query.curvesOfClip(bot.clip)) {
      if (curve.layer !== layer?.id || bot.app.store.query.keysOfCurve(curve.id).length === 0) continue;
      const compiled = bot.app.evaluation.compiledCurve(curve.id);
      const n = compiled.keyCount;
      const travel =
        skipTravel && curve.control === control(bot, 'cog') && (curve.channel === 'tx' || curve.channel === 'tz');
      const c0 = Math.abs((compiled.v[n - 1] as number) - (compiled.v[0] as number));
      const c1 = Math.abs((compiled.inSlope[n - 1] as number) - (compiled.outSlope[0] as number));
      if ((!travel && c0 > 1e-6) || c1 > 1e-9 || compiled.t[0] !== 0 || compiled.t[n - 1] !== 24) {
        bad.push(`${curve.control}/${curve.channel} c0=${c0} c1=${c1}`);
      }
    }
    return bad;
  }

  for (const method of ['matchEnds', 'blend'] as const) {
    it(`${method} with the travel removed: C0 and C1 at the seam, pose at 24 = pose at 0`, async () => {
      const bot = await walk();
      const value = (await agent(bot.app, 'clip.makeLoop', { clip: bot.clip, method, rootTravel: 'inPlace' })) as {
        before: { maxC0: number };
        after: { maxC0: number; maxC1: number };
      };
      expect(value.before.maxC0).toBeGreaterThan(0.5);
      expect(value.after.maxC0).toBeLessThan(1e-9);
      expect(value.after.maxC1).toBeLessThan(1e-9);
      expect(seamOk(bot, false)).toEqual([]);
      for (const bone of ['hips', 'leftFoot', 'rightFoot', 'leftLowerLeg']) {
        expect(Math.hypot(...sub(boneAt(bot, bone, 24), boneAt(bot, bone, 0)))).toBeLessThan(1e-6);
      }
      bot.app.dispose();
    });
  }

  it('cycleOffset keeps the travel and still matches slopes; cycleOnly passes on a closed seam', async () => {
    const bot = await walk();
    await agent(bot.app, 'clip.makeLoop', { clip: bot.clip, method: 'matchEnds', rootTravel: 'cycleOffset' });
    expect(seamOk(bot, true)).toEqual([]);
    expect(bot.app.store.get('curves', curveOf(bot, 'cog', 'tz') as CurveId)).toMatchObject({
      pre: 'cycleOffset',
      post: 'cycleOffset',
    });
    const closed = (await agent(bot.app, 'clip.makeLoop', {
      clip: bot.clip,
      method: 'cycleOnly',
      rootTravel: 'cycleOffset',
    })) as {
      after: { maxC0: number; maxC1: number };
    };
    expect(closed.after.maxC0).toBeLessThan(1e-9);
    expect(closed.after.maxC1).toBeLessThan(1e-9);
    bot.app.dispose();
  });
});

describe.skipIf(!SIBLINGS_READY)(`rig.ikFk.matchRange {clip} for agents ${SIBLINGS_READY ? '' : BLOCKED}`, () => {
  it("matches a range of the agent's clip, not the user's, and keeps the user's session", async () => {
    const bot = await load('polybot');
    await agent(bot.app, 'key.write', {
      clip: bot.clip,
      keys: [0, 10].map((frame) => ({
        control: control(bot, 'fk.lowerArm.L'),
        channel: 'rz',
        frame,
        value: frame * DEG,
      })),
    });
    seedUser(bot);
    const before = sessionRecord(bot.app);
    const value = await agent(bot.app, 'rig.ikFk.matchRange', {
      limb: 'arm.L',
      side: 'ik',
      clip: bot.clip,
      range: { start: 0, end: 10 },
      step: 'frames',
    });
    expect((value as { count: number }).count).toBeGreaterThan(0);
    expect(sessionRecord(bot.app).every((v, i) => v === before[i])).toBe(true);
    const ik = curveOf(bot, 'ik.arm.L', 'tx');
    expect(ik === undefined ? [] : bot.app.store.query.keysOfCurve(ik).map((key) => key.t)).toHaveLength(11);
    expect(curveOf(bot, 'ik.arm.L', 'tx', bot.userClip)).toBeUndefined();
    bot.app.dispose();
  });
});
