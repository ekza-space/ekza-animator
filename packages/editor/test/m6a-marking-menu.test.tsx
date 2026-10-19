// M6A-SPEC §5.18 (B9): the generic marking menu — trigger matching (button, modifiers, held key, workspace, mode,
// over a mesh or empty space), the flick, press-drag-release and click-release gestures, key-triggered menus (tap
// leaves it open, hold-move-release runs), disabled items with their reasons, Esc, and the drawn component.
import type { MarkingMenuDef, OperatorDef, OperatorResult, RunContext } from '@ekza-animator/editor-core';
import { registerBuiltinWorkspaces } from '@ekza-animator/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-animator/editor-core/testing';
import type { PanePointerPress } from '@ekza-animator/viewport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkingMenuHost } from '../src/overlays/MarkingMenu';
import {
  createMarkingMenuController,
  FLICK_MS,
  type MarkingMenuController,
  MM_RADIUS,
  slotPosition,
  slotToward,
} from '../src/overlays/MarkingMenu/controller';
import { byTestId, render, update } from './render';
import { waitFor } from './shell-helpers';

/** A manual clock and timer queue (the flick window). */
function fakeTimers() {
  let now = 0;
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    now: () => now,
    set(fn: () => void, ms: number) {
      const id = next++;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    clear(handle: unknown) {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...queue].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) continue;
        queue.splice(queue.indexOf(timer), 1);
        timer.fn();
      }
    },
  };
}

const MODES: MarkingMenuDef = {
  id: 'model.modes',
  trigger: { button: 'rmb', mods: 'none' },
  workspaces: ['model'],
  when: { over: 'mesh' },
  slots: {
    N: { label: 'Edge', op: 'test.mode', args: { mode: 'edge' } },
    W: { label: 'Vertex', op: 'test.mode', args: { mode: 'vertex' } },
    S: { label: 'Face', op: 'test.mode', args: { mode: 'face' } },
    E: { label: 'UV', disabledReason: 'UV editor arrives later' },
    SE: { label: 'Select', submenu: [{ label: 'All', op: 'test.mode', args: { mode: 'all' } }] },
  },
  list: [
    { label: 'Hide Selected', op: 'test.mode', args: { mode: 'hide' } },
    { label: 'Locked', op: 'test.never' },
  ],
};
const PRIMITIVES: MarkingMenuDef = {
  id: 'model.primitives',
  trigger: { button: 'rmb', mods: 'shift' },
  workspaces: ['model'],
  when: { over: 'empty' },
  slots: { N: { label: 'Cube', op: 'test.mode', args: { mode: 'cube' } } },
  list: [],
};
const TOOLS_FACE: MarkingMenuDef = {
  id: 'model.tools.face',
  trigger: { button: 'rmb', mods: 'shift' },
  workspaces: ['model'],
  when: { modes: ['face'], over: 'any' },
  slots: { S: { label: 'Extrude', op: 'test.mode', args: { mode: 'extrude' } } },
  list: [],
};
const OPTIONS: MarkingMenuDef = {
  id: 'model.options',
  trigger: { button: 'lmb', mods: 'none', holdKey: 'KeyQ' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: { N: { label: 'Symmetry: Object X', op: 'test.mode', args: { mode: 'sym' } } },
  list: [],
};
const MERGE: MarkingMenuDef = {
  id: 'model.merge',
  trigger: { key: 'KeyM' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: {
    N: { label: 'Merge to Center', op: 'test.mode', args: { mode: 'center' } },
    E: { label: 'Target Weld', op: 'test.mode', args: { mode: 'weld' } },
  },
  list: [],
};

interface Rig {
  readonly app: FakeEditorApp;
  readonly controller: MarkingMenuController;
  readonly timers: ReturnType<typeof fakeTimers>;
  readonly runs: { op: string; args: unknown; ctx: RunContext }[];
  readonly help: ReturnType<typeof vi.fn<(text: string, tone?: 'info' | 'warning' | 'error') => void>>;
}

let current: Rig | null = null;
afterEach(() => {
  current?.controller.dispose();
  current = null;
});

function rig(defs: readonly MarkingMenuDef[] = [MODES, PRIMITIVES, TOOLS_FACE, OPTIONS, MERGE]): Rig {
  const app = createFakeEditorApp();
  registerBuiltinWorkspaces(app);
  const op: OperatorDef<{ mode?: string } | undefined> = {
    id: 'test.mode',
    label: 'Test Mode',
    category: 'test',
    scope: 'global',
    apply() {},
  };
  const never: OperatorDef = {
    id: 'test.never',
    label: 'Never',
    category: 'test',
    scope: 'global',
    poll: () => ({ ok: false, reason: 'Select faces first' }),
    apply() {},
  };
  app.contribute({ kind: 'operator', def: op });
  app.contribute({ kind: 'operator', def: never });
  for (const def of defs) app.contribute({ kind: 'markingMenu', def });
  app.session.setState({ workspace: 'model' });
  const timers = fakeTimers();
  const runs: Rig['runs'] = [];
  const help = vi.fn<(text: string, tone?: 'info' | 'warning' | 'error') => void>();
  const controller = createMarkingMenuController({
    app,
    run: (opId, args, ctx) => {
      runs.push({ op: opId, args, ctx });
      return Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);
    },
    help,
    timers,
    now: timers.now,
  });
  current = { app, controller, timers, runs, help };
  return current;
}

function press(
  fields: Partial<Omit<PanePointerPress, 'overMesh'>> & { readonly overMesh?: boolean } = {},
): PanePointerPress {
  const { overMesh: over = true, ...rest } = fields;
  return {
    paneId: 'pane-persp',
    x: 400,
    y: 300,
    clientX: 400,
    clientY: 300,
    button: 2,
    pointerId: 1,
    shift: false,
    ctrl: false,
    alt: false,
    mod: false,
    ...rest,
    overMesh: () => over,
  };
}

function pointerAt(type: 'pointermove' | 'pointerup' | 'pointerdown', x: number, y: number, button = 2): void {
  window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true }));
}

