// MCP-SPEC §6.2, §5.1, §5.5, §5.7 (P2): the read tools on the headless kernel — scene_summary (with and without a user
// session), rig_describe (concise folding, drill-down, axis hints, the read budget on Seed-san with its secondary
// controls), keys_read (units, paging, cursors), curves_summary, pose_read (pose_set's shape, world space, the user's
// overrides only where the user sees them) and name resolution with candidates.
import { seededIdSource } from '@ekza-studio/doc';
import { createHeadlessEditorApp } from '@ekza-studio/editor-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAgentToolRuntime, tokensOf } from '../src';
import {
  AGENT,
  call,
  controlOf,
  dataOf,
  errorOf,
  foreignEdit,
  host,
  liveHost,
  type P2Fixture,
  p2Fixture,
  runtimeOf,
  runtimeReady,
  seedUserSession,
  signal,
} from './p2-support';
import { readSample } from './support';

describe('scene_summary (§6.2 tool 4)', () => {
  let fx: P2Fixture;
  beforeAll(async () => {
    fx = await p2Fixture(51);
  });

  it('lists characters, clips and the host, without user state headless', async () => {
    const data = dataOf<{
      host: { mode: string; grants: { edit: boolean }; toolset: string };
      characters: {
        name: string;
        humanoid: boolean;
        limbs: Record<string, string>;
        clips: { name: string; fps: number; rangeFrames: number[]; keyCount: number; active: boolean }[];
      }[];
      user?: unknown;
      history: { actor: string }[];
    }>(await call(runtimeOf(fx), 'scene_summary', {}));
    expect(data.host).toMatchObject({ mode: 'headless', grants: { edit: true } });
    expect(data.characters).toHaveLength(1);
    const character = data.characters[0];
    expect(character).toMatchObject({ name: 'Polybot', humanoid: true, limbs: { 'leg.L': 'ik', 'arm.L': 'fk' } });
    expect(character?.clips.map((clip) => clip.name)).toEqual(['clip1', 'agent', 'user']);
    expect(character?.clips.find((clip) => clip.name === 'agent')).toMatchObject({
      fps: 30,
      rangeFrames: [0, 30],
      keyCount: 3,
    });
    expect(character?.clips.find((clip) => clip.active)?.name).toBe('user');
    expect(data.user).toBeUndefined();
    expect(data.history.every((row) => row.actor === 'user')).toBe(true);
  });

  it('reports the user’s selection, selected keys, band, frame and overrides with a user session', async () => {
    const fresh = await p2Fixture(52);
    seedUserSession(fresh);
    const keys = new Map(fresh.keys.slice(0, 2).map((key) => [key, { key: true, in: true, out: true }]));
    fresh.app.session.setState({ selection: { ...fresh.app.session.getState().selection, keys } });
    const data = dataOf<{ user: Record<string, unknown> }>(
      await call(runtimeOf(fresh, liveHost()), 'scene_summary', {}),
    );
    expect(data.user).toMatchObject({
      activeCharacter: 'Polybot',
      activeClip: 'user',
      frame: 12,
      playing: false,
      band: [5, 10],
      overrides: 1,
      selection: {
        controls: ['fk.hand.R'],
        keys: [{ control: 'fk.lowerArm.L', channel: 'rz', frames: [0, 15] }],
        keyCount: 2,
        truncated: false,
      },
    });
  });
});

