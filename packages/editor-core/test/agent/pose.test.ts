// MCP-SPEC §4.10 (P1): `pose.setAt` (key, static, propose) and `pose.transfer` on the wave fixture — always keys in
// key mode (pose-to-pose blocking keeps every pose), syncs the other rotation axes, skips and reports locked,
// non-keyable and animated channels, proposes unkeyed overrides at the user's frame only; transfers keyed poses
// (mirrored, from another clip) without the session clipboard.
import type { ClipId, ControlId, CurveId } from '@ekza-animator/doc';
import { describe, expect, it } from 'vitest';
import {
  agentOk,
  agentRefusal,
  asAgent,
  changedFields,
  DEG,
  docJson,
  expectAgentUndoRedoExact,
  keysOf,
  opsApp,
  runOk,
  seedUser,
  sessionRecord,
  WAVE,
  waveCurve,
} from './support';

const UPPER = WAVE.upperArmL;
const ARM = WAVE.lowerArmL;
const R = (key: string) => `${WAVE.rig}:${key}` as ControlId;
const round = (v: number) => Math.round(v * 1e9) / 1e9;

async function freshClip(app: ReturnType<typeof opsApp>): Promise<ClipId> {
  const { clip } = (await agentOk(app, 'clip.new', {
    character: WAVE.character,
    name: 'block',
    range: { start: 0, end: 30 },
    activate: false,
  })) as { readonly clip: ClipId };
  return clip;
}

describe('pose.setAt {mode: key}', () => {
  it('keys a pose at f0 and another at f10 on a fresh clip: both poses stay', async () => {
    const app = opsApp();
    seedUser(app);
    const clip = await freshClip(app);
    const set = (frame: number, degrees: number) => ({
      clip,
      frame,
      edits: [{ control: UPPER, channel: 'rz', value: degrees * DEG }],
      mode: 'key',
      label: `Set pose (1 control) @ f${frame}`,
    });
    const first = await expectAgentUndoRedoExact(app, 'pose.setAt', set(0, 30));
    expect(first.value).toEqual({ keyed: 1, synced: 2, statics: 0, skipped: [], hiddenByOverrides: [] });
    await expectAgentUndoRedoExact(app, 'pose.setAt', set(10, 60));
    expect(keysOf(app, waveCurve(app, UPPER, 'rz', clip))).toEqual([
      [0, round(30 * DEG)],
      [10, round(60 * DEG)],
    ]);
    expect(app.history.peekUndo()?.label).toBe('AI: Set pose (1 control) @ f10');
  });

  it('a one-axis edit keys all three rotation axes at their keyed values', async () => {
    const app = opsApp();
    const clip = await freshClip(app);
    await agentOk(app, 'pose.setAt', {
      clip,
      frame: 0,
      edits: [{ control: UPPER, channel: 'rx', value: 0.4 }],
      mode: 'key',
    });
    await agentOk(app, 'pose.setAt', {
      clip,
      frame: 10,
      edits: [{ control: UPPER, channel: 'rz', value: 0.5 }],
      mode: 'key',
    });
    // rx keeps 0.4 at 10 (its keyed value there), ry its default 0, rz the edit.
    expect(keysOf(app, waveCurve(app, UPPER, 'rx', clip))).toEqual([
      [0, 0.4],
      [10, 0.4],
    ]);
    expect(keysOf(app, waveCurve(app, UPPER, 'ry', clip))).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(keysOf(app, waveCurve(app, UPPER, 'rz', clip))).toEqual([
      [0, 0],
      [10, 0.5],
    ]);
    const unsynced = opsApp();
    const other = await freshClip(unsynced);
    const value = await agentOk(unsynced, 'pose.setAt', {
      clip: other,
      frame: 3,
      edits: [{ control: UPPER, channel: 'rz', value: 0.5 }],
      mode: 'key',
      syncRotation: false,
    });
    expect(value).toMatchObject({ keyed: 1, synced: 0 });
    expect(waveCurve(unsynced, UPPER, 'rx', other)).toBeUndefined();
  });

  it('skips locked and non-keyable channels in every mode and reports them', async () => {
    const app = opsApp();
    await app.runUntyped('channel.toggleLock', { refs: [{ control: UPPER, channel: 'ry' }], locked: true });
    const edits = [
      { control: UPPER, channel: 'ry', value: 0.1 },
      { control: UPPER, channel: 'tx', value: 0.1 },
      { control: UPPER, channel: 'rz', value: 0.1 },
    ];
    const value = await agentOk(app, 'pose.setAt', { clip: WAVE.clip, frame: 5, edits, mode: 'key' });
    expect(value).toMatchObject({
      keyed: 1,
      synced: 1,
      skipped: [
        { control: UPPER, channel: 'ry', reason: 'locked' },
        { control: UPPER, channel: 'tx', reason: 'non-keyable' },
      ],
    });
    // The locked ry got no sync key either.
    expect(waveCurve(app, UPPER, 'ry')).toBeUndefined();
  });

  it('honours an explicit tangent and refuses out-of-range frames without extendRange', async () => {
    const app = opsApp();
    const edit = { control: ARM, channel: 'rz', value: 0 };
    await agentOk(app, 'pose.setAt', { clip: WAVE.clip, frame: 15, edits: [edit], mode: 'key', tangent: 'linear' });
    expect(app.store.query.keysOfCurve(waveCurve(app, ARM, 'rz') as CurveId)[1]).toMatchObject({
      inType: 'linear',
      outType: 'linear',
    });
    expect(await agentRefusal(app, 'pose.setAt', { clip: WAVE.clip, frame: 31, edits: [edit], mode: 'key' })).toMatch(
      /outside the clip range/,
    );
    expect(await agentRefusal(app, 'pose.setAt', { clip: WAVE.clip, frame: 1, edits: [], mode: 'key' })).toMatch(
      /empty/,
    );
  });
});

