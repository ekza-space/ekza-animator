import {
  EkzaError,
  eulerToQuat,
  gimbalAxes,
  mat4Decompose,
  type Quat,
  quatAngle,
  quatFromAxisAngle,
  quatMultiply,
  quatRotateVec3,
  type Vec3,
} from '@ekza-animator/anim-core';
import type { ControlId, ControlRecord } from '@ekza-animator/doc';
import { beginChannelEditGesture, type ChannelEdit, type ChannelEditGesture } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeServices } from '@ekza-animator/editor-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_RING_RADIUS } from '../src/manipulators/ManipulatorKit';
import { type GestureFactory, moveToolDef, rotateToolDef } from '../src/tools/transformTool';
import { createRig, drag, pointer, type Rig } from './helpers';

/** The edit kernel (WP-7a) is stubbed until it lands; gesture-level tests run once it exists. */
const KERNEL = (() => {
  try {
    beginChannelEditGesture(createFakeEditorApp(), 'probe', { key: 'none' }).cancel();
    return true;
  } catch (error) {
    if (error instanceof EkzaError && error.code === 'not-implemented') return false;
    throw error;
  }
})();

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function control(r: Rig, key: string): ControlRecord {
  const record = r.app.store.list('controls').find((c) => c.key === key);
  if (record === undefined) throw new Error(`no control ${key}`);
  return record;
}

function setup(r: Rig, id: ControlId, tool: 'move' | 'rotate', space: 'object' | 'world' | 'gimbal'): void {
  const state = r.app.session.getState();
  r.app.session.setState({
    selection: { controls: [id], keys: new Map(), channels: [] },
    tools: { ...state.tools, viewport: tool },
  });
  if (tool === 'rotate') r.app.prefs.setState({ rotateSpace: space });
  else r.app.prefs.setState({ moveSpace: space === 'gimbal' ? 'object' : space });
  r.frame();
}

function setRotation(r: Rig, id: ControlId, rot: readonly [number, number, number]): void {
  r.app.session.setState({ overrides: new Map([[id, { rx: rot[0], ry: rot[1], rz: rot[2] }]]) });
  r.frame();
}

/** World rotation of a control evaluated by the (fake) rig program with the given rotation channels. */
function worldQ(r: Rig, id: ControlId, rot: readonly [number, number, number]): Quat {
  setRotation(r, id, rot);
  const runtime = r.app.characters.list()[0];
  const slot = runtime?.program.controlIndex.get(id) ?? -1;
  return mat4Decompose((runtime?.pose.controlWorld ?? new Float64Array(16)).slice(slot * 16, slot * 16 + 16)).q;
}

function values(edits: readonly ChannelEdit[]): Record<string, number> {
  return Object.fromEntries(edits.map((e) => [e.channel, e.value]));
}