describe('rig_describe (§6.2 tool 5)', () => {
  let fx: P2Fixture;
  beforeAll(async () => {
    fx = await p2Fixture(53);
  });

  it('lists primary controls with channels, rotate order and mirror; folds secondary, finger and mode-hidden controls', async () => {
    const data = dataOf<{
      rig: string;
      secondary: { group: string; count: number }[];
      controls: {
        key: string;
        channels: string[];
        rotateOrder: string;
        mirror: string | null;
        bone: string | null;
        attrs: unknown[];
      }[];
      limbs: { limb: string; mode: string; ikControl: string; fk: string[] }[];
    }>(await call(runtimeOf(fx), 'rig_describe', {}));
    expect(data.rig).toBe('humanoid');
    const upperArm = data.controls.find((control) => control.key === 'fk.upperArm.L');
    expect(upperArm).toMatchObject({
      channels: ['rx', 'ry', 'rz'],
      rotateOrder: 'yxz',
      mirror: 'fk.upperArm.R',
      bone: 'leftUpperArm',
    });
    expect(data.controls.some((control) => control.key.startsWith('sec.'))).toBe(false);
    expect(data.controls.some((control) => control.key === 'fk.upperLeg.L')).toBe(false); // legs are IK: FK hidden
    expect(data.secondary).toContainEqual({ group: 'fingers.L', count: 15 });
    expect(data.secondary).toContainEqual({ group: 'leg.L fk (hidden in IK)', count: 3 });
    const ikLeg = data.controls.find((control) => control.key === 'ik.leg.L');
    expect(ikLeg?.channels).toContain('@ikFk');
    expect(data.limbs.find((limb) => limb.limb === 'leg.L')).toMatchObject({ mode: 'ik', ikControl: 'ik.leg.L' });
  });

  it('drills into a body part and gives axis hints in the character’s words when detailed', async () => {
    const data = dataOf<{
      controls: {
        key: string;
        axisHints?: Record<string, string>;
        restDirection?: number[];
        attrs: { name: string }[];
      }[];
    }>(await call(runtimeOf(fx), 'rig_describe', { bodyParts: ['leg.L'], detail: 'detailed' }));
    const keys = data.controls.map((control) => control.key);
    expect(keys).toContain('fk.upperLeg.L');
    expect(keys).toContain('ik.leg.L');
    expect(keys.some((key) => key.endsWith('.R'))).toBe(false);
    const ik = data.controls.find((control) => control.key === 'ik.leg.L');
    expect(ik?.attrs.map((attr) => attr.name)).toContain('ikFk');
    const thigh = data.controls.find((control) => control.key === 'fk.upperLeg.L');
    expect(Object.keys(thigh?.axisHints ?? {})).toEqual(['rx', 'ry', 'rz']);
    for (const hint of Object.values(thigh?.axisHints ?? {}))
      expect(hint).toMatch(/^(tip (up|down|forward|back|left|right) [\d.]+ cm|twist)/);
    // the thigh points down at rest
    expect(thigh?.restDirection?.[1]).toBeLessThan(-0.8);
    // the leg is IK at rest: its FK controls are measured in FK, so their channels move the tip
    expect(Object.values(thigh?.axisHints ?? {}).filter((hint) => hint.startsWith('tip')).length).toBeGreaterThan(1);
  });

  it('labels humanoid joints from the axis-hint numbers (§6.2: `elbow hinge; bend = ry−`)', async () => {
    type Rows = { controls: { key: string; label?: string; axisHints?: Record<string, string> }[] };
    const polybot = dataOf<Rows>(await call(runtimeOf(fx), 'rig_describe', { detail: 'detailed' }));
    const label = (data: Rows, key: string) => data.controls.find((control) => control.key === key)?.label;
    expect(label(polybot, 'fk.lowerArm.L')).toMatch(/^elbow hinge; bend = r[xyz][+−]/);
    expect(label(polybot, 'fk.lowerLeg.L')).toMatch(/^knee hinge; bend = r[xyz][+−]/);
    expect(label(polybot, 'fk.head')).toMatch(
      /^head; nod down = r[xyz][+−]; tilt left = r[xyz][+−]; turn left = r[xyz][+−]$/,
    );
    expect(label(polybot, 'cog')).toBeUndefined();
    // the bend channel and sign agree with the hint: its tip moves forward (elbow) / back (knee) with the sign
    const hintOf = (key: string, channel: string) =>
      polybot.controls.find((control) => control.key === key)?.axisHints?.[channel] ?? '';
    const [, elbow, elbowSign] = /bend = (r[xyz])([+−])/.exec(label(polybot, 'fk.lowerArm.L') ?? '') ?? [];
    expect(hintOf('fk.lowerArm.L', elbow ?? '')).toMatch(elbowSign === '+' ? /^tip forward/ : /^tip back/);
    const [, knee, kneeSign] = /bend = (r[xyz])([+−])/.exec(label(polybot, 'fk.lowerLeg.L') ?? '') ?? [];
    expect(hintOf('fk.lowerLeg.L', knee ?? '')).toMatch(kneeSign === '+' ? /^tip back/ : /^tip forward/);
    // Seed-san (T-pose): the spec's own example
    const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(10) });
    const loaded = await app.runUntyped('file.loadSample', { sample: 'seed-san' });
    await runtimeReady(app, (loaded as { value: { character: never } }).value.character);
    const seed = dataOf<Rows>(
      await createAgentToolRuntime({ app, host: host(), actor: AGENT }).call(
        'rig_describe',
        { bodyParts: ['arm.L', 'arm.R'], detail: 'detailed' },
        { signal: signal() },
      ),
    );
    expect(label(seed, 'fk.lowerArm.L')).toBe('elbow hinge; bend = ry−; twist = rx');
    expect(label(seed, 'fk.lowerArm.R')).toBe('elbow hinge; bend = ry+; twist = rx');
    expect(label(seed, 'fk.upperArm.L')).toBe('shoulder; raise = rz+; forward = ry−; twist = rx');
  });

  it('keeps the concise answer within the read budget on Seed-san with its secondary controls (§5.5)', async () => {
    const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(9) });
    const loaded = await app.runUntyped('file.loadSample', { sample: 'seed-san' });
    expect(loaded.status).toBe('finished');
    await runtimeReady(app, (loaded as { value: { character: never } }).value.character);
    const runtime = createAgentToolRuntime({ app, host: host(), actor: AGENT });
    const concise = await runtime.call('rig_describe', {}, { signal: signal() });
    const detailed = await runtime.call('rig_describe', { detail: 'detailed' }, { signal: signal() });
    expect(tokensOf(dataOf(concise))).toBeLessThanOrEqual(1_500);
    expect(tokensOf(dataOf(detailed))).toBeLessThanOrEqual(8_000);
    const summary = await runtime.call('scene_summary', {}, { signal: signal() });
    expect(tokensOf(dataOf(summary))).toBeLessThanOrEqual(600);
  });
});

