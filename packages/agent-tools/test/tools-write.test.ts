// MCP-SPEC §6.3–§6.6, §5.2, §5.6, §5.9, §5.12 (P2): the write tools on the headless kernel, with P1's operators (the
// real ones once READY.p1, else the test doubles of test/p1-doubles.ts): degrees land as radians, one `AI: <intent> ·
// <label>` step per call attributed to the actor, the user's session untouched, explicit clips with a user session,
// out-of-range and limits, the strict and the automatic stale check, confirmations, keys_adjust's amplitude,
// pose_set's always-key rule and pose_read round trip, goal posing, clips. Tools over P1's scope migrations
// (keys_tween, curves_set_interpolation, curves_euler_filter, curves_simplify) are gated on READY.p1.
import type { ClipId } from '@ekza-animator/doc';
import { type ConfirmPrompt, keySelection } from '../src';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  call,
  controlOf,
  dataOf,
  errorOf,
  foreignEdit,
  host,
  keysOf,
  liveHost,
  type P2Fixture,
  p2Fixture,
  runtimeOf,
  seedUserSession,
  sessionRecord,
} from './p2-support';
import { READY } from './ready';
import { AGENT } from './support';

const DEG = Math.PI / 180;
let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(61);
});

const clipId = (name: string): ClipId => {
  const clip = fx.app.store.query.clipsOfCharacter(fx.character).find((candidate) => candidate.name === name);
  if (clip === undefined) throw new Error(`no clip ${name}`);
  return clip.id;
};

describe('keys_set (§6.4 tool 14)', () => {
  it('writes degrees as radians in one AI step labelled with the intent, attributed to the actor', async () => {
    const result = await call(runtimeOf(fx), 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.upperArm.L', channel: 'rz', frame: 10, value: 45 }],
      intent: 'Raise the arm',
    });
    expect(dataOf(result)).toMatchObject({ written: 1, curvesCreated: 1, rangeExtended: false, hiddenByOverrides: [] });
    expect(keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.upperArm.L'), 'rz')).toEqual([
      [10, 45 * DEG],
    ]);
    const step = fx.app.history.peekUndo();
    expect(step?.label).toBe('AI: Raise the arm · Set keys (1 on 1 curve)');
    expect(step?.actor).toEqual(AGENT);
    expect(result.ok && result.undo).toEqual({ step: step?.id, label: step?.label });
    expect(result.ok && result.clip).toMatchObject({ name: 'agent' });
    expect(result.ok && typeof result.clip?.revision).toBe('number');
  });

  it('keeps the user’s session as it was and needs clip with a user session (§5.1, §5.7)', async () => {
    seedUserSession(fx);
    const before = sessionRecord(fx.app);
    const runtime = runtimeOf(fx, liveHost());
    const missing = await call(runtime, 'keys_set', {
      keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.1 }],
    });
    expect(errorOf(missing)).toMatchObject({ code: 'invalid_args', candidates: ['user', 'clip1', 'agent'] });
    const ok = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0.1 }],
    });
    expect(ok.ok).toBe(true);
    expect(sessionRecord(fx.app)).toEqual(before);
    for (const [field, value] of Object.entries(before))
      expect([field, sessionRecord(fx.app)[field] === value]).toEqual([field, true]);
  });

  it('refuses frames outside the range unless extendRange, and ranges beyond 100,000 frames', async () => {
    const runtime = runtimeOf(fx);
    const key = { control: 'cog', channel: 'ty', frame: 40, value: 0 };
    expect(errorOf(await call(runtime, 'keys_set', { clip: 'agent', keys: [key] }))).toMatchObject({
      code: 'out_of_range',
      hint: 'pass extendRange: true or change the range with clip_update',
    });
    const grown = await call(runtime, 'keys_set', { clip: 'agent', keys: [key], extendRange: true });
    expect(dataOf(grown)).toMatchObject({ rangeExtended: true });
    expect(fx.app.store.get('clips', fx.agentClip)?.range).toEqual({ start: 0, end: 40 });
    const far = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [
        { ...key, frame: -50 },
        { ...key, frame: 99_990 },
      ],
      extendRange: true,
    });
    expect(errorOf(far).code).toBe('limit');
    const bounds = await call(runtime, 'keys_set', { clip: 'agent', keys: [{ ...key, frame: 200_000 }] });
    expect(errorOf(bounds)).toMatchObject({ code: 'invalid_args', detail: { path: 'keys[0].frame' } });
  });

  it('answers locked_channel and not_keyable for explicit channels, and warns about radians', async () => {
    const runtime = runtimeOf(fx);
    const head = controlOf(fx.app, fx.character, 'fk.head');
    fx.app.store.transact({ label: 'lock' }, (tx) =>
      tx.patch('controls', head, {
        locked: { t: [false, false, false], r: [true, false, false], s: [false, false, false] },
      }),
    );
    const locked = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.head', channel: 'rx', frame: 0, value: 5 }],
    });
    expect(errorOf(locked).code).toBe('locked_channel');
    const translate = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.head', channel: 'tx', frame: 0, value: 5 }],
    });
    expect(errorOf(translate).code).toBe('not_keyable');
    const small = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.head', channel: 'ry', frame: 0, value: 0.5 }],
    });
    expect(small.ok && small.warnings).toContain('values look like radians; this field is in degrees');
  });

  it('keys the keyed pose of body parts at frames (keyPoseAt)', async () => {
    const result = await call(runtimeOf(fx), 'keys_set', {
      clip: 'agent',
      keyPoseAt: { bodyParts: ['arm.L'], frames: [5, 25] },
    });
    const data = dataOf<{ written: number }>(result);
    expect(data.written).toBeGreaterThan(0);
    const forearm = keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz').map(
      ([t]) => t,
    );
    expect(forearm).toEqual([0, 5, 15, 25, 30]);
  });
});