describe('gimbal mode', () => {
  it('draws the rotate-order axes (outer fixed, middle by outer, inner by both) in the parent·offset frame', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L'); // yxz: inner y, middle x, outer z
    setup(rig, arm.id, 'rotate', 'gimbal');
    const qP = worldQ(rig, arm.id, [0, 0, 0]);
    for (const rot of [
      [0.3, -0.7, 0.4],
      [-1.2, 0.5, 2.1],
      [0.05, 1.4, -0.6],
    ] as const) {
      setRotation(rig, arm.id, rot);
      const axes = rig.vm.manipulatorAxes();
      const expected = gimbalAxes(rot, arm.rotateOrder).map((a) => quatRotateVec3(qP, a));
      for (let k = 0; k < 3; k++) {
        for (let i = 0; i < 3; i++) expect(axes?.[k]?.[i]).toBeCloseTo(expected[k]?.[i] ?? Number.NaN, 9);
      }
      // Turning about gimbal axis k by θ is exactly adding θ to channel k.
      const q0 = worldQ(rig, arm.id, rot);
      for (let k = 0; k < 3; k++) {
        const bumped: [number, number, number] = [rot[0], rot[1], rot[2]];
        bumped[k] = (bumped[k] ?? 0) + 0.3;
        const turned = quatMultiply(quatFromAxisAngle(axes?.[k] as Vec3, 0.3), q0);
        expect(quatAngle(turned, worldQ(rig, arm.id, bumped))).toBeLessThan(1e-9);
      }
    }
  });

  it('dragging a ring writes only that channel', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'rotate', 'gimbal');
    setRotation(rig, arm.id, [0.2, -0.4, 0.6]);
    for (const [handle, channel] of [
      ['rx', 'rx'],
      ['ry', 'ry'],
      ['rz', 'rz'],
    ] as const) {
      const p = rig.vm.manipulatorScreenPoint('pane-right', handle);
      const session = rig.vm.toolHost.beginManipulatorDrag('pane-right', handle, p?.x ?? 0, p?.y ?? 0);
      expect(session).not.toBeNull();
      const edits = session?.update((p?.x ?? 0) + 40, p?.y ?? 0) ?? [];
      expect({ handle, channels: edits.map((e) => e.channel) }).toEqual({ handle, channels: [channel] });
      const before = { rx: 0.2, ry: -0.4, rz: 0.6 }[channel];
      expect(edits[0]?.value).toBeCloseTo(before + (session?.amount ?? Number.NaN), 12);
      expect(Math.abs(session?.amount ?? 0)).toBeGreaterThan(0.05);
    }
  });

  it('marks the inner and outer rings near gimbal lock', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'rotate', 'gimbal');
    setRotation(rig, arm.id, [Math.PI / 2 - 0.05, 0, 0]); // middle axis x at 87°
    const axes = rig.vm.manipulatorAxes();
    // inner (y) and outer (z) axes are nearly parallel near lock
    const dot = Math.abs(
      (axes?.[1]?.[0] ?? 0) * (axes?.[2]?.[0] ?? 0) +
        (axes?.[1]?.[1] ?? 0) * (axes?.[2]?.[1] ?? 0) +
        (axes?.[1]?.[2] ?? 0) * (axes?.[2]?.[2] ?? 0),
    );
    expect(dot).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
  });
});

