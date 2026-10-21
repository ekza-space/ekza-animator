// M2A-SPEC §5.5 and §5.18 in the viewport (A2, browser mode): controls drawn by the single visibility rule (IK/FK
// sets hidden, selected ghosts at 25 % alpha, never pickable or marquee-selected), pole annotation lines from the
// mid bone to the pole, and the plain-MMB virtual slider (pointer capture and Pointer Lock paths, Esc under lock,
// refused locks, Alt+MMB stays navigation).
import { DEG2RAD } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId, RigId } from '@ekza-studio/doc';
import { registerBuiltinOperators } from '@ekza-studio/editor-core';
import {
  createFakeIkEditorApp,
  type FakeEditorApp,
  fixtureControl,
  withLimbIkRecords,
} from '@ekza-studio/editor-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVirtualSliderDrag } from '../src';
import { ControlLayer } from '../src/controls/ControlLayer';
import { createRig, fixtures, pointer, type Rig } from './helpers';

const RIG = 'rig_SyntheticWave001' as RigId;
const CHARACTER = 'chr_SyntheticWave001' as CharacterId;
const c = (key: string): ControlId => fixtureControl(RIG, key);

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

async function ikRig(): Promise<Rig> {
  const { snapshot, skeleton } = await fixtures();
  const app = createFakeIkEditorApp({ snapshot: withLimbIkRecords(snapshot), skeleton });
  registerBuiltinOperators(app);
  rig = await createRig({ app: app as FakeEditorApp });
  rig.layout('single');
  rig.frame();
  return rig;
}

function select(r: Rig, keys: readonly string[], channels: readonly [string, `@${string}` | 'rz' | 'rx'][] = []): void {
  r.app.session.setState({
    selection: {
      ...r.app.session.getState().selection,
      controls: keys.map(c),
      channels: channels.map(([key, channel]) => ({ control: c(key), channel })),
    },
  });
}

function setOverride(r: Rig, key: string, channel: string, value: number): void {
  const overrides = new Map(r.app.session.getState().overrides);
  overrides.set(c(key), { ...overrides.get(c(key)), [channel]: value });
  r.app.session.setState({ overrides });
}