describe('the stale check (§5.12)', () => {
  it('fails a strict ifClipRevision after any change', async () => {
    const runtime = runtimeOf(fx);
    const read = await call(runtime, 'keys_read', { clip: 'agent', targets: { controls: ['cog'] } });
    const revision = read.ok ? (read.clip?.revision ?? -1) : -1;
    foreignEdit(fx.app, fx.keys[1] as never, -10 * DEG);
    const stale = await call(runtime, 'keys_set', {
      clip: 'agent',
      ifClipRevision: revision,
      keys: [{ control: 'cog', channel: 'ty', frame: 0, value: 0 }],
    });
    expect(errorOf(stale)).toMatchObject({ code: 'stale', detail: { expected: revision, current: revision + 1 } });
  });

  it('fails a write to a curve another writer changed since the agent read the clip, and warns for other curves', async () => {
    const runtime = runtimeOf(fx);
    expect((await call(runtime, 'keys_read', { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] } })).ok).toBe(
      true,
    );
    foreignEdit(fx.app, fx.keys[1] as never, -10 * DEG);
    const same = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.lowerArm.L', channel: 'rz', frame: 15, value: -40 }],
    });
    expect(errorOf(same).code).toBe('stale');
    expect(errorOf(same).message).toContain('fk.lowerArm.L rz');
    const other = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.upperArm.L', channel: 'rz', frame: 15, value: 20 }],
    });
    expect(other.ok && other.warnings?.[0]).toMatch(/other curves of this clip changed.*fk\.lowerArm\.L rz/);
    // the result marked the clip seen: the next write is clean
    const next = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.lowerArm.L', channel: 'rz', frame: 15, value: -40 }],
    });
    expect(next.ok && next.warnings).toBeFalsy();
  });

  it('keeps the check after a scene_summary: read A, the user edits A, summary, write A → stale (§4.4)', async () => {
    const runtime = runtimeOf(fx);
    expect((await call(runtime, 'keys_read', { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] } })).ok).toBe(
      true,
    );
    foreignEdit(fx.app, fx.keys[1] as never, -10 * DEG);
    // the summary lists the clip's new revision but carries no `clip`: it marks nothing seen
    const summary = dataOf<{ characters: { clips: { name: string; revision: number }[] }[] }>(
      await call(runtime, 'scene_summary', {}),
    );
    expect(summary.characters[0]?.clips.find((c) => c.name === 'agent')?.revision).toBeGreaterThan(0);
    const write = await call(runtime, 'keys_set', {
      clip: 'agent',
      keys: [{ control: 'fk.lowerArm.L', channel: 'rz', frame: 15, value: -40 }],
    });
    expect(errorOf(write)).toMatchObject({ code: 'stale' });
    expect(errorOf(write).message).toContain('fk.lowerArm.L rz');
    // the user's edit is intact
    expect(keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz')[1]).toEqual([
      15,
      -10 * DEG,
    ]);
  });

  it('never counts the actor’s own writes', async () => {
    const runtime = runtimeOf(fx);
    await call(runtime, 'keys_read', { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] } });
    for (const value of [10, 20, 30]) {
      const write = await call(runtime, 'keys_set', {
        clip: 'agent',
        keys: [{ control: 'fk.lowerArm.L', channel: 'rz', frame: 15, value }],
      });
      expect(write.ok && write.warnings).toBeFalsy();
    }
  });
});

