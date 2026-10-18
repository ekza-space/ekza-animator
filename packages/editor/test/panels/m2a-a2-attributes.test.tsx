// M2A-SPEC §5.6, §5.2.3, §5.7 (A2, browser mode): the Attributes panel's Limb section — IK/FK segmented buttons
// (switch with match), Match buttons, the switch key mode preference, the leg foot-pivot fields (cm, degrees) and
// "Add Limb IK" on rigs without limb IK.
import { DEG2RAD } from '@ekza-animator/anim-core';
import { type EditorApp, registerBuiltinOperators } from '@ekza-animator/editor-core';
import { createFakeIkEditorApp, withLimbIkRecords } from '@ekza-animator/editor-core/testing';
import { act, Profiler } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AttributesPanel } from '../../src/panels/attributes/AttributesPanel';
import {
  by,
  cleanup,
  control,
  input,
  loadFixtures,
  maybe,
  mount,
  nextFrame,
  select,
  setClipFrame,
  user,
} from './helpers';

afterEach(cleanup);
let fixtures: Awaited<ReturnType<typeof loadFixtures>>;
beforeAll(async () => {
  fixtures = await loadFixtures();
});

/** A fake app (IK records unless `limbIk: false`) with the built-ins; every run is recorded in `runs`. */
function app(opts?: { readonly limbIk?: boolean }): {
  readonly app: EditorApp;
  readonly runs: { id: string; args: unknown }[];
} {
  const snapshot = opts?.limbIk === false ? fixtures.snapshot : withLimbIkRecords(fixtures.snapshot);
  const created = createFakeIkEditorApp({ snapshot, skeleton: fixtures.skeleton });
  registerBuiltinOperators(created);
  const runs: { id: string; args: unknown }[] = [];
  const original = created.runUntyped.bind(created);
  Object.assign(created, {
    runUntyped: (id: string, args?: unknown, ctx?: Parameters<EditorApp['runUntyped']>[2]) => {
      runs.push({ id, args });
      return original(id, args, ctx);
    },
  });
  return { app: created, runs };
}

const panel = (a: EditorApp) =>
  mount(a, <AttributesPanel app={a} instanceId="attributes#1" />, { width: 360, height: 1200 });
const argsOf = (runs: readonly { id: string; args: unknown }[], id: string) =>
  runs.filter((run) => run.id === id).map((run) => run.args);