describe('controls drawn by the visibility rule (§5.5)', () => {
  it('IK legs hide their FK chains, FK arms their IK controls and poles; toes and fingers stay', async () => {
    const r = await ikRig();
    const state = (key: string) => r.vm.controlDrawState(c(key));
    expect(state('fk.upperLeg.L')).toBe('hidden');
    expect(state('fk.foot.R')).toBe('hidden');
    expect(state('fk.toes.L')).toBe('visible');
    expect(state('ik.leg.L')).toBe('visible');
    expect(state('pole.leg.L')).toBe('visible');
    expect(state('ik.arm.L')).toBe('hidden');
    expect(state('pole.arm.R')).toBe('hidden');
    expect(state('fk.upperArm.L')).toBe('visible');
    expect(state('fk.indexProximal.L')).toBe('visible');
    expect(r.vm.controlScreenPoint('pane-single', c('fk.upperLeg.L'))).toBeNull();
    expect(r.vm.controlScreenPoint('pane-single', c('ik.leg.L'))).not.toBeNull();
  });

  it('an animated or overridden ikFk switches the drawn set at the next evaluation', async () => {
    const r = await ikRig();
    setOverride(r, 'ik.leg.L', '@ikFk', 0);
    r.frame();
    expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('visible');
    expect(r.vm.controlDrawState(c('ik.leg.L'))).toBe('hidden');
    setOverride(r, 'ik.leg.L', '@ikFk', 0.5);
    r.frame();
    expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('visible');
    expect(r.vm.controlDrawState(c('ik.leg.L'))).toBe('visible');
  });

  it('per evaluated frame the rule re-runs only when a limb crosses a threshold (playback, §5.5 rule 5)', async () => {
    const r = await ikRig();
    // ikFk of the left leg keyed 1 at 0 and 0 at 10 and 20 (stepped; the wave clip loops, so the curve cycles):
    // IK on 0…9, FK on 10…20.
    for (const [frame, value] of [
      [0, 1],
      [10, 0],
      [20, 0],
    ] as const) {
      r.app.session.setState({ time: { ...r.app.session.getState().time, sceneFrame: frame } });
      const result = await r.app.runUntyped('channel.setValues', {
        edits: [{ control: c('ik.leg.L'), channel: '@ikFk', value }],
        key: 'force',
      });
      expect(result.status).toBe('finished');
    }
    const at = (frame: number) => {
      r.app.session.setState({ time: { ...r.app.session.getState().time, sceneFrame: frame } });
      r.frame();
    };
    at(0);
    const spy = vi.spyOn(ControlLayer.prototype, 'updateVisibility');
    try {
      for (let frame = 1; frame <= 9; frame++) at(frame);
      // Nine evaluated poses, no limb crossed 0.001 or 0.999: the visible set is not recomputed.
      expect(spy).not.toHaveBeenCalled();
      expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('hidden');
      at(10);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('visible');
      expect(r.vm.controlDrawState(c('ik.leg.L'))).toBe('hidden');
      for (let frame = 11; frame <= 15; frame++) at(frame);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a selected control the rule hides is a ghost: drawn, never pickable, not marquee-selected', async () => {
    const r = await ikRig();
    // While FK (override 0) the FK thigh is pickable: remember where.
    setOverride(r, 'ik.leg.L', '@ikFk', 0);
    r.frame();
    const at = r.vm.controlScreenPoint('pane-single', c('fk.upperLeg.L'));
    expect(at).not.toBeNull();
    select(r, ['fk.upperLeg.L']);
    r.app.session.setState({ overrides: new Map() });
    r.frame();
    expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('ghost');
    expect(r.app.session.getState().selection.controls).toEqual([c('fk.upperLeg.L')]);
    const picks = r.vm.pickCandidates('pane-single', at?.x ?? 0, at?.y ?? 0);
    expect(picks.some((hit) => hit.kind === 'control' && hit.control === c('fk.upperLeg.L'))).toBe(false);
    const everything = r.vm.marquee('pane-single', { x0: 0, y0: 0, x1: 1200, y1: 600 });
    expect(everything).not.toContain(c('fk.upperLeg.L'));
    expect(everything).not.toContain(c('ik.arm.L'));
    expect(everything).toContain(c('ik.leg.L'));
    // Deselected, the ghost is hidden.
    select(r, []);
    r.frame();
    expect(r.vm.controlDrawState(c('fk.upperLeg.L'))).toBe('hidden');
  });
});

describe('pole annotation lines (§5.5 rule 4)', () => {
  it('a visible pole draws a line from the limb mid bone to the pole control; hidden poles draw none', async () => {
    const r = await ikRig();
    const lines = r.vm.poleLines(CHARACTER);
    expect(lines.map((line) => line.pole).sort()).toEqual([c('pole.leg.L'), c('pole.leg.R')].sort());
    const runtime = r.app.characters.get(CHARACTER);
    const skeleton = runtime?.skeleton;
    const knee = skeleton?.humanoid?.leftLowerLeg as number;
    const pose = runtime?.pose;
    const line = lines.find((entry) => entry.pole === c('pole.leg.L'));
    expect(line?.from[0]).toBeCloseTo(pose?.boneWorld[knee * 16 + 12] ?? Number.NaN, 5);
    expect(line?.from[1]).toBeCloseTo(pose?.boneWorld[knee * 16 + 13] ?? Number.NaN, 5);
    const slot = runtime?.program.controlIndex.get(c('pole.leg.L')) as number;
    expect(line?.to[1]).toBeCloseTo(pose?.controlWorld[slot * 16 + 13] ?? Number.NaN, 5);
    // The arm poles show once the arm is IK.
    setOverride(r, 'ik.arm.L', '@ikFk', 1);
    r.frame();
    expect(r.vm.poleLines(CHARACTER).map((entry) => entry.pole)).toContain(c('pole.arm.L'));
  });
});

/** A pointer event with a movement, as the browser reports it under capture or lock. */
function move(element: HTMLElement, movementX: number, init?: PointerEventInit): void {
  element.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 4,
      button: -1,
      movementX,
      ...init,
    }),
  );
}