describe('keys_delete, keys_adjust, keys_retime (§6.4 tools 15–17)', () => {
  it('deletes keys at frames; more than 500 keys need confirm: true headless and the user’s Allow live', async () => {
    const runtime = runtimeOf(fx);
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    expect(
      dataOf(
        await call(runtime, 'keys_delete', { clip: 'agent', targets: { controls: ['fk.lowerArm.L'] }, frames: [15] }),
      ),
    ).toEqual({ deleted: 1 });
    expect(keysOf(fx.app, fx.agentClip, forearm, 'rz').map(([t]) => t)).toEqual([0, 30]);
    const many = Array.from({ length: 501 }, (_, i) => ({ control: 'cog', channel: 'ty', frame: i * 0.05, value: 0 }));
    expect((await call(runtime, 'keys_set', { clip: 'agent', keys: many })).ok).toBe(true);
    const big = { clip: 'agent', targets: { controls: ['cog'], channels: ['ty'] }, rangeFrames: [0, 30] };
    expect(errorOf(await call(runtime, 'keys_delete', big))).toMatchObject({ code: 'confirm_required' });
    const prompts: ConfirmPrompt[] = [];
    const denied = await call(runtimeOf(fx, liveHost({ answer: 'deny', prompts })), 'keys_delete', big);
    expect(errorOf(denied).code).toBe('declined');
    expect(prompts[0]?.title).toBe('AI wants to delete 501 keys');
    expect(dataOf(await call(runtime, 'keys_delete', { ...big, confirm: true }))).toEqual({ deleted: 501 });
  });

  it('makes a sine curve 25 % bigger: peak-to-peak × 1.25, the key frames unchanged (AE-18)', async () => {
    const runtime = runtimeOf(fx);
    const keys = Array.from({ length: 31 }, (_, f) => ({
      control: 'fk.hand.L',
      channel: 'rx',
      frame: f,
      value: 20 * Math.sin((2 * Math.PI * f) / 30),
    }));
    expect((await call(runtime, 'keys_set', { clip: 'agent', keys })).ok).toBe(true);
    const hand = controlOf(fx.app, fx.character, 'fk.hand.L');
    const before = keysOf(fx.app, fx.agentClip, hand, 'rx');
    const result = await call(runtime, 'keys_adjust', {
      clip: 'agent',
      targets: { controls: ['fk.hand.L'], channels: ['rx'] },
      scalePercent: 125,
    });
    const data = dataOf<{
      keys: number;
      amplitudeBefore: { peakToPeak: number }[];
      amplitudeAfter: { peakToPeak: number }[];
    }>(result);
    expect(data.keys).toBe(31);
    expect(data.amplitudeAfter[0]?.peakToPeak).toBeCloseTo((data.amplitudeBefore[0]?.peakToPeak ?? 0) * 1.25, 1);
    const after = keysOf(fx.app, fx.agentClip, hand, 'rx');
    expect(after.map(([t]) => t)).toEqual(before.map(([t]) => t));
    const span = (list: [number, number][]) =>
      Math.max(...list.map(([, v]) => v)) - Math.min(...list.map(([, v]) => v));
    expect(span(after) / span(before)).toBeCloseTo(1.25, 9);
    expect(fx.app.history.peekUndo()?.label).toBe('AI: Adjust 1 curve +25 %');
  });

  it('offsets keys in time', async () => {
    const result = await call(runtimeOf(fx), 'keys_retime', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'] },
      mode: 'offset',
      offsetFrames: 2,
    });
    expect(dataOf<{ moved: number }>(result).moved).toBe(3);
    expect(
      keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz').map(([t]) => t),
    ).toEqual([2, 17, 32]);
    expect(fx.app.history.peekUndo()?.label).toBe('AI: Retime fk.lowerArm.L +2 frames');
    const wrap = await call(runtimeOf(fx), 'keys_retime', {
      clip: 'agent',
      targets: { controls: ['cog'] },
      mode: 'offset',
      offsetFrames: 2,
      wrap: true,
    });
    expect(errorOf(wrap)).toMatchObject({ code: 'invalid_args', detail: { path: 'wrap' } });
  });
});