function key(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
}

describe('compass geometry', () => {
  it('maps directions to the eight slots beyond the 20 px dead zone; slots sit 80 px out', () => {
    expect(slotToward(0, -40)).toBe('N');
    expect(slotToward(40, -40)).toBe('NE');
    expect(slotToward(40, 0)).toBe('E');
    expect(slotToward(-30, 30)).toBe('SW');
    expect(slotToward(10, -10)).toBeNull();
    // Only filled slots count: towards an empty slot is nothing.
    expect(slotToward(40, -40, ['N', 'S'])).toBeNull();
    expect(slotPosition(100, 100, 'N')).toEqual({ x: 100, y: 100 - MM_RADIUS });
    expect(slotPosition(100, 100, 'W').x).toBeCloseTo(100 - MM_RADIUS, 9);
  });
});

describe('trigger matching (§5.18, §8.4)', () => {
  it('picks the menu by button, modifiers, workspace, mode and what is under the pointer', () => {
    const { app, controller } = rig();
    expect(controller.match(press())?.id).toBe('model.modes');
    expect(controller.match(press({ overMesh: false }))).toBeNull();
    expect(controller.match(press({ shift: true, overMesh: false }))?.id).toBe('model.primitives');
    // Shift+RMB on a mesh in object mode: nothing (primitives are for empty space); in face mode the tools menu.
    expect(controller.match(press({ shift: true }))).toBeNull();
    app.session.setState({ model: { ...app.session.getState().model, componentMode: 'face' } });
    expect(controller.match(press({ shift: true }))?.id).toBe('model.tools.face');
    // The more specific menu wins over empty space too (modes + over beats over alone).
    expect(controller.match(press({ shift: true, overMesh: false }))?.id).toBe('model.tools.face');
    // Alt+RMB is camera dolly, a plain LMB selects, Ctrl+RMB is another menu.
    expect(controller.match(press({ alt: true }))).toBeNull();
    expect(controller.match(press({ button: 0 }))).toBeNull();
    expect(controller.match(press({ ctrl: true }))).toBeNull();
    // Not in Animate.
    app.session.setState({ workspace: 'animate' });
    expect(controller.match(press())).toBeNull();
  });

  it('LMB opens a menu only while its key is held (Q + LMB → options)', () => {
    const { controller } = rig();
    expect(controller.match(press({ button: 0 }))).toBeNull();
    key('keydown', 'KeyQ');
    expect(controller.match(press({ button: 0 }))?.id).toBe('model.options');
    key('keyup', 'KeyQ');
    expect(controller.match(press({ button: 0 }))).toBeNull();
  });
});