describe('virtual slider through a plain MMB drag in a pane (§5.18)', () => {
  it('with Channel Box channels selected: 40 px right = +20°, one history step, no other channel changes', async () => {
    const r = await ikRig();
    r.vm.setPointerLockAllowed(false);
    select(r, ['fk.lowerArm.L'], [['fk.lowerArm.L', 'rz']]);
    const pane = r.panes.get('pane-single') as HTMLElement;
    const before = { ...r.app.evaluation.channelValues(c('fk.lowerArm.L')) };
    pointer(pane, 'pointerdown', 300, 300, { button: 1 });
    expect(r.vm.virtualSliderActive).toBe(true);
    for (let i = 0; i < 4; i++) move(pane, 10);
    pointer(pane, 'pointerup', 340, 300, { button: 1 });
    expect(r.vm.virtualSliderActive).toBe(false);
    const after = r.app.evaluation.channelValues(c('fk.lowerArm.L'));
    expect(after.rz - before.rz).toBeCloseTo(20 * DEG2RAD, 9);
    expect(after.rx).toBe(before.rx);
    expect(after.ry).toBe(before.ry);
    expect(r.app.history.peekUndo()?.label).toBe('Drag Rotate Z');
    expect((await r.app.runUntyped('edit.undo')).status).toBe('finished');
    expect(r.app.evaluation.channelValues(c('fk.lowerArm.L')).rz).toBe(before.rz);
    expect(r.app.history.canUndo()).toBe(false);
  });

  it('without selected channels, or with the preference off, a plain MMB drag does nothing; Alt+MMB navigates', async () => {
    const r = await ikRig();
    r.vm.setPointerLockAllowed(false);
    const pane = r.panes.get('pane-single') as HTMLElement;
    select(r, ['fk.lowerArm.L']);
    pointer(pane, 'pointerdown', 300, 300, { button: 1 });
    expect(r.vm.virtualSliderActive).toBe(false);
    move(pane, 30);
    pointer(pane, 'pointerup', 330, 300, { button: 1 });
    expect(r.app.history.canUndo()).toBe(false);
    select(r, ['fk.lowerArm.L'], [['fk.lowerArm.L', 'rz']]);
    r.app.prefs.setState({ virtualSlider: { ...r.app.prefs.getState().virtualSlider, viewportMmb: false } });
    pointer(pane, 'pointerdown', 300, 300, { button: 1 });
    expect(r.vm.virtualSliderActive).toBe(false);
    pointer(pane, 'pointerup', 300, 300, { button: 1 });
    r.app.prefs.setState({ virtualSlider: { ...r.app.prefs.getState().virtualSlider, viewportMmb: true } });
    const camera = r.vm.camera('pane-single');
    pointer(pane, 'pointerdown', 300, 300, { button: 1, altKey: true });
    expect(r.vm.virtualSliderActive).toBe(false);
    pointer(pane, 'pointermove', 340, 320, { button: 1, buttons: 4, altKey: true });
    pointer(pane, 'pointerup', 340, 320, { button: 1, altKey: true });
    expect(r.vm.camera('pane-single').position).not.toEqual(camera.position);
    expect(r.app.history.canUndo()).toBe(false);
  });

  it('Shift ×0.1 and Mod ×10 per move; Esc under pointer capture cancels', async () => {
    const r = await ikRig();
    r.vm.setPointerLockAllowed(false);
    select(r, ['fk.hand.L'], [['fk.hand.L', 'rz']]);
    const pane = r.panes.get('pane-single') as HTMLElement;
    pointer(pane, 'pointerdown', 300, 300, { button: 1 });
    move(pane, 40, { shiftKey: true });
    r.app.flushScheduled();
    expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBeCloseTo(2 * DEG2RAD, 9);
    move(pane, 1, { ctrlKey: true });
    r.app.flushScheduled();
    expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBeCloseTo(7 * DEG2RAD, 9);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    expect(r.vm.virtualSliderActive).toBe(false);
    expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBe(0);
    expect(r.app.history.canUndo()).toBe(false);
  });
});