describe('pose_set (§6.3 tool 9)', () => {
  it('always keys: a pose at f0 and another at f10 on a fresh clip keep both, all rotation axes keyed', async () => {
    const runtime = runtimeOf(fx);
    expect((await call(runtime, 'clip_create', { name: 'block', durationFrames: 20 })).ok).toBe(true);
    const block = clipId('block');
    for (const [frame, z] of [
      [0, 30],
      [10, -20],
    ] as const) {
      const result = await call(runtime, 'pose_set', {
        clip: 'block',
        frame,
        set: [{ control: 'fk.upperArm.L', rotateDeg: { z } }],
      });
      expect(dataOf(result)).toMatchObject({ frame, changedCount: 1, keyed: 1, synced: 2 });
    }
    const arm = controlOf(fx.app, fx.character, 'fk.upperArm.L');
    expect(keysOf(fx.app, block, arm, 'rz')).toEqual([
      [0, 30 * DEG],
      [10, -20 * DEG],
    ]);
    expect(keysOf(fx.app, block, arm, 'rx').map(([t]) => t)).toEqual([0, 10]);
    expect(fx.app.history.peekUndo()?.label).toBe('AI: Set pose (1 control) @ f10');
  });

  it('writes a pose_read item back unchanged as a no-op: keyed channels untouched, the motion the same', async () => {
    const runtime = runtimeOf(fx);
    const sample = async () =>
      dataOf<{ frames: unknown[] }>(
        await call(runtime, 'pose_read', {
          clip: 'agent',
          rangeFrames: [0, 30],
          stepFrames: 1,
          targets: { bodyParts: ['arm.L'] },
        }),
      ).frames;
    const before = await sample();
    const read = dataOf<{ frames: { controls: Record<string, unknown>[] }[] }>(
      await call(runtime, 'pose_read', { clip: 'agent', frames: [15], targets: { controls: ['fk.lowerArm.L'] } }),
    );
    const forearm = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    const keyed = keysOf(fx.app, fx.agentClip, forearm, 'rz');
    const back = await call(runtime, 'pose_set', { clip: 'agent', frame: 15, set: read.frames[0]?.controls });
    expect(back.ok).toBe(true);
    // the keyed channel kept its keys exactly; the unanimated ones got keys at their own (rest) value
    expect(keysOf(fx.app, fx.agentClip, forearm, 'rz')).toEqual(keyed);
    expect(
      dataOf<{ changed: { channel: string; before: number; after: number }[] }>(back).changed.every(
        (row) => row.before === row.after,
      ),
    ).toBe(true);
    expect(await sample()).toEqual(before);
    // the same call again changes nothing at all: no step
    const top = fx.app.history.peekUndo()?.id;
    const again = await call(runtime, 'pose_set', { clip: 'agent', frame: 15, set: read.frames[0]?.controls });
    expect(dataOf(again)).toMatchObject({ changedCount: 0, keyed: 0 });
    expect(fx.app.history.peekUndo()?.id).toBe(top);
  });

  it('adds relative values, checks the rotate order echo and unknown attributes', async () => {
    const runtime = runtimeOf(fx);
    const relative = await call(runtime, 'pose_set', {
      clip: 'agent',
      frame: 15,
      mode: 'relative',
      set: [{ control: 'fk.lowerArm.L', rotateDeg: { z: 10 } }],
    });
    expect(dataOf<{ changed: unknown[] }>(relative).changed).toEqual([
      { control: 'fk.lowerArm.L', channel: 'rz', before: -30, after: -20, unit: 'deg' },
    ]);
    const order = await call(runtime, 'pose_set', {
      clip: 'agent',
      frame: 0,
      set: [{ control: 'fk.lowerArm.L', rotateOrder: 'xyz', rotateDeg: { z: 1 } }],
    });
    expect(errorOf(order)).toMatchObject({ code: 'invalid_args', detail: { path: 'set[0].rotateOrder' } });
    const attr = await call(runtime, 'pose_set', {
      clip: 'agent',
      frame: 0,
      set: [{ control: 'ik.leg.L', attrs: { wobble: 1 } }],
    });
    expect(errorOf(attr).code).toBe('not_keyable');
    expect(errorOf(attr).candidates).toContain('ikFk');
  });

  it('proposes an unkeyed pose only live, with View, at the user’s frame (§6.3)', async () => {
    const headless = await call(runtimeOf(fx), 'pose_set', {
      clip: 'agent',
      frame: 0,
      key: 'pose_only',
      set: [{ control: 'cog', translateM: { y: 0.1 } }],
    });
    expect(errorOf(headless).code).toBe('unsupported');
    seedUserSession(fx);
    const noView = await call(runtimeOf(fx, liveHost()), 'pose_set', {
      clip: 'user',
      frame: 12,
      key: 'pose_only',
      set: [{ control: 'cog', translateM: { y: 0.1 } }],
    });
    expect(errorOf(noView)).toMatchObject({ code: 'not_granted', detail: { grant: 'view' } });
    const wrongFrame = await call(runtimeOf(fx, liveHost({ grants: { view: true } })), 'pose_set', {
      clip: 'user',
      frame: 3,
      key: 'pose_only',
      set: [{ control: 'cog', translateM: { y: 0.1 } }],
    });
    expect(errorOf(wrongFrame)).toMatchObject({ code: 'invalid_args', detail: { path: 'frame' } });
  });
});