describe('rotate and translate drags', () => {
  it('a drag of N px along the view ring turns N / radius radians about the view axis (orthographic, 1e-6)', async () => {
    rig = await createRig();
    rig.layout('split', {
      camera: (id) => (id === 'pane-right' ? { kind: 'view', preset: 'front' } : { kind: 'view', preset: 'persp' }),
    });
    const arm = control(rig, 'fk.lowerArm.L');
    for (const space of ['object', 'world'] as const) {
      setup(rig, arm.id, 'rotate', space);
      const rot: [number, number, number] = [0.3, 0.2, -0.5];
      const q0 = worldQ(rig, arm.id, rot);
      const qP = quatMultiply(q0, invert(eulerToQuat(rot, arm.rotateOrder)));
      const p = rig.vm.manipulatorScreenPoint('pane-right', 'rview');
      const centre = rig.vm.project('pane-right', pivotOf(rig, arm.id));
      // Tangent of a counter-clockwise turn about +Z (towards the viewer) at the grab point, in screen px (y down).
      const vx = (p?.x ?? 0) - (centre?.x ?? 0);
      const vy = (p?.y ?? 0) - (centre?.y ?? 0);
      const len = Math.hypot(vx, vy);
      const n = 30;
      const session = rig.vm.toolHost.beginManipulatorDrag('pane-right', 'rview', p?.x ?? 0, p?.y ?? 0);
      const edits = session?.update((p?.x ?? 0) + (vy / len) * n, (p?.y ?? 0) - (vx / len) * n) ?? [];
      const radiusPx = VIEW_RING_RADIUS * rig.app.session.getState().tools.manipulatorSize;
      expect(len).toBeCloseTo(radiusPx, 6);
      expect(session?.amount).toBeCloseTo(n / radiusPx, 6);
      const v = values(edits);
      const q1 = quatMultiply(qP, eulerToQuat([v['rx'] ?? 0, v['ry'] ?? 0, v['rz'] ?? 0], arm.rotateOrder));
      const expected = quatMultiply(quatFromAxisAngle([0, 0, 1], n / radiusPx), q0);
      expect(quatAngle(q1, expected)).toBeLessThan(1e-6);
    }
  });

  it('object and world rings turn about the control axes or the world axes', async () => {
    rig = await createRig();
    rig.layout('split');
    const hand = control(rig, 'fk.hand.L');
    const rot: [number, number, number] = [0.4, -0.3, 0.8];
    for (const space of ['object', 'world'] as const) {
      setup(rig, hand.id, 'rotate', space);
      const q0 = worldQ(rig, hand.id, rot);
      const qP = quatMultiply(q0, invert(eulerToQuat(rot, hand.rotateOrder)));
      const axes = rig.vm.manipulatorAxes();
      const worldAxis = space === 'world' ? ([1, 0, 0] as Vec3) : quatRotateVec3(q0, [1, 0, 0]);
      for (let i = 0; i < 3; i++) expect(axes?.[0]?.[i]).toBeCloseTo(worldAxis[i] ?? Number.NaN, 9);
      const p = rig.vm.manipulatorScreenPoint('pane-right', 'rx');
      const session = rig.vm.toolHost.beginManipulatorDrag('pane-right', 'rx', p?.x ?? 0, p?.y ?? 0);
      const v = values(session?.update((p?.x ?? 0) + 25, (p?.y ?? 0) + 5) ?? []);
      const q1 = quatMultiply(qP, eulerToQuat([v['rx'] ?? 0, v['ry'] ?? 0, v['rz'] ?? 0], hand.rotateOrder));
      const expected = quatMultiply(quatFromAxisAngle(worldAxis, session?.amount ?? 0), q0);
      expect(quatAngle(q1, expected)).toBeLessThan(1e-9);
      expect(Math.abs(session?.amount ?? 0)).toBeGreaterThan(0.05);
    }
  });

  it('moves along a world axis by the pointer travel in an orthographic view', async () => {
    rig = await createRig();
    rig.layout('split', {
      camera: (id) => (id === 'pane-right' ? { kind: 'view', preset: 'front' } : { kind: 'view', preset: 'persp' }),
    });
    const cog = control(rig, 'cog');
    setup(rig, cog.id, 'move', 'world');
    const snapshot = rig.vm.camera('pane-right');
    const perPx = snapshot.orthoHeight / 600;
    for (const [handle, dx, dy, channel, expected] of [
      ['tx', 50, 0, 'tx', 50 * perPx],
      ['ty', 0, -40, 'ty', 40 * perPx],
    ] as const) {
      const p = rig.vm.manipulatorScreenPoint('pane-right', handle);
      const session = rig.vm.toolHost.beginManipulatorDrag('pane-right', handle, p?.x ?? 0, p?.y ?? 0);
      const v = values(session?.update((p?.x ?? 0) + dx, (p?.y ?? 0) + dy) ?? []);
      expect(v[channel]).toBeCloseTo(expected, 6);
      const others = (['tx', 'ty', 'tz'] as const).filter((other) => other !== channel);
      for (const other of others) expect(v[other] ?? 0).toBeCloseTo(0, 6);
    }
    // The view-plane centre moves in the screen plane.
    const p = rig.vm.manipulatorScreenPoint('pane-right', 'tview');
    const session = rig.vm.toolHost.beginManipulatorDrag('pane-right', 'tview', p?.x ?? 0, p?.y ?? 0);
    const v = values(session?.update((p?.x ?? 0) + 10, (p?.y ?? 0) + 20) ?? []);
    expect(v['tx']).toBeCloseTo(10 * perPx, 6);
    expect(v['ty']).toBeCloseTo(-20 * perPx, 6);
    expect(v['tz']).toBeCloseTo(0, 6);
  });

  it('dims translate handles of controls without keyable translation', async () => {
    rig = await createRig();
    rig.layout('split');
    setup(rig, control(rig, 'fk.lowerArm.L').id, 'move', 'world');
    expect(rig.vm.manipulatorScreenPoint('pane-right', 'tx')).toBeNull();
    expect(rig.vm.toolHost.beginManipulatorDrag('pane-right', 'tx', 0, 0)).toBeNull();
  });
});

