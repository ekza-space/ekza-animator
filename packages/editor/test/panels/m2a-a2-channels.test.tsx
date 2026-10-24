// M2A-SPEC §5.1 rule 5, §5.6, §5.18 (A2, browser mode): Channels panel attribute rows in their units, the IK/FK proxy
// row (raw @ikFk row hidden; edits and keys the IK control's curve; the switch button), the virtual slider on rows
// (MMB press on any row, LMB drag ≥ 3 px on a name; one history step; a refused Pointer Lock falls back to capture),
// and Lock disabled on attribute rows.
import { DEG2RAD } from '@ekza-studio/anim-core';
import type { ChannelId, ControlId } from '@ekza-studio/doc';
import { type EditorApp, registerBuiltinOperators } from '@ekza-studio/editor-core';
import { createFakeIkEditorApp, withLimbIkRecords } from '@ekza-studio/editor-core/testing';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ChannelsPanel } from '../../src/panels/channels/ChannelsPanel';
import { by, CLIP, cleanup, control, input, loadFixtures, maybe, mount, select, setSession, user } from './helpers';

afterEach(cleanup);
let fixtures: Awaited<ReturnType<typeof loadFixtures>>;
beforeAll(async () => {
  fixtures = await loadFixtures();
});

/** The IK fixture app with the built-in operators; every run is recorded in `runs`. */
function ikApp(): { readonly app: EditorApp; readonly runs: { id: string; args: unknown }[] } {
  const app = createFakeIkEditorApp({ snapshot: withLimbIkRecords(fixtures.snapshot), skeleton: fixtures.skeleton });
  registerBuiltinOperators(app);
  const runs: { id: string; args: unknown }[] = [];
  const runUntyped = app.runUntyped.bind(app);
  (app as { runUntyped: EditorApp['runUntyped'] }).runUntyped = (id, args, ctx) => {
    runs.push({ id, args });
    return runUntyped(id, args, ctx);
  };
  return { app, runs };
}

const panel = (app: EditorApp) =>
  mount(app, <ChannelsPanel app={app} instanceId="cb#1" />, { width: 320, height: 520 });
const field = (channel: string): HTMLInputElement => input(`cb-field-${channel}`);
const IK_LEG = control('ik.leg.L');

function keysOf(app: EditorApp, id: ControlId, channel: ChannelId): { t: number; v: number; outType: string }[] {
  const layer = app.store.query.baseLayer(CLIP);
  const curve = layer === undefined ? undefined : app.store.query.curveFor(CLIP, layer.id, id, channel);
  return curve === undefined
    ? []
    : app.store.query.keysOfCurve(curve.id).map((key) => ({ t: key.t, v: key.v, outType: key.outType }));
}

/** A pointer event dispatched inside act() (MMB presses, movementX moves). */
function dispatch(target: EventTarget, type: string, init: PointerEventInit): Promise<void> {
  return act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }));
  });
}

/** Pointer Lock refused for every element (headless browsers have no lock): the slider uses pointer capture. */
function refuseLocks(): () => void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'requestPointerLock');
  Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', {
    configurable: true,
    value: (): Promise<void> => Promise.reject(new DOMException('refused')),
  });
  return () => {
    delete (HTMLElement.prototype as { requestPointerLock?: unknown }).requestPointerLock;
    if (original !== undefined) Object.defineProperty(Element.prototype, 'requestPointerLock', original);
  };
}

describe('attribute rows (§5.1 rule 5)', () => {
  it('lists the IK foot attributes after TRS in attrs order, in their units; no raw @ikFk row', async () => {
    const { app } = ikApp();
    const view = await panel(app);
    await select(app, [IK_LEG]);
    const names = [...document.querySelectorAll<HTMLElement>('[data-testid^="cb-name-"]')].map((n) => n.textContent);
    expect(names).toEqual([
      'Translate X',
      'Translate Y',
      'Translate Z',
      'Rotate X',
      'Rotate Y',
      'Rotate Z',
      'Soft',
      'Twist',
      'Roll',
      'Bank',
      'Heel Twist',
      'Toe Twist',
    ]);
    expect(maybe('cb-field-@ikFk')).toBeNull();
    expect(field('@roll').value).toBe('0.000');
    // Typed values are display units: 30 on Roll is 30°.
    await user.fill(field('@roll'), '30');
    await user.keyboard('{Enter}');
    expect(app.evaluation.channelValue(IK_LEG, '@roll')).toBeCloseTo(30 * DEG2RAD, 12);
    expect(field('@roll').value).toBe('30.000');
    // Soft is a plain number (3 decimals).
    await user.fill(field('@soft'), '0.1');
    await user.keyboard('{Enter}');
    expect(app.evaluation.channelValue(IK_LEG, '@soft')).toBeCloseTo(0.1, 12);
    expect(field('@soft').value).toBe('0.100');
    await view.unmount();
  });

  it('Lock is disabled on attribute rows; Reset to Default writes the attribute default', async () => {
    const { app } = ikApp();
    const view = await panel(app);
    await select(app, [IK_LEG]);
    await user.fill(field('@bank'), '12');
    await user.keyboard('{Enter}');
    await user.rightClick(field('@bank'));
    expect(by('cb-menu-lock').getAttribute('aria-disabled')).toBe('true');
    await user.click(by('cb-menu-reset'));
    expect(app.evaluation.channelValue(IK_LEG, '@bank')).toBe(0);
    await view.unmount();
  });
});