describe('pose_aim and pose_ik_target (§6.3 tools 10–11)', () => {
  it('aims an FK arm in character space and reports the achieved direction', async () => {
    const result = await call(runtimeOf(fx), 'pose_aim', {
      clip: 'agent',
      frame: 0,
      aims: [{ bone: 'leftUpperArm', direction: [0.8, 0.6, 0] }],
    });
    const data = dataOf<{
      aims: { bone: string; control: string; achievedDirection: number[]; errorDeg: number }[];
      keyed: number;
    }>(result);
    expect(data.aims[0]).toMatchObject({ bone: 'leftUpperArm', control: 'fk.upperArm.L' });
    expect(data.aims[0]?.errorDeg).toBeLessThan(1);
    expect(data.keyed).toBeGreaterThan(0);
    expect(fx.app.history.peekUndo()?.label).toBe('AI: Aim pose (1 bone) @ f0');
  });

  it('answers limb_mode for an IK-driven bone and for an FK limb without ensureIk', async () => {
    const runtime = runtimeOf(fx);
    const leg = await call(runtime, 'pose_aim', {
      clip: 'agent',
      frame: 0,
      aims: [{ bone: 'leftLowerLeg', direction: 'down' }],
    });
    expect(errorOf(leg)).toMatchObject({ code: 'limb_mode' });
    expect(errorOf(leg).hint).toContain('pose_ik_target');
    const arm = await call(runtime, 'pose_ik_target', { clip: 'agent', frame: 0, limb: 'arm.L', offsetM: [0, 0.1, 0] });
    expect(errorOf(arm).code).toBe('limb_mode');
    expect(errorOf(arm).hint).toContain("ensureIk: 'auto'");
  });

  it('places an IK foot by an offset in character space', async () => {
    const runtime = runtimeOf(fx);
    const where = async () =>
      dataOf<{ frames: { bones: Record<string, { positionM: number[] }> }[] }>(
        await call(runtime, 'pose_read', { clip: 'agent', frames: [10], space: 'world', bones: ['leftFoot'] }),
      ).frames[0]?.bones['leftFoot']?.positionM ?? [];
    const before = await where();
    const result = await call(runtime, 'pose_ik_target', {
      clip: 'agent',
      frame: 10,
      limb: 'leg.L',
      offsetM: [0, 0.1, 0.05],
    });
    expect(dataOf(result)).toMatchObject({ limb: 'leg.L', reached: true, switchedToIk: null });
    const after = await where();
    expect((after[1] ?? 0) - (before[1] ?? 0)).toBeCloseTo(0.1, 3);
    expect((after[2] ?? 0) - (before[2] ?? 0)).toBeCloseTo(0.05, 3);
  });
});