describe('manipulator press routing', () => {
  it.runIf(!KERNEL)(
    'a press on a handle is the manipulator’s (no selection); without the kernel it reports why',
    async () => {
      rig = await createRig();
      rig.layout('split');
      const arm = control(rig, 'fk.upperArm.L');
      setup(rig, arm.id, 'rotate', 'object');
      const p = rig.vm.manipulatorScreenPoint('pane-right', 'rz');
      const element = rig.panes.get('pane-right') as HTMLElement;
      const rect = element.getBoundingClientRect();
      drag(
        element,
        { x: rect.left + (p?.x ?? 0), y: rect.top + (p?.y ?? 0) },
        { x: rect.left + (p?.x ?? 0) + 30, y: rect.top + (p?.y ?? 0) },
      );
      expect(rig.app.calls.filter((c) => c.id === 'select.controls')).toEqual([]);
      expect((rig.app.services as FakeServices).toasts.at(-1)).toEqual({
        kind: 'error',
        text: 'Posing is not available yet.',
      });
    },
  );

  it('a click on a handle without moving edits nothing and opens no gesture', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'rotate', 'object');
    const p = rig.vm.manipulatorScreenPoint('pane-right', 'rz');
    const element = rig.panes.get('pane-right') as HTMLElement;
    const rect = element.getBoundingClientRect();
    const at = { x: rect.left + (p?.x ?? 0), y: rect.top + (p?.y ?? 0) };
    drag(element, at, { x: at.x + 1, y: at.y }, undefined, 1);
    expect(rig.app.store.preview).toBeNull();
    expect((rig.app.services as FakeServices).toasts).toEqual([]);
    expect(rig.app.calls.filter((c) => c.id === 'select.controls')).toEqual([]);
  });

  it('a press off the manipulator selects like the select tool', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'move', 'world');
    const element = rig.panes.get('pane-right') as HTMLElement;
    const rect = element.getBoundingClientRect();
    drag(element, { x: rect.left + 5, y: rect.top + 5 }, { x: rect.left + 5, y: rect.top + 5 }, undefined, 1);
    expect(rig.app.calls.filter((c) => c.id === 'select.controls').at(-1)?.args).toEqual({ ids: [], mode: 'replace' });
  });
});

/** A ChannelEditGesture double that records the tool's calls (lifecycle only; the kernel's effects are WP-7a's). */
interface Recorder {
  readonly labels: string[];
  readonly updates: (readonly ChannelEdit[])[];
  commits: number;
  cancels: number;
  /** The live gesture (null before the first one opens). */
  gesture: ChannelEditGesture & { active: boolean };
}

async function recordingRig(): Promise<{ readonly rig: Rig; readonly rec: Recorder }> {
  const r = await createRig({ contributions: false });
  const rec = { labels: [], updates: [], commits: 0, cancels: 0 } as unknown as Recorder;
  const factory: GestureFactory = (_app, label) => {
    rec.labels.push(label);
    const gesture = {
      active: true,
      update: (edits: readonly ChannelEdit[]) => {
        if (!gesture.active) throw new Error('update after the gesture ended');
        rec.updates.push(edits);
      },
      commit: () => {
        if (!gesture.active) throw new Error('commit after the gesture ended');
        gesture.active = false;
        rec.commits++;
      },
      cancel: () => {
        gesture.active = false;
        rec.cancels++;
      },
    };
    rec.gesture = gesture;
    return gesture;
  };
  r.app.contribute({ kind: 'tool', def: rotateToolDef(factory) });
  r.app.contribute({ kind: 'tool', def: moveToolDef(factory) });
  return { rig: r, rec };
}