describe('startVirtualSliderDrag: Pointer Lock rules (§5.18)', () => {
  /** A target whose `requestPointerLock` is scripted, with a controllable `document.pointerLockElement`. */
  function lockable(behaviour: 'grant' | 'reject' | 'error') {
    const element = document.createElement('div');
    document.body.append(element);
    let locked: Element | null = null;
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    let requests = 0;
    element.requestPointerLock = () => {
      requests++;
      if (behaviour === 'grant') {
        locked = element;
        document.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      }
      if (behaviour === 'error') {
        document.dispatchEvent(new Event('pointerlockerror'));
        return Promise.resolve();
      }
      return Promise.reject(new DOMException('The user has exited the lock before this request was completed.'));
    };
    document.exitPointerLock = () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    return {
      element,
      requests: () => requests,
      unlock: () => {
        locked = null;
        document.dispatchEvent(new Event('pointerlockchange'));
      },
      restore: () => {
        element.remove();
        delete (document as { pointerLockElement?: unknown }).pointerLockElement;
        if (original !== undefined) Object.defineProperty(Document.prototype, 'pointerLockElement', original);
      },
    };
  }
  const press = () => new PointerEvent('pointerdown', { button: 1, buttons: 4, pointerId: 1, pointerType: 'mouse' });

  it('locks when granted; leaving the lock during the gesture cancels it and restores the values', async () => {
    const r = await ikRig();
    const lock = lockable('grant');
    try {
      const refs = [{ control: c('fk.hand.L'), channel: 'rz' as const }];
      const drag = startVirtualSliderDrag(r.app, refs, lock.element, press());
      expect(lock.requests()).toBe(1);
      expect(drag?.mode).toBe('lock');
      move(lock.element, 20);
      r.app.flushScheduled();
      expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBeCloseTo(10 * DEG2RAD, 9);
      lock.unlock(); // Chrome's Esc under Pointer Lock
      expect(drag?.active).toBe(false);
      expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBe(0);
      expect(r.app.history.canUndo()).toBe(false);
    } finally {
      lock.restore();
    }
  });

  it('a granted lock commits on release (one step) and exits the lock', async () => {
    const r = await ikRig();
    const lock = lockable('grant');
    try {
      const refs = [{ control: c('ik.leg.L'), channel: '@roll' as const }];
      const drag = startVirtualSliderDrag(r.app, refs, lock.element, press());
      move(lock.element, 30);
      lock.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 1 }));
      expect(drag?.active).toBe(false);
      expect(document.pointerLockElement).toBeNull();
      expect(r.app.evaluation.channelValue(c('ik.leg.L'), '@roll')).toBeCloseTo(15 * DEG2RAD, 9);
      expect(r.app.history.peekUndo()?.label).toBe('Drag Roll');
    } finally {
      lock.restore();
    }
  });

  it('a rejected requestPointerLock() or a pointerlockerror falls back to pointer capture for the gesture', async () => {
    const r = await ikRig();
    for (const behaviour of ['reject', 'error'] as const) {
      const lock = lockable(behaviour);
      try {
        const refs = [{ control: c('fk.hand.L'), channel: 'rz' as const }];
        const drag = startVirtualSliderDrag(r.app, refs, lock.element, press());
        await Promise.resolve();
        await Promise.resolve();
        expect(drag?.mode).toBe('capture');
        move(lock.element, 10);
        lock.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 1 }));
        expect(drag?.active).toBe(false);
      } finally {
        lock.restore();
      }
    }
    expect(r.app.evaluation.channelValues(c('fk.hand.L')).rz).toBeCloseTo(10 * DEG2RAD, 9);
    expect(r.app.history.peekUndo()?.label).toBe('Drag Rotate Z');
  });

  it('starts nothing when no requested channel can be edited', async () => {
    const r = await ikRig();
    const element = document.createElement('div');
    expect(
      startVirtualSliderDrag(r.app, [{ control: c('fk.lowerArm.L'), channel: '@nope' }], element, press()),
    ).toBeNull();
  });
});
