// ops.* (WP-7b), US-14 / §6.3: every undoable operator of the catalog reverts exactly on one undo and redoes exactly on
// one redo against the real memory store (document snapshots deep-equal), on a Polybot scene with a keyed wave clip;
// and a 30-step mixed session undoes back to the post-import state and redoes forward again.
import type { CharacterId, ClipId, ControlId, CurveId, KeyId } from '@ekza-studio/doc';
import { readFixture } from '@ekza-studio/doc/testing';
import type { EditorApp } from '@ekza-studio/editor-core';
import type { ExportArtifact } from '@ekza-studio/io';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BLOCKED,
  docJson,
  expectUndoRedoExact,
  importFixture,
  realApp,
  runOk,
  SIBLINGS_READY,
  setSceneFrame,
} from './ops.support';

const DEG = Math.PI / 180;

interface Scene {
  readonly app: EditorApp;
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly arm: ControlId;
  readonly curve: CurveId;
  readonly keys: readonly KeyId[];
  control(key: string): ControlId;
}

/** FK-only Polybot with a 'wave' clip: fk.lowerArm.L rz keyed 30/−30/30° at 0/15/30; the arm selected; frame 7. */
async function scene(): Promise<Scene> {
  const { app } = realApp();
  // The M1 operators on an M1 rig (FK limbs: Plant Feet re-solves the legs). IK rigs: ops.ik.test.ts (A2).
  app.prefs.setState({ autoRigIk: { legs: false, arms: false } });
  const bot = await importFixture(app, 'polybot.vrm');
  const rig = app.store.query.rigOfCharacter(bot.character);
  const control = (key: string): ControlId => {
    const found = rig === undefined ? undefined : app.store.query.controlByKey(rig.id, key);
    if (found === undefined) throw new Error(`no control ${key}`);
    return found.id;
  };
  const clip = ((await runOk(app, 'clip.new', { name: 'wave', range: { start: 0, end: 30 } })) as { clip: ClipId })
    .clip;
  const arm = control('fk.lowerArm.L');
  for (const [frame, degrees] of [
    [0, 30],
    [15, -30],
    [30, 30],
  ] as const) {
    setSceneFrame(app, frame);
    await runOk(app, 'channel.setValues', {
      edits: [{ control: arm, channel: 'rz', value: degrees * DEG }],
      key: 'force',
    });
  }
  const base = app.store.query.baseLayer(clip);
  const curve = app.store.query.curveFor(clip, base?.id as never, arm, 'rz');
  if (curve === undefined) throw new Error('no curve');
  await runOk(app, 'select.controls', { ids: [arm], mode: 'replace' });
  setSceneFrame(app, 7);
  return {
    app,
    character: bot.character,
    clip,
    arm,
    curve: curve.id,
    keys: app.store.query.keysOfCurve(curve.id).map((k) => k.id),
    control,
  };
}

async function selectKeys(s: Scene, ids: readonly KeyId[]): Promise<void> {
  await runOk(s.app, 'select.keys', { items: ids.map((key) => ({ key })), mode: 'replace' });
}

type Case = readonly [name: string, op: string, args: (s: Scene) => unknown];

