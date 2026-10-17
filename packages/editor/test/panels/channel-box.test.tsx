import { DEG2RAD } from '@ekza-animator/anim-core';
import { type ChannelState, beginChannelEditGesture, type EditorApp } from '@ekza-animator/editor-core';
import { createFakeEditorApp } from '@ekza-animator/editor-core/testing';
import { act, Profiler } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChannelBoxPanel } from '../../src/panels/channel-box/ChannelBoxPanel';
import { isNotImplemented } from '../../src/panels/channel-box/kit/kernel';
import { ChannelReadout, type FrameScheduler } from '../../src/panels/channel-box/readout';
import { CHANNEL_STATE_STYLE, channelStateTitle } from '../../src/panels/channel-box/states';
import {
  by,
  callsOf,
  cleanup,
  control,
  input,
  LOWER_ARM_L,
  LOWER_ARM_R,
  loadFixtures,
  maybe,
  mount,
  nextFrame,
  ROOT,
  select,
  setClipFrame,
  setSession,
  transact,
  user,
  waveApp,
} from './helpers';

afterEach(cleanup);
beforeAll(async () => {
  await loadFixtures();
});

/** True once WP-7a's edit kernel is on this branch (the nudge test of the gesture path then runs). */
const kernelReady = ((): boolean => {
  try {
    beginChannelEditGesture(createFakeEditorApp(), 'probe', { key: 'none' }).cancel();
    return true;
  } catch (error) {
    return !isNotImplemented(error);
  }
})();

const panel = (app: EditorApp) =>
  mount(app, <ChannelBoxPanel app={app} instanceId="cb#1" />, { width: 300, height: 400 });
const rad = (degrees: number): number => degrees * DEG2RAD;
const field = (channel: string): HTMLInputElement => input(`cb-field-${channel}`);
const stateOf = (channel: string): string | undefined =>
  (field(channel).closest('tr') as HTMLElement | null)?.dataset.state;
const cueOf = (channel: string): string | null =>
  field(channel).parentElement?.querySelector<HTMLElement>('[data-cue]')?.dataset.cue ?? null;

/** A synthetic pointer event (modifier clicks that a macOS host would turn into context clicks). */
function pointer(type: string, target: Element, init: PointerEventInit = {}): Promise<void> {
  return act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init }));
  });
}

describe('Channel Box rows and header (FR-CB-01, FR-CB-06)', () => {
  it('asks for a selection when there is none', async () => {
    const view = await panel(waveApp());
    expect(by('cb-empty').textContent).toContain('Select a control');
    await view.unmount();
  });

  it("shows the lead's keyable channels in degrees, its name and its read-only rotate order", async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    expect(by('cb-lead-name').textContent).toBe('L Lower Arm');
    expect(by('cb-rotate-order').textContent).toContain('xzy');
    expect(maybe('cb-more')).toBeNull();
    expect(maybe('cb-field-tx')).toBeNull(); // translation is not keyable on FK arms
    expect(maybe('cb-field-sx')).toBeNull();
    expect(field('rz').value).toBe('30.000');
    expect(field('rx').value).toBe('0.000');

    await select(app, [ROOT]);
    expect(['tx', 'ty', 'tz', 'rx', 'ry', 'rz'].every((channel) => maybe(`cb-field-${channel}`) !== null)).toBe(true);
    expect(maybe('cb-field-sx')).toBeNull();
    expect(by('cb-name-ty').textContent).toBe('Translate Y');

    await select(app, [LOWER_ARM_R, LOWER_ARM_L]);
    expect(by('cb-more').textContent).toBe('+1');
    await view.unmount();
  });

  it('shows mixed values as — and agreeing values normally', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_R, LOWER_ARM_L]);
    expect(field('rz').value).toBe('—');
    expect(field('rz').title).toContain('values differ');
    expect(field('rx').value).toBe('0.000');
    await view.unmount();
  });
});