function handlePage(r: Rig, handle: 'rx' | 'ry' | 'rz' | 'tx'): { readonly x: number; readonly y: number } {
  const p = r.vm.manipulatorScreenPoint('pane-right', handle);
  if (p === null) throw new Error(`no ${handle} handle`);
  const rect = (r.panes.get('pane-right') as HTMLElement).getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y };
}

describe('transform tool gesture lifecycle (recording gesture)', () => {
  it('one gesture per drag: opened on movement, updated per move, committed once on release', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    r.layout('split');
    const arm = control(r, 'fk.upperArm.L');
    setup(r, arm.id, 'rotate', 'object');
    const element = r.panes.get('pane-right') as HTMLElement;
    const at = handlePage(r, 'rz');
    drag(element, at, { x: at.x + 60, y: at.y }, undefined, 4);
    expect(rec.labels).toEqual(['Rotate']);
    expect(rec.commits).toBe(1);
    expect(rec.cancels).toBe(0);
    expect(rec.updates.length).toBe(5); // 4 moves + the release position
    for (const edits of rec.updates) {
      expect(edits.map((e) => [e.control, e.channel])).toEqual([
        [arm.id, 'rx'],
        [arm.id, 'ry'],
        [arm.id, 'rz'],
      ]);
    }
    expect(r.app.calls.filter((c) => c.id === 'select.controls')).toEqual([]);

    // Move tool: the same lifecycle with translate channels.
    const cog = control(r, 'cog');
    setup(r, cog.id, 'move', 'world');
    const t = handlePage(r, 'tx');
    drag(element, t, { x: t.x + 40, y: t.y }, undefined, 2);
    expect(rec.labels).toEqual(['Rotate', 'Move']);
    expect(rec.commits).toBe(2);
    // World X under an unrotated parent: tx moves, ty and tz are sent unchanged.
    const start = r.app.evaluation.channelValues(cog.id);
    const moves = rec.updates.slice(5).map(values);
    expect(moves.length).toBe(3);
    for (const move of moves) {
      expect(Object.keys(move).sort()).toEqual(['tx', 'ty', 'tz']);
      expect(move['ty']).toBeCloseTo(start.ty, 9);
      expect(move['tz']).toBeCloseTo(start.tz, 9);
    }
    expect(Math.abs((moves.at(-1)?.['tx'] ?? 0) - start.tx)).toBeGreaterThan(1e-3);
  });

  it('gimbal drags send exactly one channel per update', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    r.layout('split');
    const arm = control(r, 'fk.upperArm.L');
    setup(r, arm.id, 'rotate', 'gimbal');
    const element = r.panes.get('pane-right') as HTMLElement;
    const at = handlePage(r, 'rx');
    drag(element, at, { x: at.x + 40, y: at.y }, undefined, 3);
    expect(rec.commits).toBe(1);
    expect(rec.updates.map((edits) => edits.map((e) => e.channel))).toEqual([['rx'], ['rx'], ['rx'], ['rx']]);
  });

  it('Escape cancels the gesture, later moves and the release do nothing', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    r.layout('split');
    const arm = control(r, 'fk.upperArm.L');
    setup(r, arm.id, 'rotate', 'object');
    const element = r.panes.get('pane-right') as HTMLElement;
    const at = handlePage(r, 'rz');
    pointer(element, 'pointerdown', at.x, at.y);
    pointer(element, 'pointermove', at.x + 20, at.y, { buttons: 1 });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    pointer(element, 'pointermove', at.x + 40, at.y, { buttons: 1 });
    pointer(element, 'pointerup', at.x + 40, at.y);
    expect([rec.updates.length, rec.commits, rec.cancels]).toEqual([1, 0, 1]);
  });

  it('a gesture ended elsewhere (edit.escape cancelled the preview) ends the drag without a commit', async () => {
    const { rig: r, rec } = await recordingRig();
    rig = r;
    r.layout('split');
    const arm = control(r, 'fk.upperArm.L');
    setup(r, arm.id, 'rotate', 'object');
    const element = r.panes.get('pane-right') as HTMLElement;
    const at = handlePage(r, 'rz');
    pointer(element, 'pointerdown', at.x, at.y);
    pointer(element, 'pointermove', at.x + 20, at.y, { buttons: 1 });
    rec.gesture.active = false; // cancelled behind the tool's back
    pointer(element, 'pointermove', at.x + 40, at.y, { buttons: 1 });
    pointer(element, 'pointerup', at.x + 40, at.y);
    expect([rec.updates.length, rec.commits]).toEqual([1, 0]);
    // The next press starts a fresh gesture.
    drag(element, at, { x: at.x + 30, y: at.y }, undefined, 2);
    expect([rec.labels.length, rec.commits]).toEqual([2, 1]);
  });
});