describe('keys_read and curves_summary (§6.2 tools 6–7)', () => {
  let fx: P2Fixture;
  beforeAll(async () => {
    fx = await p2Fixture(54);
  });

  it('reads keys in the channel’s unit with tangents and flags', async () => {
    const result = await call(runtimeOf(fx), 'keys_read', {
      clip: 'agent',
      targets: { controls: ['L Lower Arm'], channels: ['rz'] },
    });
    const data = dataOf<{
      curves: { control: string; channel: string; unit: string; keys: [number, number, string, string, string][] }[];
      cursor: string | null;
    }>(result);
    expect(data.curves).toEqual([
      expect.objectContaining({
        control: 'fk.lowerArm.L',
        channel: 'rz',
        unit: 'deg',
        pre: 'constant',
        post: 'constant',
      }),
    ]);
    expect(data.curves[0]?.keys.map((key) => [key[0], key[1]])).toEqual([
      [0, 30],
      [15, -30],
      [30, 30],
    ]);
    expect(data.cursor).toBeNull();
    expect(result.ok && result.clip).toMatchObject({ name: 'agent', fps: 30, rangeFrames: [0, 30] });
  });

  it('pages with an opaque cursor bound to the same read', async () => {
    const runtime = runtimeOf(fx);
    const args = { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] }, limit: 2 };
    const first = dataOf<{ curves: { keys: unknown[] }[]; cursor: string | null; truncated: boolean }>(
      await call(runtime, 'keys_read', args),
    );
    expect(first.curves.flatMap((curve) => curve.keys)).toHaveLength(2);
    expect(first.cursor).toMatch(/^cur_[0-9A-Za-z]{12}$/);
    const second = dataOf<{ curves: { keys: unknown[] }[]; cursor: string | null }>(
      await call(runtime, 'keys_read', { ...args, cursor: first.cursor }),
    );
    expect(second.curves.flatMap((curve) => curve.keys)).toHaveLength(1);
    expect(second.cursor).toBeNull();
    const other = await call(runtime, 'keys_read', { ...args, limit: 3, cursor: first.cursor });
    expect(errorOf(other).code).toBe('expired_handle');
    expect(errorOf(other).hint).toContain('without cursor');
  });

  it('refuses the next page when the clip changed since the first (no skipped or repeated keys)', async () => {
    const local = await p2Fixture(53);
    const runtime = runtimeOf(local);
    const args = { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] }, limit: 2 };
    const first = dataOf<{ cursor: string | null }>(await call(runtime, 'keys_read', args));
    foreignEdit(local.app, local.keys[0] as never, 0.5);
    const next = await call(runtime, 'keys_read', { ...args, cursor: first.cursor });
    expect(errorOf(next)).toMatchObject({ code: 'expired_handle', hint: 'repeat the read without cursor' });
    expect(errorOf(next).message).toMatch(/^The clip changed since the first page \(revision \d+, now \d+\)\.$/);
  });

  it('answers not_found with up to five candidates by edit distance, ambiguous names never guessed', async () => {
    const missing = await call(runtimeOf(fx), 'keys_read', { clip: 'agent', targets: { controls: ['fk.lowrArm.L'] } });
    expect(errorOf(missing).code).toBe('not_found');
    expect(errorOf(missing).candidates?.[0]).toBe('fk.lowerArm.L (L Lower Arm, leftLowerArm)');
    expect(errorOf(missing).candidates?.length).toBeLessThanOrEqual(5);
    const clip = await call(runtimeOf(fx), 'keys_read', { clip: 'agnet', targets: { controls: ['cog'] } });
    expect(errorOf(clip).code).toBe('not_found');
    expect(errorOf(clip).candidates).toContain('agent');
    const channel = await call(runtimeOf(fx), 'keys_read', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'], channels: ['tx'] },
    });
    expect(errorOf(channel).code).toBe('not_keyable');
  });

  it('summarises curves: extremes with frames, overshoot, keys off whole frames', async () => {
    const data = dataOf<{
      curves: {
        control: string;
        channel: string;
        keyCount: number;
        min: number[];
        max: number[];
        overshootFrames: number[];
        tangents: Record<string, number>;
      }[];
      subframeKeys: number;
    }>(await call(runtimeOf(fx), 'curves_summary', { clip: 'agent' }));
    const rz = data.curves.find((curve) => curve.control === 'fk.lowerArm.L' && curve.channel === 'rz');
    expect(rz).toMatchObject({ keyCount: 3, max: [0, 30] });
    expect(rz?.min[0]).toBe(15);
    expect(rz?.min[1]).toBeCloseTo(-30, 1);
    expect(data.subframeKeys).toBe(0);
  });
});