describe('Attributes: Limb section (§5.6)', () => {
  it('shows the lead control limb with its mode; the segments switch with match', async () => {
    const { app: a, runs } = app();
    const view = await panel(a);
    await select(a, [control('fk.upperLeg.L')]);
    expect(by('attr-limb-leg.L').dataset.mode).toBe('ik');
    expect(by('attr-limb-mode-ik-leg.L').getAttribute('aria-pressed')).toBe('true');
    expect(by('attr-limb-mode-fk-leg.L').getAttribute('aria-pressed')).toBe('false');
    await user.click(by('attr-limb-mode-fk-leg.L'));
    expect(argsOf(runs, 'rig.ikFk.switch')).toEqual([{ limb: 'leg.L', to: 'fk', match: true }]);
    await select(a, [control('pole.arm.R')]);
    expect(by('attr-limb-arm.R').dataset.mode).toBe('fk');
    await user.click(by('attr-limb-mode-ik-arm.R'));
    expect(argsOf(runs, 'rig.ikFk.switch').at(-1)).toEqual({ limb: 'arm.R', to: 'ik', match: true });
    await select(a, [control('fk.hips')]);
    expect(maybe('attr-section-limb')).toBeNull();
    await view.unmount();
  });

  it('the Match buttons match FK to IK and IK to FK; the key mode select writes the preference', async () => {
    const { app: a, runs } = app();
    const view = await panel(a);
    await select(a, [control('ik.leg.R')]);
    await user.click(by('attr-limb-match-fk-leg.R'));
    await user.click(by('attr-limb-match-ik-leg.R'));
    expect(argsOf(runs, 'rig.ikFk.match')).toEqual([
      { limb: 'leg.R', side: 'fk' },
      { limb: 'leg.R', side: 'ik' },
    ]);
    // prefs.set is the shell's operator (absent from a bare app): a stand-in that writes the preferences.
    a.operators.register({
      id: 'prefs.set',
      label: 'Set Preferences',
      category: 'prefs',
      scope: 'global',
      apply: ({ app: target }, args: { readonly patch: object }) => target.prefs.setState(args.patch),
    });
    expect((by('attr-limb-key-mode') as HTMLSelectElement).value).toBe('auto');
    await user.selectOptions(by('attr-limb-key-mode'), 'seamless');
    expect(a.prefs.getState().ikFkSwitchKey).toBe('seamless');
    expect((by('attr-limb-key-mode') as HTMLSelectElement).value).toBe('seamless');
    await view.unmount();
  });

  it('legs show the foot pivots in cm and the break angle in degrees; edits run rig.setFootParams in metres/radians', async () => {
    const { app: a, runs } = app();
    const view = await panel(a);
    await select(a, [control('ik.leg.L')]);
    expect(input('attr-limb-foot-leg.L-heelBack').value).toBe('5.00');
    expect(input('attr-limb-foot-leg.L-ballFront').value).toBe('10.00');
    expect(input('attr-limb-foot-leg.L-breakAngle').value).toBe('30.0');
    await user.fill(input('attr-limb-foot-leg.L-heelBack'), '8');
    await user.keyboard('{Enter}');
    await user.fill(input('attr-limb-foot-leg.L-breakAngle'), '20');
    await user.keyboard('{Enter}');
    const calls = argsOf(runs, 'rig.setFootParams') as { limb: string; params: Record<string, number> }[];
    expect(calls.map((call) => call.limb)).toEqual(['leg.L', 'leg.L']);
    expect(calls[0]?.params['heelBack']).toBeCloseTo(0.08, 12);
    expect(calls[1]?.params['breakAngle']).toBeCloseTo(20 * DEG2RAD, 12);
    // Negative distances and angles above 90° are refused in the field.
    await user.fill(input('attr-limb-foot-leg.L-toeFront'), '-1');
    await user.keyboard('{Enter}');
    expect(input('attr-limb-foot-leg.L-toeFront').dataset.invalid).toBe('true');
    expect(argsOf(runs, 'rig.setFootParams')).toHaveLength(2);
    // Arms have no foot fields.
    await select(a, [control('fk.hand.L')]);
    expect(maybe('attr-limb-foot-arm.L-heelBack')).toBeNull();
    await view.unmount();
  });

  it('a humanoid rig without limb IK offers Add Limb IK (disabled with the reason until it can run)', async () => {
    const { app: a } = app({ limbIk: false });
    const view = await panel(a);
    await select(a, [control('fk.upperLeg.L')]);
    const button = by('attr-add-limb-ik') as HTMLButtonElement;
    const poll = a.operators.poll('rig.addLimbIk', {}, {});
    expect(button.disabled).toBe(poll !== true);
    expect(button.title).toBe(poll === true ? 'Add IK controls to every limb (they start in FK)' : poll.reason);
    await view.unmount();
  });
});

describe('Attributes: Limb section updates (§5.5 rule 5, MVP-SPEC WP-9)', () => {
  it('commits only when the shown IK/FK mode or value changes, never per frame during playback', async () => {
    const { app: a } = app();
    // An animated limb mode: ikFk 1 at 0, 0 at 10 and 0.5 at 14 (stepped), so leg.L is IK on 0…9 and FK on 10…13.
    const ik = control('ik.leg.L');
    for (const [frame, value] of [
      [0, 1],
      [10, 0],
      [14, 0.5],
    ] as const) {
      await setClipFrame(a, frame);
      await act(async () => {
        await a.runUntyped('channel.setValues', { edits: [{ control: ik, channel: '@ikFk', value }], key: 'force' });
      });
    }
    await setClipFrame(a, 0);
    let commits = 0;
    const view = await mount(
      a,
      <Profiler id="attributes" onRender={() => commits++}>
        <AttributesPanel app={a} instanceId="attributes#1" />
      </Profiler>,
      { width: 360, height: 1200 },
    );
    // One frame of the editor loop: the clip frame changes, the evaluation ticks (a pose event per frame, as in
    // playback) and the browser paints.
    const frameTo = async (frame: number) => {
      await setClipFrame(a, frame);
      await act(async () => {
        a.evaluation.tick();
      });
      await nextFrame();
    };
    await select(a, [ik]);
    await frameTo(0);
    expect(by('attr-limb-leg.L').dataset.mode).toBe('ik');
    // Playback through 1…9: every frame evaluates a new pose, the section shows the same IK 1.000: no commit.
    commits = 0;
    for (let frame = 1; frame <= 9; frame++) await frameTo(frame);
    expect(commits).toBe(0);
    // At 10 the mode changes: the section commits and shows FK; 11…13 stay FK without commits.
    await frameTo(10);
    expect(by('attr-limb-leg.L').dataset.mode).toBe('fk');
    expect(commits).toBeGreaterThan(0);
    commits = 0;
    for (let frame = 11; frame <= 13; frame++) await frameTo(frame);
    expect(commits).toBe(0);
    await frameTo(14);
    expect(by('attr-limb-leg.L').dataset.mode).toBe('blend');
    expect(by('attr-limb-leg.L').textContent).toContain('0.500');
    await view.unmount();
  });
});