describe('the IK/FK proxy row (§5.6)', () => {
  it('shows the limb ikFk for any control of the limb and edits the IK control curve', async () => {
    const { app } = ikApp();
    const view = await panel(app);
    await select(app, [control('fk.upperArm.L')]);
    expect(by('cb-ikfk-row').dataset.limb).toBe('arm.L');
    expect(input('cb-ikfk-field').value).toBe('0.000');
    await select(app, [IK_LEG]);
    expect(by('cb-ikfk-row').dataset.limb).toBe('leg.L');
    expect(by('cb-ikfk-row').dataset.mode).toBe('ik');
    expect(input('cb-ikfk-field').value).toBe('1.000');
    await select(app, [control('pole.leg.L')]);
    expect(by('cb-ikfk-row').dataset.limb).toBe('leg.L');
    await select(app, [control('fk.hips')]);
    expect(maybe('cb-ikfk-row')).toBeNull();
    // Typing on the proxy of an FK leg control writes ik.leg.L/@ikFk (static: no keys, auto-key off).
    await select(app, [control('fk.lowerLeg.L')]);
    await user.fill(input('cb-ikfk-field'), '0');
    await user.keyboard('{Enter}');
    expect(app.evaluation.ikFk('chr_SyntheticWave001' as never, 'leg.L')).toBe(0);
    expect(by('cb-ikfk-row').dataset.mode).toBe('fk');
    await setSession(app, {});
    // With a key on @ikFk, the proxy edit keys it under auto-key.
    app.prefs.setState({ autoKey: true });
    await act(async () => {
      await app.runUntyped('channel.setValues', {
        edits: [{ control: IK_LEG, channel: '@ikFk', value: 0 }],
        key: 'force',
      });
    });
    await user.fill(input('cb-ikfk-field'), '1');
    await user.keyboard('{Enter}');
    expect(keysOf(app, IK_LEG, '@ikFk')).toEqual([{ t: 0, v: 1, outType: 'step' }]);
    await view.unmount();
  });

  it("selecting the proxy name makes @ikFk a selected channel, so S keys it ('selected' too)", async () => {
    const { app } = ikApp();
    const view = await panel(app);
    await select(app, [control('fk.upperLeg.L')]);
    await user.click(by('cb-ikfk-name'));
    expect(app.session.getState().selection.channels).toEqual([{ control: IK_LEG, channel: '@ikFk' }]);
    expect(by('cb-ikfk-name').getAttribute('aria-pressed')).toBe('true');
    await act(async () => {
      await app.runUntyped('key.set', { channels: 'selected' });
    });
    expect(keysOf(app, IK_LEG, '@ikFk')).toEqual([{ t: 0, v: 1, outType: 'step' }]);
    await view.unmount();
  });

  it('the switch button runs rig.ikFk.switch towards the other mode with match', async () => {
    const { app, runs } = ikApp();
    const view = await panel(app);
    await select(app, [control('fk.hand.R')]);
    await user.click(by('cb-ikfk-switch'));
    expect(runs.filter((run) => run.id === 'rig.ikFk.switch').map((run) => run.args)).toEqual([
      { limb: 'arm.R', to: 'ik', match: true },
    ]);
    await select(app, [control('ik.leg.R')]);
    await user.click(by('cb-ikfk-switch'));
    expect(runs.filter((run) => run.id === 'rig.ikFk.switch').at(-1)?.args).toEqual({
      limb: 'leg.R',
      to: 'fk',
      match: true,
    });
    await view.unmount();
  });
});