describe.runIf(KERNEL)('manipulator gestures (edit kernel, WP-7a)', () => {
  it('a rotate drag records exactly one history step and undo restores the pose', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'rotate', 'object');
    const before = rig.app.evaluation.channelValues(arm.id);
    const top = rig.app.history.peekUndo()?.id ?? null;
    const p = rig.vm.manipulatorScreenPoint('pane-right', 'rz');
    const element = rig.panes.get('pane-right') as HTMLElement;
    const rect = element.getBoundingClientRect();
    drag(
      element,
      { x: rect.left + (p?.x ?? 0), y: rect.top + (p?.y ?? 0) },
      { x: rect.left + (p?.x ?? 0) + 60, y: rect.top + (p?.y ?? 0) },
    );
    rig.frame();
    expect(rig.app.evaluation.channelValues(arm.id).rz).not.toBeCloseTo(before.rz, 3);
    expect(rig.app.history.peekUndo()?.id ?? null).not.toBe(top);
    rig.app.history.undo();
    rig.frame();
    expect(rig.app.history.peekUndo()?.id ?? null).toBe(top); // exactly one step
    expect(rig.app.evaluation.channelValues(arm.id)).toEqual(before);
  });

  it('Escape cancels a drag without a history step', async () => {
    rig = await createRig();
    rig.layout('split');
    const arm = control(rig, 'fk.upperArm.L');
    setup(rig, arm.id, 'rotate', 'gimbal');
    const before = rig.app.evaluation.channelValues(arm.id);
    const top = rig.app.history.peekUndo()?.id ?? null;
    const p = rig.vm.manipulatorScreenPoint('pane-right', 'rx');
    const element = rig.panes.get('pane-right') as HTMLElement;
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        button: 0,
        buttons: 1,
        clientX: rect.left + (p?.x ?? 0),
        clientY: rect.top + (p?.y ?? 0),
      }),
    );
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        buttons: 1,
        clientX: rect.left + (p?.x ?? 0) + 40,
        clientY: rect.top + (p?.y ?? 0),
      }),
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
    rig.frame();
    expect(rig.app.evaluation.channelValues(arm.id)).toEqual(before);
    expect(rig.app.history.peekUndo()?.id ?? null).toBe(top);
  });
});

/** Scene-space position of a control (placement is the identity in the wave document). */
function pivotOf(r: Rig, id: ControlId): [number, number, number] {
  const runtime = r.app.characters.list()[0];
  const slot = runtime?.program.controlIndex.get(id) ?? -1;
  const m = runtime?.pose.controlWorld ?? new Float64Array(16);
  return [m[slot * 16 + 12] ?? 0, m[slot * 16 + 13] ?? 0, m[slot * 16 + 14] ?? 0];
}

function invert(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}