describe('pose.setAt {mode: static}', () => {
  it('sets the base value of channels without keys and skips animated ones', async () => {
    const app = opsApp();
    seedUser(app);
    const { value } = await expectAgentUndoRedoExact(app, 'pose.setAt', {
      clip: WAVE.clip,
      frame: 0,
      edits: [
        { control: UPPER, channel: 'rz', value: 0.3 },
        { control: ARM, channel: 'rz', value: 0.3 },
      ],
      mode: 'static',
    });
    expect(value).toEqual({
      keyed: 0,
      synced: 0,
      statics: 1,
      skipped: [{ control: ARM, channel: 'rz', reason: 'animated' }],
      hiddenByOverrides: [],
    });
    expect(app.store.get('curves', waveCurve(app, UPPER, 'rz') as CurveId)?.staticValue).toBe(0.3);
  });
});

describe('pose.setAt {mode: propose} (View access)', () => {
  it("writes unkeyed overrides at the user's current frame of the active clip: one override-only step", async () => {
    const app = opsApp();
    seedUser(app);
    const before = docJson(app);
    const args = {
      clip: WAVE.clip,
      frame: 12,
      edits: [
        { control: UPPER, channel: 'rz', value: 0.7 },
        { control: ARM, channel: 'rz', value: 0.2 },
      ],
      mode: 'propose',
    };
    const value = await agentOk(app, 'pose.setAt', args, asAgent({ access: 'view' }));
    expect(value).toMatchObject({ keyed: 0, statics: 0 });
    expect(docJson(app)).toEqual(before);
    expect(app.session.getState().overrides.get(UPPER)).toEqual({ rz: 0.7 });
    expect(app.session.getState().overrides.get(ARM)).toEqual({ rz: 0.2 });
    expect(app.history.peekUndo()).toMatchObject({ label: 'AI: Propose Pose', docTxId: null });
    await runOk(app, 'edit.undo');
    expect(app.session.getState().overrides.get(UPPER)).toBeUndefined();
  });

  it('refuses another frame or another clip', async () => {
    const app = opsApp();
    seedUser(app);
    const edits = [{ control: UPPER, channel: 'rz', value: 0.7 }];
    const view = asAgent({ access: 'view' });
    expect(await agentRefusal(app, 'pose.setAt', { clip: WAVE.clip, frame: 5, edits, mode: 'propose' }, view)).toMatch(
      /current frame \(12\)/,
    );
    const clip = await freshClip(app);
    expect(await agentRefusal(app, 'pose.setAt', { clip, frame: 12, edits, mode: 'propose' }, view)).toMatch(
      /active clip/,
    );
  });
});