const CASES: readonly Case[] = [
  ['key.set', 'key.set', () => ({ channels: 'all' })],
  [
    'key.deleteAtFrame',
    'key.deleteAtFrame',
    (s) => {
      setSceneFrame(s.app, 15);
    },
  ],
  [
    'channel.setValues (static)',
    'channel.setValues',
    (s) => ({ edits: [{ control: s.control('fk.hips'), channel: 'ry', value: 0.3 }] }),
  ],
  [
    'channel.setValues (key)',
    'channel.setValues',
    (s) => ({ edits: [{ control: s.arm, channel: 'rx', value: 0.2 }], key: 'force' }),
  ],
  ['channel.toggleLock', 'channel.toggleLock', (s) => ({ refs: [{ control: s.arm, channel: 'rz' }] })],
  [
    'pose.resetToRest',
    'pose.resetToRest',
    (s) => {
      s.app.prefs.setState({ autoKey: true });
      return { controls: [s.arm] };
    },
  ],
  [
    'pose.paste',
    'pose.paste',
    async (s) => {
      setSceneFrame(s.app, 15);
      await runOk(s.app, 'pose.copy');
      setSceneFrame(s.app, 7);
      s.app.prefs.setState({ autoKey: true });
    },
  ],
  ['pose.mirror', 'pose.mirror', () => ({ mode: 'flip' })],
  [
    'pose.plantFeet',
    'pose.plantFeet',
    async (s) => {
      setSceneFrame(s.app, 0);
      await runOk(s.app, 'pose.pinFeet');
      setSceneFrame(s.app, 10);
      await runOk(s.app, 'channel.setValues', {
        edits: [{ control: s.control('cog'), channel: 'ty', value: -0.05 }],
        key: 'force',
      });
    },
  ],
  [
    'graph.tangent.set',
    'graph.tangent.set',
    async (s) => {
      await selectKeys(s, s.keys);
      return { type: 'linear' };
    },
  ],
  [
    'graph.tangent.break',
    'graph.tangent.break',
    async (s) => {
      await selectKeys(s, [s.keys[1] as KeyId]);
    },
  ],
  [
    'graph.tangent.unify',
    'graph.tangent.unify',
    async (s) => {
      await selectKeys(s, [s.keys[1] as KeyId]);
      await runOk(s.app, 'graph.tangent.set', { type: 'fixed' });
      await runOk(s.app, 'graph.tangent.break');
      await runOk(s.app, 'graph.keys.setFields', { outAngleDeg: 10 });
    },
  ],
  ['graph.curve.setWeighted', 'graph.curve.setWeighted', () => ({ weighted: true })],
  ['graph.tangent.lockWeight', 'graph.tangent.lockWeight', () => ({ locked: false })],
  ['graph.infinity.set', 'graph.infinity.set', () => ({ pre: 'linear', post: 'cycle' })],
  [
    'graph.keys.setFields',
    'graph.keys.setFields',
    async (s) => {
      await selectKeys(s, [s.keys[1] as KeyId]);
      return { value: -45, inAngleDeg: 5 };
    },
  ],
  [
    'graph.keys.move',
    'graph.keys.move',
    async (s) => {
      await selectKeys(s, [s.keys[1] as KeyId]);
      return { dFrames: 15, dValue: 3 };
    },
  ],
  [
    'graph.keys.scale',
    'graph.keys.scale',
    async (s) => {
      await selectKeys(s, s.keys);
      return { pivot: 30, factor: 0.5 };
    },
  ],
  [
    'graph.keys.delete',
    'graph.keys.delete',
    async (s) => {
      await selectKeys(s, s.keys);
    },
  ],
  ['graph.key.insert', 'graph.key.insert', (s) => ({ curve: s.curve, frame: 22 })],
  ['graph.keys.keyCurves', 'graph.keys.keyCurves', () => undefined],
  [
    'graph.keys.paste',
    'graph.keys.paste',
    async (s) => {
      await selectKeys(s, [s.keys[0] as KeyId, s.keys[1] as KeyId]);
      await runOk(s.app, 'graph.keys.copy');
      setSceneFrame(s.app, 10);
      return { mode: 'replace' };
    },
  ],
  [
    'graph.eulerFilter',
    'graph.eulerFilter',
    async (s) => {
      await selectKeys(s, [s.keys[1] as KeyId]);
      await runOk(s.app, 'graph.keys.move', { dFrames: 0, dValue: 360 });
      await runOk(s.app, 'select.keys', { items: [], mode: 'replace' });
    },
  ],
  [
    'graph.curves.simplify',
    'graph.curves.simplify',
    async (s) => {
      for (let frame = 1; frame < 30; frame += 2) {
        await runOk(s.app, 'graph.key.insert', { curve: s.curve, frame });
      }
      await runOk(s.app, 'select.keys', { items: [], mode: 'replace' });
    },
  ],
  ['clip.new', 'clip.new', () => ({ name: 'idle' })],
  ['clip.rename', 'clip.rename', (s) => ({ clip: s.clip, name: 'wave_01' })],
  ['clip.duplicate', 'clip.duplicate', (s) => ({ clip: s.clip })],
  ['clip.delete', 'clip.delete', (s) => ({ clip: s.clip })],
  [
    'clip.setSettings',
    'clip.setSettings',
    (s) => ({ clip: s.clip, fps: { num: 24, den: 1 }, loop: true, slot: 'wave' }),
  ],
  ['rig.setControlSize', 'rig.setControlSize', (s) => ({ control: s.arm, size: 0.2 })],
  ['rig.setRotateOrder', 'rig.setRotateOrder', (s) => ({ control: s.arm, order: 'zyx' })],
  ['file.importModel', 'file.importModel', () => ({ name: 'seed-san.vrm', bytes: readFixture('seed-san.vrm') })],
  [
    'file.importAnimation',
    'file.importAnimation',
    async (s) => {
      const [vrma] = (await runOk(s.app, 'file.export', {
        kind: 'vrma',
        character: s.character,
        clips: [s.clip],
        fileNamePattern: '{clip}',
        closeLoop: true,
        includeConstantTracks: true,
        acknowledgeLicense: false,
        profile: null,
      })) as ExportArtifact[];
      return { name: vrma?.fileName, bytes: vrma?.bytes };
    },
  ],
  [
    'file.loadSample',
    'file.loadSample',
    () => {
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(readFixture('quaternius-ual.glb'))));
      return { sample: 'quaternius-ual' };
    },
  ],
];