describe('Channel Box colour states (FR-CB-02)', () => {
  it('maps every evaluation.channelState to a fill, a shape cue and a tooltip', () => {
    const states: readonly ChannelState[] = ['keyed-on-frame', 'keyed', 'changed', 'locked', 'static', 'non-keyable'];
    const cues = states.map((state) => CHANNEL_STATE_STYLE[state].bar);
    expect(cues).toEqual(['solid', 'thin', 'dashed', 'lock', 'none', 'none']);
    expect(CHANNEL_STATE_STYLE['keyed-on-frame'].fill).toContain('#c8323c');
    expect(CHANNEL_STATE_STYLE.keyed.fill).toContain('#7a2e3a');
    expect(CHANNEL_STATE_STYLE.changed.fill).toContain('#f2a5b8');
    expect(CHANNEL_STATE_STYLE.locked.fill).toContain('#33353c');
    // Distinct states never share both colour and cue.
    const signatures = new Set(states.map((s) => `${CHANNEL_STATE_STYLE[s].fill}|${CHANNEL_STATE_STYLE[s].bar}`));
    expect(signatures.size).toBe(states.length - 1); // static and non-keyable differ by text colour only
    expect(channelStateTitle('keyed-on-frame', 24)).toBe('Keyed at f24');
    expect(channelStateTitle('keyed-on-frame', 7.5)).toBe('Keyed at f7.50');
    expect(channelStateTitle('changed', null)).toContain('not keyed');
  });

  it('follows the states of the fake app: keyed on frame, keyed, changed, locked, static', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    expect(stateOf('rz')).toBe('keyed-on-frame');
    expect(cueOf('rz')).toBe('solid');
    expect(field('rz').title).toBe('Keyed at f0');
    expect(field('rz').style.background).toContain('--cb-keyed-on');
    expect(stateOf('rx')).toBe('static');
    expect(cueOf('rx')).toBeNull();

    await setClipFrame(app, 5);
    await nextFrame();
    expect(stateOf('rz')).toBe('keyed');
    expect(cueOf('rz')).toBe('thin');

    await setSession(app, { overrides: new Map([[LOWER_ARM_L, { rz: rad(12) }]]) });
    await nextFrame();
    expect(stateOf('rz')).toBe('changed');
    expect(cueOf('rz')).toBe('dashed');
    expect(field('rz').value).toBe('12.000');

    await transact(app, (tx) =>
      tx.patch('controls', LOWER_ARM_L, {
        locked: { t: [false, false, false], r: [true, false, false], s: [false, false, false] },
      }),
    );
    await nextFrame();
    expect(stateOf('rx')).toBe('locked');
    expect(cueOf('rx')).toBe('lock');
    expect(field('rx').readOnly).toBe(true);
    await view.unmount();
  });
});

describe('Channel Box numeric entry (FR-CB-03, US-11)', () => {
  it('types absolute and relative values through channel.setValues (degrees in, radians out)', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.fill(field('rz'), '45');
    await user.keyboard('{Enter}');
    await user.fill(field('rz'), '+=10');
    await user.keyboard('{Enter}');
    const calls = callsOf(app, 'channel.setValues') as { edits: { value: number }[] }[];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      edits: [{ control: LOWER_ARM_L, channel: 'rz' }],
      key: 'auto',
      label: 'Set Rotate Z',
    });
    expect(calls[0]?.edits[0]?.value).toBeCloseTo(rad(45), 12);
    expect(calls[1]?.edits[0]?.value).toBeCloseTo(rad(40), 12); // relative to the shown 30°
    expect(document.activeElement).not.toBe(field('rz')); // Enter leaves the field, so S keys again
    await view.unmount();
  });

  it('applies to every selected control, relative expressions per control', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_R, LOWER_ARM_L]);
    await user.fill(field('rz'), '+=10');
    await user.keyboard('{Enter}');
    await user.fill(field('rz'), '-90');
    await user.keyboard('{Enter}');
    const [relative, absolute] = callsOf(app, 'channel.setValues') as {
      edits: { control: string; channel: string; value: number }[];
    }[];
    expect(relative?.edits.map((e) => e.control)).toEqual([LOWER_ARM_R, LOWER_ARM_L]);
    expect(relative?.edits[0]?.value).toBeCloseTo(rad(10), 12);
    expect(relative?.edits[1]?.value).toBeCloseTo(rad(40), 12);
    expect(absolute?.edits.map((e) => e.value)).toEqual([rad(-90), rad(-90)]);
    await view.unmount();
  });

  it('rejects text that is not an expression and keeps the old value on Esc', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.fill(field('rz'), 'abc');
    await user.keyboard('{Enter}');
    expect(field('rz').dataset.invalid).toBe('true');
    expect(field('rz').title).toContain('not a number');
    await user.keyboard('{Escape}');
    expect(field('rz').value).toBe('30.000');
    expect(callsOf(app, 'channel.setValues')).toEqual([]);
    await view.unmount();
  });

  it('Tab and Shift+Tab move through the editable fields and wrap', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.click(field('rx'));
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(field('ry'));
    await user.keyboard('{Tab}{Tab}');
    expect(document.activeElement).toBe(field('rx'));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(field('rz'));
    expect(callsOf(app, 'channel.setValues')).toEqual([]); // nothing typed, nothing written
    await view.unmount();
  });

  it.skipIf(kernelReady)(
    'nudges with ↑/↓ (Shift ×10) as one coalesced channel.setValues per burst until the edit kernel lands',
    async () => {
      const app = waveApp();
      const view = await panel(app);
      await select(app, [LOWER_ARM_L]);
      await user.click(field('rz'));
      await user.keyboard('{ArrowUp>3}');
      expect(field('rz').value).toBe('33.000'); // shown while the burst runs
      expect(callsOf(app, 'channel.setValues')).toEqual([]);
      await user.keyboard('{/ArrowUp}');
      const [burst] = callsOf(app, 'channel.setValues') as { edits: { value: number }[]; label: string }[];
      expect(burst?.label).toBe('Nudge Rotate Z');
      expect(burst?.edits[0]?.value).toBeCloseTo(rad(33), 12);
      // The fake app has no operator: the run is cancelled and the field shows the document value again.
      await act(async () => {
        await Promise.resolve();
      });
      expect(field('rz').value).toBe('30.000');

      await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
      const second = callsOf(app, 'channel.setValues')[1] as { edits: { value: number }[] };
      expect(second.edits[0]?.value).toBeCloseTo(rad(20), 12);

      // Esc cancels a burst without writing.
      await user.keyboard('{ArrowUp>}');
      await user.keyboard('{Escape}');
      expect(callsOf(app, 'channel.setValues')).toHaveLength(2);
      expect(field('rz').value).toBe('30.000');
      await view.unmount();
    },
  );

  it.runIf(kernelReady)('nudges with ↑/↓ as one beginChannelEditGesture per burst (one history step)', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.click(field('rz'));
    await user.keyboard('{ArrowUp>3}{/ArrowUp}');
    expect(callsOf(app, 'channel.setValues')).toEqual([]);
    expect(app.history.peekUndo()?.label).toBe('Nudge Rotate Z');
    expect(app.evaluation.channelValues(LOWER_ARM_L).rz).toBeCloseTo(rad(33), 9);
    await act(async () => {
      app.history.undo();
    });
    expect(app.evaluation.channelValues(LOWER_ARM_L).rz).toBeCloseTo(rad(30), 9);
    await view.unmount();
  });
});

