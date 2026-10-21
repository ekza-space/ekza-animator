// M6A-SPEC §5.18 (B9): the generic marking menu — trigger matching (button, modifiers, held key, workspace, mode,
// over a mesh or empty space), the flick, press-drag-release and click-release gestures, key-triggered menus (tap
// leaves it open, hold-move-release runs), disabled items with their reasons, Esc, the drawn component, and the lazy
// controller (a press in Animate loads nothing).
import type { MarkingMenuDef, OperatorDef, OperatorResult, RunContext } from '@ekza-studio/editor-core';
import { registerBuiltinWorkspaces } from '@ekza-studio/editor-core';
import { createFakeEditorApp, type FakeEditorApp } from '@ekza-studio/editor-core/testing';
import type { PanePointerPress } from '@ekza-studio/viewport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMarkingMenus,
  MARKING_MENU_LOAD_FAILED,
  MarkingMenuHost,
  marksMenus,
  prefetchMarkingMenu,
} from '../src/overlays/MarkingMenu';
import { userEvent } from 'vitest/browser';
import {
  COMPASS,
  createMarkingMenuController,
  EDGE_MARGIN,
  FLICK_MS,
  type MarkingMenuController,
  MM_RADIUS,
  menuLabel,
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

/** Every compass slot filled (Ctrl+RMB, anywhere): each slot runs `test.mode` with its own name. */
const FULL: MarkingMenuDef = {
  id: 'model.full',
  trigger: { button: 'rmb', mods: 'ctrl' },
  workspaces: ['model'],
  when: { over: 'any' },
  slots: Object.fromEntries(COMPASS.map((slot) => [slot, { label: slot, op: 'test.mode', args: { mode: slot } }])),
  list: [{ label: 'Listed', op: 'test.mode', args: { mode: 'list' } }],
};
const FULL_KEY: MarkingMenuDef = { ...FULL, id: 'model.fullKey', trigger: { key: 'KeyM' } };
const SLOT_DEG: Record<string, number> = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };

/** The page offset of `distance` px towards a slot (y down). */
function toward(slot: string, distance: number): { dx: number; dy: number } {
  const angle = ((SLOT_DEG[slot] ?? 0) * Math.PI) / 180;
  return { dx: Math.cos(angle) * distance, dy: -Math.sin(angle) * distance };
}

/** Press points within EDGE_MARGIN of each window edge and corner (the drawing moves inwards there). */
function edgePoints(): { name: string; x: number; y: number }[] {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return [
    { name: 'left', x: 10, y: h / 2 },
    { name: 'right', x: w - 10, y: h / 2 },
    { name: 'top', x: w / 2, y: 10 },
    { name: 'bottom', x: w / 2, y: h - 10 },
    { name: 'top-left', x: 30, y: 30 },
    { name: 'top-right', x: w - 30, y: 40 },
    { name: 'bottom-left', x: 100, y: h - 60 },
    { name: 'bottom-right', x: w - 2, y: h - 2 },
  ];
}

