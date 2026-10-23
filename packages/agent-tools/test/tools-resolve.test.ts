// MCP-SPEC §5.1, §5.5 (P2): names, ids, display names, VRM humanoid names and opaque `sec.#…` keys resolve to the same
// control through the tools; ambiguous names answer with candidates and never guess; default reads stay within their
// budgets on Seed-san with its secondary controls.
import { seededIdSource } from '@ekza-studio/doc';
import { createHeadlessEditorApp } from '@ekza-studio/editor-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentToolRuntime, opaqueControlKey, tokensOf } from '../src';
import {
  AGENT,
  call,
  controlOf,
  dataOf,
  errorOf,
  host,
  type P2Fixture,
  p2Fixture,
  runtimeOf,
  runtimeReady,
  signal,
} from './p2-support';
import { withP1 } from './p1-doubles';
import { readSample } from './support';

let fx: P2Fixture;
beforeEach(async () => {
  fx = await p2Fixture(121);
});

const controlsOfRead = (result: Awaited<ReturnType<typeof call>>): string[] =>
  dataOf<{ curves: { control: string }[] }>(result).curves.map((curve) => curve.control);

describe('addressing (§5.1)', () => {
  it('resolves a template key, a display name, a VRM bone and an id to the same control', async () => {
    const runtime = runtimeOf(fx);
    const id = controlOf(fx.app, fx.character, 'fk.lowerArm.L');
    for (const ref of ['fk.lowerArm.L', 'l lower arm', 'leftLowerArm', id]) {
      const result = await call(runtime, 'keys_read', { clip: 'agent', targets: { controls: [ref] } });
      expect([ref, controlsOfRead(result)]).toEqual([ref, ['fk.lowerArm.L']]);
    }
    // clips and characters by name (case-insensitive for characters) or id
    expect(
      (await call(runtime, 'keys_read', { character: 'polybot', clip: fx.agentClip, targets: { controls: ['cog'] } }))
        .ok,
    ).toBe(true);
  });

  it('replaces a long or unsafe secondary key by an opaque key that resolves back', async () => {
    const control = fx.app.store.query
      .controlsOfRig(fx.app.store.query.rigOfCharacter(fx.character)?.id as never)
      .find((c) => c.key.startsWith('sec.'));
    if (control === undefined) throw new Error('no secondary control');
    const long = `sec.${'Hair_Joint_'.repeat(6)}`;
    fx.app.store.transact({ label: 'long key' }, (tx) => tx.patch('controls', control.id, { key: long }));
    const opaque = opaqueControlKey(control.id);
    expect(opaque).toMatch(/^sec\.#[0-9A-Za-z]{8}$/);
    const rig = dataOf<{ controls: { key: string }[] }>(
      await call(runtimeOf(fx), 'rig_describe', { bodyParts: ['all'] }),
    );
    expect(rig.controls.map((c) => c.key)).toContain(opaque);
    expect(rig.controls.map((c) => c.key)).not.toContain(long);
    const read = await call(runtimeOf(fx), 'pose_read', {
      clip: 'agent',
      frames: [0],
      targets: { controls: [opaque] },
    });
    expect(dataOf<{ frames: { controls: { control: string }[] }[] }>(read).frames[0]?.controls[0]?.control).toBe(
      opaque,
    );
  });

  it('answers ambiguous with every match as a candidate, never guessing', async () => {
    const a = controlOf(fx.app, fx.character, 'fk.hand.L');
    const b = controlOf(fx.app, fx.character, 'fk.hand.R');
    fx.app.store.transact({ label: 'same names' }, (tx) => {
      tx.patch('controls', a, { name: 'Hand' });
      tx.patch('controls', b, { name: 'Hand' });
    });
    const result = await call(runtimeOf(fx), 'keys_read', { clip: 'agent', targets: { controls: ['Hand'] } });
    expect(errorOf(result).code).toBe('ambiguous');
    expect(errorOf(result).candidates).toEqual(['fk.hand.L (Hand, leftHand)', 'fk.hand.R (Hand, rightHand)']);
  });

  it('answers humanoid_only for body parts on a generic rig and limb errors with the tool to use', async () => {
    const runtime = runtimeOf(fx);
    const leg = await call(runtime, 'pose_ik_target', { clip: 'agent', frame: 0, limb: 'arm.R', positionM: [0, 1, 0] });
    expect(errorOf(leg).code).toBe('limb_mode');
    const rig = fx.app.store.query.rigOfCharacter(fx.character);
    fx.app.store.transact({ label: 'generic' }, (tx) =>
      tx.patch('rigs', rig?.id as never, { generator: { name: 'ekza-autorig-generic', version: '1' } }),
    );
    const parts = await call(runtime, 'keys_read', { clip: 'agent', targets: { bodyParts: ['arm.L'] } });
    expect(errorOf(parts).code).toBe('humanoid_only');
    const aim = await call(runtime, 'pose_aim', {
      clip: 'agent',
      frame: 0,
      aims: [{ bone: 'leftUpperArm', direction: 'left' }],
    });
    expect(errorOf(aim).code).toBe('humanoid_only');
  });
});

describe('default read budgets on Seed-san (§5.5)', () => {
  it('keeps every default read within its budget', async () => {
    const app = createHeadlessEditorApp({ readSample, idSource: seededIdSource(12) });
    const loaded = await app.runUntyped('file.loadSample', { sample: 'seed-san' });
    const character = (loaded as { value: { character: never } }).value.character;
    await runtimeReady(app, character);
    const runtime = createAgentToolRuntime({ app: withP1(app), host: host(), actor: AGENT });
    // a keyed clip: every primary control keyed at three frames
    const rig = dataOf<{ controls: { key: string }[] }>(await runtime.call('rig_describe', {}, { signal: signal() }));
    const keys = rig.controls
      .filter((c) => c.key.startsWith('fk.'))
      .flatMap((c) => [0, 30, 60].map((frame) => ({ control: c.key, channel: 'rz', frame, value: frame / 10 })));
    const written = await runtime.call('keys_set', { keys }, { signal: signal() });
    expect(written.ok ? 'ok' : JSON.stringify(written.error)).toBe('ok');
    const budgets: [string, Record<string, unknown>, number][] = [
      ['scene_summary', {}, 600],
      ['rig_describe', {}, 1_500],
      ['pose_read', {}, 1_500],
      ['curves_summary', {}, 1_500],
      ['keys_read', { targets: { bodyParts: ['all'] } }, 2_000],
      ['history_checkpoint', { list: true }, 600],
    ];
    for (const [name, args, tokens] of budgets) {
      const result = await runtime.call(name, args, { signal: signal() });
      expect([name, tokensOf(dataOf(result)) <= tokens ? 'within' : `${tokensOf(dataOf(result))} > ${tokens}`]).toEqual(
        [name, 'within'],
      );
    }
  });
});