describe('Channel Box channel selection and menu (FR-CB-04)', () => {
  const channels = (app: EditorApp) => app.session.getState().selection.channels;

  it('selects channel names with click, Shift (toggle), Mod (remove) and drag; typing applies to all of them', async () => {
    const app = waveApp({ platform: 'other' });
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.click(by('cb-name-rz'));
    expect(channels(app)).toEqual([{ control: LOWER_ARM_L, channel: 'rz' }]);
    expect(by('cb-name-rz').getAttribute('aria-pressed')).toBe('true');
    await pointer('pointerdown', by('cb-name-rx'), { shiftKey: true });
    expect(channels(app)).toEqual([
      { control: LOWER_ARM_L, channel: 'rx' },
      { control: LOWER_ARM_L, channel: 'rz' },
    ]);
    await pointer('pointerdown', by('cb-name-rz'), { ctrlKey: true });
    expect(channels(app)).toEqual([{ control: LOWER_ARM_L, channel: 'rx' }]);

    // Drag down the names: a range from the anchor.
    await pointer('pointerdown', by('cb-name-rx'));
    // React derives pointerenter from the `pointerout` of the element the pointer leaves.
    await pointer('pointerout', by('cb-name-rx'), { relatedTarget: by('cb-name-rz') });
    expect(channels(app).map((ref) => ref.channel)).toEqual(['rx', 'ry', 'rz']);
    await pointer('pointerup', by('cb-name-rz'), { buttons: 0 });

    // A typed value goes to every selected channel.
    await user.fill(field('ry'), '5');
    await user.keyboard('{Enter}');
    const [typed] = callsOf(app, 'channel.setValues') as { edits: { channel: string }[]; label: string }[];
    expect(typed?.edits.map((e) => e.channel)).toEqual(['rx', 'ry', 'rz']);
    expect(typed?.label).toBe('Set 3 Channels');
    await view.unmount();
  });

  it('selects the channel on every selected control', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_R, LOWER_ARM_L]);
    await user.click(by('cb-name-ry'));
    expect(channels(app)).toEqual([
      { control: LOWER_ARM_R, channel: 'ry' },
      { control: LOWER_ARM_L, channel: 'ry' },
    ]);
    await view.unmount();
  });

  it('RMB: Key Selected, Reset to Default and Lock/Unlock on the channel under the pointer', async () => {
    const app = waveApp();
    const view = await panel(app);
    await select(app, [LOWER_ARM_L]);
    await user.rightClick(by('cb-name-ry'));
    expect(channels(app)).toEqual([{ control: LOWER_ARM_L, channel: 'ry' }]);
    await user.click(by('cb-menu-key-selected'));
    expect(callsOf(app, 'key.set')).toEqual([{ channels: 'selected' }]);

    await user.rightClick(field('ry'));
    await user.click(by('cb-menu-reset'));
    expect(callsOf(app, 'channel.setValues')).toEqual([
      { edits: [{ control: LOWER_ARM_L, channel: 'ry', value: 0 }], key: 'auto', label: 'Reset to Default' },
    ]);

    await user.rightClick(by('cb-name-ry'));
    expect(by('cb-menu-lock').textContent).toContain('Lock Selected');
    await user.click(by('cb-menu-lock'));
    expect(callsOf(app, 'channel.toggleLock')).toEqual([
      { refs: [{ control: LOWER_ARM_L, channel: 'ry' }], locked: true },
    ]);
    await transact(app, (tx) =>
      tx.patch('controls', LOWER_ARM_L, {
        locked: { t: [false, false, false], r: [false, true, false], s: [false, false, false] },
      }),
    );
    await user.rightClick(by('cb-name-ry'));
    expect(by('cb-menu-lock').textContent).toContain('Unlock Selected');
    await user.click(by('cb-menu-lock'));
    expect(callsOf(app, 'channel.toggleLock')[1]).toEqual({
      refs: [{ control: LOWER_ARM_L, channel: 'ry' }],
      locked: false,
    });
    await view.unmount();
  });
});