describe('pose_transfer and pose_reset (§6.3 tools 12–13)', () => {
  it('copies a pose to other frames without the clipboard', async () => {
    const before = fx.app.session.getState().clipboard;
    const result = await call(runtimeOf(fx), 'pose_transfer', {
      clip: 'agent',
      fromFrame: 0,
      toFrames: [20],
      controls: ['fk.lowerArm.L'],
    });
    expect(dataOf<{ frames: number[] }>(result).frames).toEqual([20]);
    const forearm = keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz');
    expect(forearm.find(([t]) => t === 20)?.[1]).toBeCloseTo(30 * DEG, 9);
    expect(fx.app.session.getState().clipboard).toBe(before);
  });

  it('keys the rest pose at frames', async () => {
    const result = await call(runtimeOf(fx), 'pose_reset', {
      clip: 'agent',
      frames: [15],
      controls: ['fk.lowerArm.L'],
    });
    expect(dataOf<{ keyed: number }>(result).keyed).toBe(3);
    const forearm = keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz');
    expect(forearm.find(([t]) => t === 15)?.[1]).toBe(0);
  });
});

describe('clips (§6.6 tools 22–25)', () => {
  it('creates a clip headless (activated), with NTSC fps, refusing taken names and huge durations', async () => {
    const runtime = runtimeOf(fx);
    const result = await call(runtime, 'clip_create', { name: 'wave', fps: 29.97, durationSeconds: 2 });
    expect(dataOf(result)).toMatchObject({ clip: { name: 'wave', fps: 29.97, rangeFrames: [0, 60] }, activated: true });
    expect(errorOf(await call(runtime, 'clip_create', { name: 'wave' }))).toMatchObject({
      code: 'invalid_args',
      detail: { path: 'name' },
    });
    expect(errorOf(await call(runtime, 'clip_create', { name: 'long', durationSeconds: 5_000 })).code).toBe('limit');
  });

  it('renames, sets settings, and confirms an fps change (headless: confirm: true)', async () => {
    const runtime = runtimeOf(fx);
    expect(dataOf(await call(runtime, 'clip_update', { clip: 'agent', name: 'wave2' }))).toMatchObject({
      clip: { name: 'wave2' },
    });
    expect(dataOf(await call(runtime, 'clip_update', { clip: 'wave2', loop: true }))).toMatchObject({
      clip: { loop: true },
    });
    expect(errorOf(await call(runtime, 'clip_update', { clip: 'wave2', fps: 24 })).code).toBe('confirm_required');
    expect(dataOf(await call(runtime, 'clip_update', { clip: 'wave2', fps: 24, confirm: true }))).toMatchObject({
      clip: { fps: 24 },
    });
    expect(errorOf(await call(runtime, 'clip_update', { clip: 'wave2', name: 'x', loop: false })).code).toBe(
      'invalid_args',
    );
  });

  it('makes a loop and reports the seam before and after; a dry run records no step', async () => {
    const runtime = runtimeOf(fx);
    const top = fx.app.history.peekUndo()?.id;
    const dry = await call(runtime, 'clip_make_loop', { clip: 'agent', dryRun: true });
    expect(dataOf(dry)).toMatchObject({ before: { verdict: 'not_a_loop' }, dryRun: true });
    expect(fx.app.history.peekUndo()?.id).toBe(top);
    const done = await call(runtime, 'clip_make_loop', { clip: 'agent', method: 'cycle_only' });
    expect(dataOf(done)).toMatchObject({ dryRun: false });
    expect(fx.app.store.get('clips', fx.agentClip)?.loop).toBe(true);
  });

  it('deletes a clip only when confirmed', async () => {
    const runtime = runtimeOf(fx);
    expect(errorOf(await call(runtime, 'clip_delete', { clip: 'clip1' })).code).toBe('confirm_required');
    expect(dataOf(await call(runtime, 'clip_delete', { clip: 'clip1', confirm: true }))).toEqual({
      deleted: 'clip1',
      userNowSees: null,
    });
    expect(fx.app.store.query.clipsOfCharacter(fx.character).map((clip) => clip.name)).toEqual(['agent', 'user']);
  });
});