describe('pose_read (§6.2 tool 8)', () => {
  let fx: P2Fixture;
  beforeAll(async () => {
    fx = await p2Fixture(55);
    seedUserSession(fx);
  });

  it('reads Channel Box values in pose_set’s shape and bone positions in character space', async () => {
    const data = dataOf<{
      frames: {
        frame: number;
        controls?: {
          control: string;
          rotateDeg?: Record<string, number>;
          translateM?: Record<string, number>;
          rotateOrder: string;
        }[];
        bones?: Record<string, { positionM: number[]; direction: number[]; orientDeg: Record<string, number> }>;
      }[];
      userOverrides: number;
    }>(
      await call(runtimeOf(fx), 'pose_read', {
        clip: 'agent',
        frames: [15],
        space: 'both',
        targets: { controls: ['fk.lowerArm.L', 'cog'] },
      }),
    );
    expect(data.frames).toHaveLength(1);
    const frame = data.frames[0];
    expect(frame?.controls).toEqual([
      { control: 'cog', translateM: { x: 0, y: 0, z: 0 }, rotateDeg: { x: 0, y: 0, z: 0 }, rotateOrder: 'zxy' },
      { control: 'fk.lowerArm.L', rotateDeg: { x: 0, y: 0, z: -30 }, rotateOrder: 'xzy' },
    ]);
    const hand = frame?.bones?.['leftLowerArm'];
    expect(hand?.positionM[0]).toBeGreaterThan(0); // the character's left arm is on +X
    expect(Math.hypot(...(hand?.direction ?? [0, 0, 0]))).toBeCloseTo(1, 3);
    expect(data.userOverrides).toBe(0);
  });

  it('shows the user’s overrides only at the user’s frame of the active clip, with withUserOverrides', async () => {
    const runtime = runtimeOf(fx, liveHost());
    const keyed = dataOf<{ frames: { controls: { rotateDeg: { x: number } }[] }[]; userOverrides: number }>(
      await call(runtime, 'pose_read', { clip: 'user', frames: [12], targets: { controls: ['fk.head'] } }),
    );
    expect(keyed.userOverrides).toBe(1);
    expect(keyed.frames[0]?.controls[0]?.rotateDeg.x).toBe(0);
    const seen = dataOf<{ frames: { controls: { rotateDeg: { x: number } }[] }[] }>(
      await call(runtime, 'pose_read', {
        clip: 'user',
        frames: [12],
        targets: { controls: ['fk.head'] },
        withUserOverrides: true,
      }),
    );
    expect(seen.frames[0]?.controls[0]?.rotateDeg.x).toBe(10);
    const elsewhere = dataOf<{ frames: { controls: { rotateDeg: { x: number } }[] }[] }>(
      await call(runtime, 'pose_read', {
        clip: 'user',
        frames: [3],
        targets: { controls: ['fk.head'] },
        withUserOverrides: true,
      }),
    );
    expect(elsewhere.frames[0]?.controls[0]?.rotateDeg.x).toBe(0);
  });

  it('samples a range with a step, at most 64 samples, inside the clip', async () => {
    const runtime = runtimeOf(fx);
    const data = dataOf<{ frames: { frame: number }[] }>(
      await call(runtime, 'pose_read', {
        clip: 'agent',
        rangeFrames: [0, 30],
        stepFrames: 10,
        targets: { controls: ['cog'] },
      }),
    );
    expect(data.frames.map((frame) => frame.frame)).toEqual([0, 10, 20, 30]);
    expect(
      errorOf(await call(runtime, 'pose_read', { clip: 'agent', rangeFrames: [0, 30], stepFrames: 0.1 })).code,
    ).toBe('limit');
    expect(errorOf(await call(runtime, 'pose_read', { clip: 'agent', frames: [31] })).code).toBe('out_of_range');
  });

  it('reads the user’s clip by default with a user session (reads never require clip)', async () => {
    const result = await call(runtimeOf(fx, liveHost()), 'pose_read', { targets: { controls: ['cog'] } });
    expect(result.ok && result.clip?.name).toBe('user');
    expect(dataOf<{ frames: { frame: number }[] }>(result).frames[0]?.frame).toBe(12);
    void controlOf;
  });
});