describe('Channel Box updates (WP-9 DoD)', () => {
  it('commits once per animation frame however often time changes, and not at all when no value changes', async () => {
    const app = waveApp();
    let commits = 0;
    const view = await mount(
      app,
      <Profiler id="channel-box" onRender={() => commits++}>
        <ChannelBoxPanel app={app} instanceId="cb#1" />
      </Profiler>,
    );
    await select(app, [LOWER_ARM_L]);
    await nextFrame();
    commits = 0;
    await act(async () => {
      for (let frame = 1; frame <= 6; frame++) {
        app.session.setState({ time: { ...app.session.getState().time, sceneFrame: frame } });
      }
    });
    expect(commits).toBe(0); // time is not React state of the panel
    await nextFrame();
    expect(commits).toBe(1);
    const at6 = app.evaluation.channelValues(LOWER_ARM_L).rz / DEG2RAD;
    expect(field('rz').value).toBe(at6.toFixed(3));

    // A control without keys: frames pass, nothing visible changes, nothing commits.
    await select(app, [control('fk.head')]);
    await nextFrame();
    commits = 0;
    for (let frame = 7; frame <= 9; frame++) {
      await setClipFrame(app, frame);
      await nextFrame();
    }
    expect(commits).toBe(0);
    await view.unmount();
  });

  it('the readout coalesces invalidations and keeps unchanged cells', () => {
    const app = waveApp();
    const queued: (() => void)[] = [];
    const scheduler: FrameScheduler = {
      request: (callback) => queued.push(callback),
      cancel: (handle) => {
        queued[handle - 1] = () => {};
      },
    };
    const readout = new ChannelReadout(app, scheduler);
    const disconnect = readout.connect();
    readout.setTargets({
      lead: LOWER_ARM_L,
      character: 'chr_SyntheticWave001' as never,
      channels: new Map([
        ['rx', [LOWER_ARM_L]],
        ['rz', [LOWER_ARM_L]],
      ]),
    });
    const rx = readout.cell('rx');
    const rz = readout.cell('rz');
    const before = readout.recomputes;
    for (let frame = 1; frame <= 5; frame++) {
      app.session.setState({ time: { ...app.session.getState().time, sceneFrame: frame } });
    }
    expect(readout.recomputes).toBe(before);
    expect(queued).toHaveLength(1);
    queued[0]?.();
    expect(readout.recomputes).toBe(before + 1);
    expect(readout.cell('rx')).toBe(rx);
    expect(readout.cell('rz')).not.toBe(rz);
    disconnect();
    app.session.setState({ time: { ...app.session.getState().time, sceneFrame: 9 } });
    expect(queued).toHaveLength(1);
    readout.dispose();
  });
});