describe.skipIf(!SIBLINGS_READY)(
  `undo/redo exactness of every undoable operator ${BLOCKED}`,
  { timeout: 120_000 },
  () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it.each(CASES)('%s', async (_name, op, prepare) => {
      const s = await scene();
      const args = await prepare(s);
      expect(s.app.operators.get(op)?.flags?.undo).toBe(true);
      await expectUndoRedoExact(s.app, op, args);
    });

    it('undoes a 30-step mixed session back to the post-import state and redoes it', async () => {
      const s = await scene();
      const { app } = s;
      s.app.history.clear();
      const start = docJson(app);
      const steps: readonly (() => Promise<unknown>)[] = [
        () => runOk(app, 'key.set'),
        () => runOk(app, 'time.setFrame', { frame: 20 }),
        () => runOk(app, 'channel.setValues', { edits: [{ control: s.arm, channel: 'ry', value: 0.4 }], key: 'force' }),
        () => runOk(app, 'channel.setValues', { edits: [{ control: s.arm, channel: 'rz', value: 0.1 }] }),
        () => runOk(app, 'key.set', { channels: 'rotate' }),
        () => runOk(app, 'select.keys', { items: s.keys.map((key) => ({ key })), mode: 'replace' }),
        () => runOk(app, 'graph.tangent.set', { type: 'linear' }),
        () => runOk(app, 'graph.keys.move', { dFrames: 1, dValue: 0 }),
        () => runOk(app, 'graph.infinity.set', { post: 'oscillate' }),
        () => runOk(app, 'graph.curve.setWeighted', { weighted: true }),
        () => runOk(app, 'graph.tangent.lockWeight', { locked: false }),
        () => runOk(app, 'clip.rename', { clip: s.clip, name: 'wave2' }),
        () => runOk(app, 'pose.mirror', { mode: 'leftToRight' }),
        () => runOk(app, 'time.setFrame', { frame: 3 }),
        () => runOk(app, 'pose.resetToRest', { controls: [s.control('fk.upperArm.R')] }),
        () => runOk(app, 'channel.setValues', { edits: [{ control: s.control('cog'), channel: 'tx', value: 0.1 }] }),
        () => runOk(app, 'graph.keys.keyCurves'),
        () => runOk(app, 'clip.duplicate', { clip: s.clip }),
        () => runOk(app, 'rig.setControlSize', { control: s.arm, size: 0.3 }),
        () => runOk(app, 'channel.toggleLock', { refs: [{ control: s.arm, channel: 'rx' }] }),
        () => runOk(app, 'select.keys', { items: [], mode: 'replace' }),
        () => runOk(app, 'graph.curves.simplify'),
        () => runOk(app, 'graph.eulerFilter'),
        () => runOk(app, 'clip.setSettings', { clip: s.clip, tags: ['emote'] }),
        () => runOk(app, 'pose.copy'),
        () => runOk(app, 'time.setFrame', { frame: 12 }),
        () => runOk(app, 'pose.paste'),
        () => runOk(app, 'key.set', { channels: 'all', target: 'character' }),
        () => runOk(app, 'clip.new', { name: 'extra' }),
        () => runOk(app, 'key.deleteAtFrame'),
      ];
      for (const step of steps) await step();
      const end = docJson(app);
      let undone = 0;
      while (app.history.canUndo()) {
        await runOk(app, 'edit.undo');
        undone++;
      }
      expect(undone).toBeGreaterThan(15);
      expect(docJson(app)).toEqual(start);
      while (app.history.canRedo()) await runOk(app, 'edit.redo');
      expect(docJson(app)).toEqual(end);
    });
  },
);