describe('near the window edges (directions from the press point)', () => {
  it('the test window is large enough for the drawing to move inwards', () => {
    expect(window.innerWidth).toBeGreaterThan(2 * EDGE_MARGIN);
    expect(window.innerHeight).toBeGreaterThan(2 * EDGE_MARGIN);
  });

  it('a flick towards each slot runs that slot from a press near every edge and corner', () => {
    const { controller, timers, runs } = rig([FULL]);
    for (const at of edgePoints()) {
      for (const slot of COMPASS) {
        runs.length = 0;
        const opened = controller.handlePress(press({ clientX: at.x, clientY: at.y, ctrl: true }));
        expect([at.name, opened]).toEqual([at.name, true]);
        const open = controller.state.getState().open;
        // The drawing moved inwards: the press point is not the drawn centre.
        expect([at.name, open !== null && (open.x !== at.x || open.y !== at.y)]).toEqual([at.name, true]);
        expect(open?.visible).toBe(false);
        const half = toward(slot, 20);
        const full = toward(slot, 40);
        timers.advance(60);
        pointerAt('pointermove', at.x + half.dx, at.y + half.dy);
        timers.advance(60);
        pointerAt('pointerup', at.x + full.dx, at.y + full.dy);
        expect(
          runs.map((r) => r.args),
          `${at.name}: flick ${slot}`,
        ).toEqual([{ mode: slot }]);
        expect(controller.state.getState().open).toBeNull();
      }
    }
  });

  it('press-drag-release on the drawn menu runs the slot in the direction moved, highlighted while moving', () => {
    const { controller, timers, runs } = rig([FULL]);
    for (const at of edgePoints()) {
      for (const slot of COMPASS) {
        runs.length = 0;
        controller.handlePress(press({ clientX: at.x, clientY: at.y, ctrl: true }));
        timers.advance(FLICK_MS);
        expect(controller.state.getState().open?.visible).toBe(true);
        const v = toward(slot, 60);
        pointerAt('pointermove', at.x + v.dx, at.y + v.dy);
        expect(controller.state.getState().open?.hover, `${at.name}: hover ${slot}`).toEqual({ kind: 'slot', slot });
        pointerAt('pointerup', at.x + v.dx, at.y + v.dy);
        expect(
          runs.map((r) => r.args),
          `${at.name}: drag ${slot}`,
        ).toEqual([{ mode: slot }]);
      }
    }
  });

  it('a held key near a corner: move and release runs the slot in that direction', () => {
    const { controller, runs } = rig([FULL, FULL_KEY]);
    const corner = { x: window.innerWidth - 4, y: window.innerHeight - 4 };
    for (const slot of COMPASS) {
      runs.length = 0;
      pointerAt('pointermove', corner.x, corner.y);
      key('keydown', 'KeyM');
      controller.openByCommand(FULL_KEY, { panel: 'viewport', paneId: 'pane-persp', source: 'keyboard' });
      expect(controller.state.getState().open).toMatchObject({ via: 'key' });
      const v = toward(slot, 40);
      pointerAt('pointermove', corner.x + v.dx, corner.y + v.dy);
      key('keyup', 'KeyM');
      expect(
        runs.map((r) => r.args),
        `key ${slot}`,
      ).toEqual([{ mode: slot }]);
    }
  });

  it('a drawn item under the pointer wins over the direction; leaving it goes back to the direction', () => {
    const { controller, timers, runs } = rig([FULL]);
    const at = { x: window.innerWidth / 2, y: window.innerHeight - 10 };
    controller.handlePress(press({ clientX: at.x, clientY: at.y, ctrl: true }));
    timers.advance(FLICK_MS);
    const open = controller.state.getState().open;
    if (open === null) throw new Error('no menu');
    expect(open.y).toBe(window.innerHeight - EDGE_MARGIN);
    // The drawn E item sits up and to the right of the press point (NE from there): over it, it is E.
    const east = slotPosition(open.x, open.y, 'E');
    expect(slotToward(east.x - at.x, east.y - at.y)).toBe('NE');
    controller.hover({ kind: 'slot', slot: 'E' }); // the view's pointerenter
    pointerAt('pointermove', east.x, east.y);
    expect(controller.state.getState().open?.hover).toEqual({ kind: 'slot', slot: 'E' });
    controller.hover(null); // pointerleave
    pointerAt('pointermove', east.x + 4, east.y);
    expect(controller.state.getState().open?.hover).toEqual({ kind: 'slot', slot: 'NE' });
    controller.hover({ kind: 'slot', slot: 'E' });
    pointerAt('pointerup', east.x, east.y);
    expect(runs.map((r) => r.args)).toEqual([{ mode: 'E' }]);
  });

  it('a click-release near an edge leaves the drawn menu open; then directions are read from the drawn centre', () => {
    const { controller, runs } = rig([FULL]);
    const at = { x: 12, y: 12 };
    controller.handlePress(press({ clientX: at.x, clientY: at.y, ctrl: true }));
    pointerAt('pointerup', at.x + 2, at.y + 1);
    const open = controller.state.getState().open;
    expect(open).toMatchObject({ visible: true, sticky: true, x: EDGE_MARGIN, y: EDGE_MARGIN });
    const south = slotPosition(EDGE_MARGIN, EDGE_MARGIN, 'S');
    pointerAt('pointermove', south.x, south.y);
    expect(controller.state.getState().open?.hover).toEqual({ kind: 'slot', slot: 'S' });
    controller.activate({ kind: 'slot', slot: 'S' });
    expect(runs.map((r) => r.args)).toEqual([{ mode: 'S' }]);
  });

  it('with the real pointer: the drawn slot under it runs on release, near the bottom edge', async () => {
    const { app } = rig([FULL]);
    const runs: unknown[] = [];
    const menus = createMarkingMenus({
      app,
      run: (_op, args) => {
        runs.push(args);
        return Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);
      },
      help: () => {},
    });
    await menus.load();
    const view = await render(<MarkingMenuHost menus={menus} />);
    try {
      const at = { x: window.innerWidth / 2, y: window.innerHeight - 10 };
      await update(() => menus.handlePress(press({ clientX: at.x, clientY: at.y, ctrl: true })));
      await waitFor(() => document.querySelector('[data-testid="mm-model.full"]') !== null);
      const east = byTestId(document.body, 'mm-slot-E');
      await userEvent.hover(east);
      await waitFor(() => east.dataset['hover'] === 'true');
      expect(menus.state.getState().open?.hover).toEqual({ kind: 'slot', slot: 'E' });
      const rect = east.getBoundingClientRect();
      await update(() => pointerAt('pointerup', rect.x + rect.width / 2, rect.y + rect.height / 2));
      expect(runs).toEqual([{ mode: 'E' }]);
      expect(menus.state.getState().open).toBeNull();
    } finally {
      await view.unmount();
      menus.dispose();
    }
  });

  it('names the menu for screen readers from its id', () => {
    expect(menuLabel('model.modes')).toBe('Modes menu');
    expect(menuLabel('model.tools.face')).toBe('Tools Face menu');
    expect(menuLabel('e2e.fixture')).toBe('Fixture menu');
  });
});