describe.skipIf(!READY.p1)('tools over P1’s scope migrations (READY.p1)', () => {
  it('tweens keys at frames on the scope, never the user’s selection', async () => {
    seedUserSession(fx);
    const before = sessionRecord(fx.app);
    const result = await call(runtimeOf(fx, liveHost()), 'keys_tween', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'] },
      frames: [5],
      mode: 'tween',
      amountPercent: 50,
    });
    expect(dataOf<{ keyed: number }>(result).keyed).toBeGreaterThan(0);
    expect(sessionRecord(fx.app)).toEqual(before);
  });

  it('sets tangents, filters flips and simplifies on the scope', async () => {
    const runtime = runtimeOf(fx);
    expect(
      dataOf(
        await call(runtime, 'curves_set_interpolation', {
          clip: 'agent',
          targets: { controls: ['fk.lowerArm.L'] },
          tangent: 'flat',
        }),
      ),
    ).toMatchObject({ keys: 3, curves: 1 });
    expect((await call(runtime, 'curves_euler_filter', { clip: 'agent' })).ok).toBe(true);
    expect((await call(runtime, 'curves_simplify', { clip: 'agent' })).ok).toBe(true);
  });
});

describe('the user’s selection, clip and playhead never reach a call (guards until P1 is in)', () => {
  /** The user looks at clip `agent` at frame 12 with fk.lowerArm.L (keys at 0, 15, 30) selected. */
  function userOnAgentClip(keys: readonly ClipId[] = []): void {
    const state = fx.app.session.getState();
    fx.app.session.setState({
      activeClip: { ...state.activeClip, [fx.character]: fx.agentClip },
      time: { ...state.time, sceneFrame: 12 },
    });
    fx.app.session.setState({
      selection: {
        ...fx.app.session.getState().selection,
        controls: [controlOf(fx.app, fx.character, 'fk.lowerArm.L')],
        keys: keySelection(keys as never),
      },
    });
  }
  const forearmKeys = () => keysOf(fx.app, fx.agentClip, controlOf(fx.app, fx.character, 'fk.lowerArm.L'), 'rz');

  it('keys_tween never tweens the user’s selected control at the user’s frame', async () => {
    userOnAgentClip();
    const before = sessionRecord(fx.app);
    const result = await call(runtimeOf(fx, liveHost()), 'keys_tween', {
      clip: 'agent',
      targets: { controls: ['fk.upperArm.L'] },
      frames: [5],
      mode: 'tween',
      amountPercent: 50,
    });
    if (!READY.p1) {
      expect(errorOf(result)).toMatchObject({ code: 'unsupported', detail: { operator: 'key.tween' } });
      expect(errorOf(result).message).toContain('not available yet');
    }
    expect(forearmKeys().map(([t]) => t)).toEqual([0, 15, 30]);
    expect(sessionRecord(fx.app)).toEqual(before);
  });

  it('curves_euler_filter and curves_set_interpolation never act on the user’s clip or selected keys', async () => {
    userOnAgentClip([fx.keys[1] as never]);
    const before = sessionRecord(fx.app);
    const keysBefore = JSON.stringify(
      fx.app.store.query.keysOfCurve(fx.app.store.get('keys', fx.keys[1] as never)!.curve),
    );
    const runtime = runtimeOf(fx, liveHost());
    const filter = await call(runtime, 'curves_euler_filter', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'] },
    });
    const tangents = await call(runtime, 'curves_set_interpolation', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'] },
      frames: [0],
      tangent: 'linear',
    });
    if (!READY.p1) {
      expect(errorOf(filter)).toMatchObject({ code: 'unsupported', detail: { operator: 'graph.eulerFilter' } });
      expect(errorOf(tangents)).toMatchObject({ code: 'unsupported', detail: { operator: 'graph.tangent.set' } });
      expect(JSON.stringify(fx.app.store.query.keysOfCurve(fx.app.store.get('keys', fx.keys[1] as never)!.curve))).toBe(
        keysBefore,
      );
    }
    // the user's selected key (f15) keeps its tangents either way
    const selected = fx.app.store.get('keys', fx.keys[1] as never);
    expect(JSON.parse(keysBefore).find((k: { id: string }) => k.id === selected?.id)).toMatchObject({
      inType: selected?.inType,
      outType: selected?.outType,
    });
    expect(sessionRecord(fx.app)).toEqual(before);
  });

  it('clip_create without activate keeps the user’s clip, frame and unkeyed edits', async () => {
    seedUserSession(fx);
    const before = sessionRecord(fx.app);
    const result = await call(runtimeOf(fx, liveHost()), 'clip_create', { name: 'extra', durationFrames: 30 });
    if (READY.p1) expect(dataOf(result)).toMatchObject({ activated: false });
    else {
      expect(errorOf(result)).toMatchObject({ code: 'unsupported', retryable: false });
      expect(errorOf(result).hint).toContain('activate: true');
      expect(fx.app.store.query.clipsOfCharacter(fx.character).map((clip) => clip.name)).not.toContain('extra');
    }
    expect(fx.app.session.getState().overrides.size).toBe(1);
    expect(sessionRecord(fx.app)).toEqual(before);
  });

  it('clip_delete of the clip the user looks at is refused live before any card; headless deletes it', async () => {
    seedUserSession(fx);
    const prompts: ConfirmPrompt[] = [];
    const before = sessionRecord(fx.app);
    const live = await call(runtimeOf(fx, liveHost({ answer: 'allow', prompts })), 'clip_delete', { clip: 'user' });
    if (!READY.p1) {
      expect(errorOf(live)).toMatchObject({ code: 'unsupported' });
      expect(prompts).toEqual([]);
      expect(sessionRecord(fx.app)).toEqual(before);
    } else expect(live.ok).toBe(true);
    const headless = await call(runtimeOf(fx), 'clip_delete', { clip: READY.p1 ? 'clip1' : 'user', confirm: true });
    expect(headless.ok).toBe(true);
  });
});