describe('gestures (§5.18)', () => {
  it('a flick runs the slot without drawing the menu', () => {
    const { controller, timers, runs } = rig();
    expect(controller.handlePress(press())).toBe(true);
    expect(controller.state.getState().open?.visible).toBe(false);
    timers.advance(80);
    pointerAt('pointermove', 400, 260);
    timers.advance(80);
    pointerAt('pointerup', 400, 255);
    expect(runs).toEqual([
      {
        op: 'test.mode',
        args: { mode: 'edge' },
        ctx: { panel: 'viewport', paneId: 'pane-persp', source: 'marking-menu' },
      },
    ]);
    expect(controller.state.getState().open).toBeNull();
  });

  it('press-drag-release after the flick window runs what the pointer is over; drawn after 250 ms', () => {
    const { controller, timers, runs } = rig();
    controller.handlePress(press());
    timers.advance(FLICK_MS);
    expect(controller.state.getState().open?.visible).toBe(true);
    pointerAt('pointermove', 340, 300);
    expect(controller.state.getState().open?.hover).toEqual({ kind: 'slot', slot: 'W' });
    pointerAt('pointerup', 340, 300);
    expect(runs.map((r) => r.args)).toEqual([{ mode: 'vertex' }]);
  });

  it('a click-release leaves the menu open for a click; a disabled slot says why and runs nothing', () => {
    const { controller, runs, help } = rig();
    controller.handlePress(press());
    pointerAt('pointerup', 402, 301);
    const open = controller.state.getState().open;
    expect(open).toMatchObject({ visible: true, sticky: true });
    expect(open?.slots.E).toMatchObject({ enabled: false, reason: 'UV editor arrives later' });
    expect(open?.list[1]).toMatchObject({ label: 'Locked', enabled: false, reason: 'Select faces first' });
    controller.activate({ kind: 'slot', slot: 'E' });
    expect(runs).toEqual([]);
    expect(help).toHaveBeenCalledWith('UV editor arrives later', 'warning');
    expect(controller.state.getState().open).toBeNull();
  });

  it('a submenu opens in place; its items run', () => {
    const { controller, runs } = rig();
    controller.handlePress(press());
    pointerAt('pointerup', 400, 300);
    controller.activate({ kind: 'slot', slot: 'SE' });
    expect(controller.state.getState().open?.expanded?.items.map((item) => item.label)).toEqual(['All']);
    controller.activate({ kind: 'sub', index: 0 });
    expect(runs.map((r) => r.args)).toEqual([{ mode: 'all' }]);
  });

  it('Esc closes the menu; a press outside it closes it and goes nowhere else', () => {
    const { controller } = rig();
    controller.handlePress(press());
    pointerAt('pointerup', 400, 300);
    key('keydown', 'Escape');
    key('keyup', 'Escape');
    expect(controller.state.getState().open).toBeNull();
    controller.handlePress(press());
    pointerAt('pointerup', 400, 300);
    const outside = new PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    window.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    expect(controller.state.getState().open).toBeNull();
  });

  it('key-triggered (M): a tap leaves the menu open; hold, move and release runs the slot', () => {
    const { controller, runs } = rig();
    pointerAt('pointermove', 500, 400);
    key('keydown', 'KeyM');
    controller.openByCommand(MERGE, { panel: 'viewport', paneId: 'pane-persp', source: 'keyboard' });
    key('keyup', 'KeyM');
    expect(controller.state.getState().open).toMatchObject({ visible: true, sticky: true, x: 500, y: 400 });
    controller.close();

    key('keydown', 'KeyM');
    controller.openByCommand(MERGE, { panel: 'viewport', paneId: 'pane-persp', source: 'keyboard' });
    pointerAt('pointermove', 560, 400);
    key('keyup', 'KeyM');
    expect(runs.map((r) => [r.op, r.args, r.ctx.source])).toEqual([['test.mode', { mode: 'weld' }, 'marking-menu']]);
    // From a menu or the palette (not a held key) the menu opens for a click.
    controller.openByCommand(MERGE, { source: 'palette' });
    expect(controller.state.getState().open).toMatchObject({ sticky: true, via: 'command' });
  });

  it('screenOfSlot gives the page position of each filled slot', () => {
    const { controller } = rig();
    controller.handlePress(press());
    expect(controller.screenOfSlot()).toEqual({
      N: slotPosition(400, 300, 'N'),
      E: slotPosition(400, 300, 'E'),
      SE: slotPosition(400, 300, 'SE'),
      S: slotPosition(400, 300, 'S'),
      W: slotPosition(400, 300, 'W'),
    });
  });
});

describe('the drawn menu (§8.10 mm-<menuId>, mm-slot-<N…NW>, mm-item-<n>)', () => {
  it('draws the slots and the list with disabled reasons; a click runs the slot', async () => {
    const { controller, runs } = rig();
    const view = await render(<MarkingMenuHost controller={controller} />);
    await update(() => controller.handlePress(press({ clientX: 500, clientY: 400 })));
    expect(document.querySelector('[data-testid="mm-model.modes"]')).toBeNull(); // not drawn during the flick window
    await update(() => pointerAt('pointerup', 500, 400));
    await waitFor(() => document.querySelector('[data-testid="mm-model.modes"]') !== null);
    const menu = byTestId(document.body, 'mm-model.modes');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(byTestId(menu, 'mm-slot-N').textContent).toContain('Edge');
    expect(byTestId(menu, 'mm-slot-E').getAttribute('aria-disabled')).toBe('true');
    expect(byTestId(menu, 'mm-slot-E').title).toBe('UV editor arrives later');
    expect(byTestId(menu, 'mm-item-0').textContent).toContain('Hide Selected');
    expect(byTestId(menu, 'mm-item-1').getAttribute('aria-disabled')).toBe('true');
    const slot = byTestId(menu, 'mm-slot-S').getBoundingClientRect();
    expect(slot.x + slot.width / 2).toBeCloseTo(500, 0);
    expect(slot.y + slot.height / 2).toBeCloseTo(400 + MM_RADIUS, 0);
    await update(() => byTestId(menu, 'mm-slot-S').click());
    expect(runs.map((r) => r.args)).toEqual([{ mode: 'face' }]);
    expect(document.querySelector('[data-testid="mm-model.modes"]')).toBeNull();
    await view.unmount();
  });
});