describe('the drawn menu (§8.10 mm-<menuId>, mm-slot-<N…NW>, mm-item-<n>)', () => {
  it('draws the slots and the list with disabled reasons; a click runs the slot', async () => {
    const { app, runs } = rig();
    // The shell's facade: the controller loads lazily, then drives the facade's store.
    const menus = createMarkingMenus({
      app,
      run: (op, args, ctx) => {
        runs.push({ op, args, ctx });
        return Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);
      },
      help: () => {},
    });
    expect(menus.handlePress(press())).toBe(false); // not loaded yet: the press goes on, the load starts
    const controller = await menus.load();
    expect(menus.controller()).toBe(controller);
    const view = await render(<MarkingMenuHost menus={menus} />);
    await update(() => menus.handlePress(press({ clientX: 500, clientY: 400 })));
    expect(document.querySelector('[data-testid="mm-model.modes"]')).toBeNull(); // not drawn during the flick window
    await update(() => pointerAt('pointerup', 500, 400));
    await waitFor(() => document.querySelector('[data-testid="mm-model.modes"]') !== null);
    const menu = byTestId(document.body, 'mm-model.modes');
    expect(menu.getAttribute('role')).toBe('menu');
    // Screen readers hear a name, not the internal id.
    expect(menu.getAttribute('aria-label')).toBe('Modes menu');
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
    menus.dispose();
  });
});

describe('lazy loading (M6A-B9-16)', () => {
  const runNothing = () => Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);

  it('a press in Animate starts no load; in Model, or in a workspace a registered menu lists, it does', async () => {
    const app = createFakeEditorApp();
    registerBuiltinWorkspaces(app);
    app.contribute({ kind: 'markingMenu', def: MODES });
    app.session.setState({ workspace: 'animate' });
    expect(marksMenus(app)).toBe(false);
    const animate = createMarkingMenus({ app, run: runNothing, help: () => {} });
    expect(animate.handlePress(press())).toBe(false);
    expect(animate.handlePress(press({ button: 0 }))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(animate.controller()).toBeNull();

    app.session.setState({ workspace: 'model' });
    expect(marksMenus(app)).toBe(true);
    expect(animate.handlePress(press())).toBe(false); // the first press in Model starts the load
    await waitFor(() => animate.controller() !== null);
    animate.dispose();

    app.session.setState({ workspace: 'animate' });
    app.contribute({ kind: 'markingMenu', def: { ...PRIMITIVES, id: 'animate.fixture', workspaces: ['animate'] } });
    expect(marksMenus(app)).toBe(true);
    const listed = createMarkingMenus({ app, run: runNothing, help: () => {} });
    expect(listed.handlePress(press())).toBe(false);
    await waitFor(() => listed.controller() !== null);
    listed.dispose();
  });
});

describe('a failed load (offline after a redeploy)', () => {
  const runNothing = () => Promise.resolve({ status: 'finished', value: undefined } as OperatorResult<unknown>);

  it('a right-button press or a command says so, other presses and the prefetch stay quiet; the next try loads', async () => {
    const app = createFakeEditorApp();
    registerBuiltinWorkspaces(app);
    app.contribute({ kind: 'markingMenu', def: MODES });
    app.session.setState({ workspace: 'model' });
    const helps: { text: string; tone: string | undefined }[] = [];
    let online = false;
    let imports = 0;
    const menus = createMarkingMenus({
      app,
      run: runNothing,
      help: (text, tone) => void helps.push({ text, tone }),
      importChunks: () => {
        imports += 1;
        if (!online) return Promise.reject(new TypeError('Failed to fetch dynamically imported module'));
        return Promise.all([
          import('../src/overlays/MarkingMenu/controller'),
          import('../src/overlays/MarkingMenu/MarkingMenuView'),
        ]).then(([controller, view]) => ({ controller, view }));
      },
    });
    const unhandled: unknown[] = [];
    const listener = (e: PromiseRejectionEvent): void => {
      unhandled.push(e.reason);
      e.preventDefault();
    };
    window.addEventListener('unhandledrejection', listener);
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 30));
    try {
      expect(menus.handlePress(press({ button: 0 }))).toBe(false);
      prefetchMarkingMenu(menus);
      await quiet();
      expect(helps).toEqual([]);
      expect(menus.handlePress(press())).toBe(false);
      await waitFor(() => helps.length === 1);
      menus.openByCommand(MODES, {});
      await waitFor(() => helps.length === 2);
      expect(helps).toEqual([
        { text: MARKING_MENU_LOAD_FAILED, tone: 'error' },
        { text: MARKING_MENU_LOAD_FAILED, tone: 'error' },
      ]);
      expect(menus.controller()).toBeNull();
      online = true;
      expect(menus.handlePress(press())).toBe(false);
      await waitFor(() => menus.controller() !== null);
      await quiet();
    } finally {
      window.removeEventListener('unhandledrejection', listener);
      menus.dispose();
    }
    expect(unhandled).toEqual([]);
    expect(imports).toBe(4); // the prefetch joined the first load
    expect(helps).toHaveLength(2);
  });
});