describe('curves tools without P1', () => {
  it('measures a simplification in a dry run without writing', async () => {
    const runtime = runtimeOf(fx);
    const keys = Array.from({ length: 31 }, (_, f) => ({
      control: 'fk.hand.L',
      channel: 'rz',
      frame: f,
      value: 2 * f,
      tangent: 'linear',
    }));
    expect((await call(runtime, 'keys_set', { clip: 'agent', keys })).ok).toBe(true);
    const top = fx.app.history.peekUndo()?.id;
    const dry = await call(runtime, 'curves_simplify', {
      clip: 'agent',
      targets: { controls: ['fk.hand.L'] },
      dryRun: true,
    });
    expect(dataOf(dry)).toMatchObject({ before: 31, after: 2, dryRun: true });
    expect(dataOf<{ maxErrorDeg: number }>(dry).maxErrorDeg).toBeLessThan(0.1);
    expect(fx.app.history.peekUndo()?.id).toBe(top);
  });

  it('refuses tangent changes on targets without keys there', async () => {
    const result = await call(runtimeOf(fx), 'curves_set_interpolation', {
      clip: 'agent',
      targets: { controls: ['fk.lowerArm.L'] },
      frames: [7],
      tangent: 'flat',
    });
    expect(errorOf(result)).toMatchObject({ code: 'invalid_args', detail: { path: 'frames' } });
    const two = await call(runtimeOf(fx), 'curves_set_interpolation', {
      clip: 'agent',
      targets: { controls: ['cog'] },
      tangent: 'flat',
      broken: true,
    });
    expect(errorOf(two).message).toContain('one change kind per call');
  });

  it('activates a clip headless (no user to protect) and live only with View', async () => {
    expect(dataOf(await call(runtimeOf(fx, host()), 'clip_update', { clip: 'agent', activate: true }))).toMatchObject({
      activated: true,
    });
    expect(fx.app.session.getState().activeClip[fx.character]).toBe(fx.agentClip);
    const live = await call(runtimeOf(fx, liveHost()), 'clip_update', { clip: 'user', activate: true });
    expect(errorOf(live)).toMatchObject({ code: 'not_granted', detail: { grant: 'view' } });
  });
});