describe('pose.transfer', () => {
  it('keys the keyed pose of one frame at other frames on the controls, not the session clipboard', async () => {
    const app = opsApp();
    seedUser(app);
    const clipboard = app.session.getState().clipboard;
    const { value } = await expectAgentUndoRedoExact(app, 'pose.transfer', {
      clip: WAVE.clip,
      fromFrame: 15,
      toFrames: [5, 25],
      controls: [ARM],
      mirror: 'none',
    });
    expect((value as { keyed: number }).keyed).toBeGreaterThanOrEqual(6);
    expect(keysOf(app, waveCurve(app, ARM, 'rz'))).toEqual([
      [0, round(30 * DEG)],
      [5, round(-30 * DEG)],
      [15, round(-30 * DEG)],
      [25, round(-30 * DEG)],
      [30, round(30 * DEG)],
    ]);
    expect(app.session.getState().clipboard).toBe(clipboard);
  });

  it('mirrors onto the other side and reads another clip of the character', async () => {
    const app = opsApp();
    const clip = await freshClip(app);
    await agentOk(app, 'pose.transfer', {
      clip,
      fromClip: WAVE.clip,
      fromFrame: 15,
      toFrames: [0],
      controls: [ARM],
      mirror: 'leftToRight',
    });
    const right = keysOf(app, waveCurve(app, R('fk.lowerArm.R'), 'rz', clip));
    expect(right).toHaveLength(1);
    expect(Math.abs(right[0]?.[1] ?? 0)).toBeCloseTo(30 * DEG, 9);
    expect(waveCurve(app, ARM, 'rz', clip)).toBeUndefined();
  });

  it('polls clips of the same character and frames in range', async () => {
    const app = opsApp();
    const base = { clip: WAVE.clip, fromFrame: 0, controls: [ARM], mirror: 'none' };
    expect(await agentRefusal(app, 'pose.transfer', { ...base, toFrames: [] })).toMatch(/toFrames is empty/);
    expect(await agentRefusal(app, 'pose.transfer', { ...base, toFrames: [45] })).toMatch(/outside the clip range/);
    expect(await agentRefusal(app, 'pose.transfer', { ...base, toFrames: [1], fromClip: 'clp_nope' })).toMatch(
      /source clip does not exist/,
    );
  });

  it('keys thousands of frames in one pass per curve (≈ 50 s for 6,000 keys with one curve scan per key)', async () => {
    const app = opsApp();
    const toFrames = Array.from({ length: 5000 }, (_, i) => 1 + (i * 28) / 5000);
    const started = performance.now();
    const value = await agentOk(app, 'pose.transfer', {
      clip: WAVE.clip,
      fromFrame: 0,
      toFrames,
      controls: [UPPER],
      mirror: 'none',
    });
    expect(performance.now() - started).toBeLessThan(10_000);
    const channels = (value as { readonly keyed: number }).keyed / toFrames.length;
    expect(Number.isInteger(channels) && channels > 0).toBe(true);
    expect(app.store.query.keysOfCurve(waveCurve(app, UPPER, 'rx') as CurveId)).toHaveLength(5000);
  });
});

describe('the user session stays', () => {
  it('every pose run in key mode leaves the protected session fields as they were', async () => {
    const app = opsApp();
    seedUser(app);
    const before = sessionRecord(app);
    await agentOk(app, 'pose.setAt', {
      clip: WAVE.clip,
      frame: 12,
      edits: [{ control: WAVE.handL, channel: 'rx', value: 0.3 }],
      mode: 'key',
    });
    expect(changedFields(before, sessionRecord(app))).toEqual([]);
  });
});