describe('virtual slider on rows (§5.18)', () => {
  it('MMB press on a row and 40 px of motion add 20° in one history step; Shift ×0.1', async () => {
    const restore = refuseLocks();
    try {
      const { app } = ikApp();
      const view = await panel(app);
      const hand = control('fk.hand.L');
      await select(app, [hand]);
      const row = by('cb-name-rz').closest('tr') as HTMLElement;
      await dispatch(by('cb-name-rz'), 'pointerdown', { button: 1, buttons: 4 });
      for (let i = 0; i < 4; i++) await dispatch(row, 'pointermove', { buttons: 4, movementX: 10 });
      await dispatch(row, 'pointerup', { button: 1 });
      expect(app.evaluation.channelValues(hand).rz).toBeCloseTo(20 * DEG2RAD, 9);
      expect(app.history.peekUndo()?.label).toBe('Drag Rotate Z');
      await act(async () => {
        await app.runUntyped('edit.undo');
      });
      expect(app.evaluation.channelValues(hand).rz).toBe(0);
      await dispatch(by('cb-field-rz'), 'pointerdown', { button: 1, buttons: 4 });
      await dispatch(row, 'pointermove', { buttons: 4, movementX: 40, shiftKey: true });
      await dispatch(row, 'pointerup', { button: 1 });
      expect(app.evaluation.channelValues(hand).rz).toBeCloseTo(2 * DEG2RAD, 9);
      expect(app.history.canUndo()).toBe(true);
      await view.unmount();
    } finally {
      restore();
    }
  });

  it('a pressed selected name drives every selected name on every selected control that has it', async () => {
    const restore = refuseLocks();
    try {
      const { app } = ikApp();
      const view = await panel(app);
      const left = control('fk.hand.L');
      const right = control('fk.hand.R');
      await select(app, [right, left]);
      await user.click(by('cb-name-rx'));
      await user.click(by('cb-name-rz'), { modifiers: ['Shift'] });
      const row = by('cb-name-rz').closest('tr') as HTMLElement;
      await dispatch(by('cb-name-rz'), 'pointerdown', { button: 1, buttons: 4 });
      await dispatch(row, 'pointermove', { buttons: 4, movementX: 20 });
      await dispatch(row, 'pointerup', { button: 1 });
      for (const id of [left, right]) {
        expect(app.evaluation.channelValues(id).rx).toBeCloseTo(10 * DEG2RAD, 9);
        expect(app.evaluation.channelValues(id).rz).toBeCloseTo(10 * DEG2RAD, 9);
        expect(app.evaluation.channelValues(id).ry).toBe(0);
      }
      expect(app.history.peekUndo()?.label).toBe('Drag 2 Channels');
      await view.unmount();
    } finally {
      restore();
    }
  });

  it('an LMB drag of ≥ 3 px sideways on a name scrubs (the click still selects); attributes clamp', async () => {
    const restore = refuseLocks();
    try {
      const { app } = ikApp();
      const view = await panel(app);
      await select(app, [IK_LEG]);
      const name = by('cb-name-@soft');
      const rect = name.getBoundingClientRect();
      const x = rect.left + 20;
      const y = rect.top + rect.height / 2;
      await dispatch(name, 'pointerdown', { button: 0, buttons: 1, clientX: x, clientY: y });
      expect(app.session.getState().selection.channels).toEqual([{ control: IK_LEG, channel: '@soft' }]);
      // 2 px: still a click.
      await dispatch(window, 'pointermove', { buttons: 1, clientX: x + 2, clientY: y, movementX: 2 });
      expect(app.evaluation.channelValue(IK_LEG, '@soft')).toBe(0);
      // 4 px from the press: the slider starts with that motion ((0.25 − 0) / 200 per px).
      await dispatch(window, 'pointermove', { buttons: 1, clientX: x + 4, clientY: y, movementX: 2 });
      const row = name.closest('tr') as HTMLElement;
      await dispatch(row, 'pointermove', { buttons: 1, movementX: 396 });
      await dispatch(row, 'pointerup', { button: 0 });
      // 4 + 396 px = 0.5, clamped to the range 0…0.25.
      expect(app.evaluation.channelValue(IK_LEG, '@soft')).toBe(0.25);
      expect(app.history.peekUndo()?.label).toBe('Drag Soft');
      await view.unmount();
    } finally {
      restore();
    }
  });

  // Acceptance fix round 1, bug 10: the LMB start added the fractional clientX distance of the threshold move, then
  // integrated movementX (whole pixels): 20 px in six moves of 3.33 px gave +10.1667° instead of +10°.
  it('an LMB drag integrates movementX only: fractional clientX steps give the MMB result', async () => {
    const restore = refuseLocks();
    try {
      const { app } = ikApp();
      const view = await panel(app);
      const hand = control('fk.hand.L');
      await select(app, [hand]);
      const name = by('cb-name-rz');
      const rect = name.getBoundingClientRect();
      const x = rect.left + 20;
      const y = rect.top + rect.height / 2;
      const row = name.closest('tr') as HTMLElement;
      await dispatch(name, 'pointerdown', { button: 0, buttons: 1, clientX: x, clientY: y });
      // Six moves of 20/6 px: the browser reports whole-pixel movementX (3, 4, 3, 3, 4, 3 = 20).
      const steps = [3, 4, 3, 3, 4, 3];
      let at = x;
      for (const [i, movementX] of steps.entries()) {
        at = x + ((i + 1) * 20) / 6;
        const target = i === 0 ? window : row;
        await dispatch(target, 'pointermove', { buttons: 1, clientX: at, clientY: y, movementX });
      }
      await dispatch(row, 'pointerup', { button: 0 });
      expect(app.evaluation.channelValues(hand).rz).toBeCloseTo(10 * DEG2RAD, 12);
      await view.unmount();
    } finally {
      restore();
    }
  });
});
