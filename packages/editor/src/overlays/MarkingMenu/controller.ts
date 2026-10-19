// The generic marking menu (M6A-SPEC §5.18, FR-SHELL-09, research 09 §7.4; B9): logic and geometry, no React. A menu
// opens at the pointer on the press of its trigger (RMB with modifiers, LMB with a held key, or a key through
// `ui.markingMenu`): eight compass slots at 80 px plus a list below. Releasing within 250 ms after moving more than
// 20 px towards a slot runs it without drawing (flick); a press-drag-release runs what the pointer is over; a
// click-release (or a tap of the key) leaves the menu open for a click. Slots never move between modes: an
// inapplicable item is drawn disabled with its reason. `Esc` closes. The menu data is the owners' (§8.4).
// Near a window edge the drawing moves inwards so every item can be clicked, but a live gesture (button or key held)
// keeps measuring its direction from where it started: a flick means the same thing anywhere in the window. A drawn
// item under the pointer wins over the direction.
import type { Disposer } from '@ekza-animator/anim-core';
import type {
  CompassSlot,
  EditorApp,
  MarkingMenuDef,
  MarkingMenuItem,
  OperatorResult,
  RunContext,
} from '@ekza-animator/editor-core';
import type { PanePointerPress } from '@ekza-animator/viewport';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { MarkingMenuEntry, MarkingMenuState, MarkingMenuTarget, OpenMarkingMenu } from './types';

/** Slot distance from the centre (CSS px). */
export const MM_RADIUS = 80;
/** A flick: released within this time after the press … */
export const FLICK_MS = 250;
/** … having moved more than this far (CSS px). Also the dead zone around the centre. */
export const FLICK_PX = 20;
export const COMPASS: readonly CompassSlot[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Direction of each slot (degrees, counter-clockwise from east, y up). */
const ANGLE: Readonly<Record<CompassSlot, number>> = { E: 0, NE: 45, N: 90, NW: 135, W: 180, SW: 225, S: 270, SE: 315 };
/** The list starts this far below the S slot (CSS px). */
export const LIST_OFFSET = 34;
/** The drawn centre stays this far inside the window so every item can be clicked. */
export const EDGE_MARGIN = MM_RADIUS + 64;

export type { MarkingMenuEntry, MarkingMenuState, MarkingMenuTarget, OpenMarkingMenu } from './types';

export interface MarkingMenuDeps {
  readonly app: EditorApp;
  readonly run: (op: string, args: unknown, ctx: RunContext) => Promise<OperatorResult<unknown>>;
  readonly help: (text: string, tone?: 'info' | 'warning' | 'error') => void;
  /** Timers (tests); default `setTimeout`. */
  readonly timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
  readonly now?: () => number;
  /** The state store to drive (the shell's eager facade owns it); default: a new one. */
  readonly state?: StoreApi<MarkingMenuState>;
}

export interface MarkingMenuController {
  readonly state: StoreApi<MarkingMenuState>;
  /** The viewport's press hook (ViewportManager.setPointerMenus): true when a menu opened. */
  handlePress(press: PanePointerPress): boolean;
  /** The menu a pointer press opens, or null (exported for tests and the test API). */
  match(press: PanePointerPress): MarkingMenuDef | null;
  /** `ui.markingMenu`: opens at the pointer; from the keyboard the triggering key acts as the button. */
  openByCommand(def: MarkingMenuDef, ctx: RunContext): void;
  /** Hover (pointer over a drawn item). */
  hover(target: MarkingMenuTarget | null): void;
  /** A click on a drawn item (sticky menus). */
  activate(target: MarkingMenuTarget): void;
  close(): void;
  /** Page position of each drawn slot of the open menu (around the drawn centre, which an edge may move). */
  screenOfSlot(): Partial<Record<CompassSlot, { x: number; y: number }>>;
  dispose(): void;
}

const titleCase = (id: string): string =>
  id
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_.\s]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** The menu's spoken name, from its id without the workspace prefix: 'model.tools.face' → 'Tools Face menu'. */
export function menuLabel(id: string): string {
  const parts = id.split('.');
  const name = titleCase((parts.length > 1 ? parts.slice(1) : parts).join(' '));
  return `${name === '' ? 'Marking' : name} menu`;
}

/** The compass slot in the direction of (dx, dy) (page px, y down), or null inside the dead zone. */
export function slotToward(dx: number, dy: number, slots: readonly CompassSlot[] = COMPASS): CompassSlot | null {
  if (Math.hypot(dx, dy) <= FLICK_PX) return null;
  const angle = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  let best: CompassSlot | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const slot of slots) {
    const raw = Math.abs(angle - ANGLE[slot]);
    const delta = Math.min(raw, 360 - raw);
    if (delta < bestDelta) {
      best = slot;
      bestDelta = delta;
    }
  }
  return bestDelta <= 22.5 ? best : null;
}

/** Page position of a slot around a centre. */
export function slotPosition(x: number, y: number, slot: CompassSlot): { x: number; y: number } {
  const angle = (ANGLE[slot] * Math.PI) / 180;
  return { x: x + Math.cos(angle) * MM_RADIUS, y: y - Math.sin(angle) * MM_RADIUS };
}

function triggerMatches(
  trigger: MarkingMenuDef['trigger'],
  press: PanePointerPress,
  held: ReadonlySet<string>,
): boolean {
  if ('key' in trigger) return false;
  const button = trigger.button === 'rmb' ? 2 : 0;
  if (press.button !== button || press.alt) return false;
  const shift = trigger.mods === 'shift' || trigger.mods === 'ctrl+shift';
  const ctrl = trigger.mods === 'ctrl' || trigger.mods === 'ctrl+shift';
  if (press.shift !== shift || press.ctrl !== ctrl) return false;
  if (trigger.holdKey !== undefined) return held.has(trigger.holdKey);
  // A plain LMB press never opens a menu without its held key (it selects).
  return button === 2;
}

export function createMarkingMenuController(deps: MarkingMenuDeps): MarkingMenuController {
  const { app } = deps;
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const now = deps.now ?? (() => performance.now());
  const state = deps.state ?? createStore<MarkingMenuState>()(() => ({ open: null }));
  const held = new Set<string>();
  let lastKey: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  /** The gesture that opened the menu: what releases it, where and when it started. */
  let gesture: {
    readonly kind: 'pointer' | 'key';
    readonly button: number;
    readonly code: string | null;
    readonly startX: number;
    readonly startY: number;
    readonly at: number;
    lastX: number;
    lastY: number;
  } | null = null;
  let showTimer: unknown = null;
  let detach: Disposer | null = null;
  /** The hover came from a drawn item under the pointer (the view reports it), not from a direction. */
  let domHover = false;

  const entryOf = (item: MarkingMenuItem, ctx: RunContext): MarkingMenuEntry => {
    const op = item.op ?? null;
    const submenu = item.submenu === undefined ? null : item.submenu.map((child) => entryOf(child, ctx));
    let reason: string | null = item.disabledReason ?? null;
    if (reason === null && op !== null) {
      const def = app.operators.get(op);
      if (def === undefined) reason = `Unknown operator '${op}'`;
      else {
        const poll = app.operators.poll(op, ctx, item.args);
        if (poll !== true) reason = poll.reason;
      }
    }
    if (reason === null && op === null && submenu !== null && !submenu.some((child) => child.enabled)) {
      reason = submenu[0]?.reason ?? 'Nothing here can run now';
    }
    let checked = false;
    try {
      checked = item.checked?.(app) === true;
    } catch {
      checked = false;
    }
    return {
      label: item.label ?? (op === null ? '…' : (app.operators.get(op)?.label ?? titleCase(op))),
      op,
      args: item.args,
      enabled: reason === null && (op !== null || submenu !== null),
      reason,
      checked,
      submenu,
    };
  };

  const update = (patch: Partial<OpenMarkingMenu>): void => {
    const open = state.getState().open;
    if (open !== null) state.setState({ open: { ...open, ...patch } });
  };

  const entryAtTarget = (open: OpenMarkingMenu, target: MarkingMenuTarget | null): MarkingMenuEntry | null => {
    if (target === null) return null;
    if (target.kind === 'slot') return open.slots[target.slot] ?? null;
    if (target.kind === 'item') return open.list[target.index] ?? null;
    return open.expanded?.items[target.index] ?? null;
  };

  /** The filled slot in the direction of (x, y) from `from`, or null inside the dead zone or between slots. */
  const slotFrom = (
    open: OpenMarkingMenu,
    from: { readonly x: number; readonly y: number },
    x: number,
    y: number,
  ): MarkingMenuTarget | null => {
    const filled = COMPASS.filter((slot) => open.slots[slot] !== undefined);
    const slot = slotToward(x - from.x, y - from.y, filled);
    return slot === null ? null : { kind: 'slot', slot };
  };

  /** Where directions are measured from: the press point while a gesture is live, else the drawn centre. */
  const origin = (open: OpenMarkingMenu): { x: number; y: number } =>
    gesture === null ? { x: open.x, y: open.y } : { x: gesture.startX, y: gesture.startY };

  const run = (open: OpenMarkingMenu, target: MarkingMenuTarget): void => {
    const entry = entryAtTarget(open, target);
    if (entry === null) {
      close();
      return;
    }
    if (entry.submenu !== null) {
      // A submenu opens in place and keeps the menu open for a click.
      domHover = false;
      update({ expanded: { from: target, items: entry.submenu }, visible: true, sticky: true, hover: null });
      return;
    }
    close();
    if (!entry.enabled || entry.op === null) {
      if (entry.reason !== null) deps.help(entry.reason, 'warning');
      return;
    }
    void deps.run(entry.op, entry.args, { ...open.ctx, source: 'marking-menu' });
  };

  const release = (x: number, y: number): void => {
    const open = state.getState().open;
    const g = gesture;
    gesture = null;
    if (open === null || g === null) return;
    const moved = Math.hypot(x - g.startX, y - g.startY);
    // A drawn item under the pointer, else the slot in the gesture's direction from where it started.
    const overItem = domHover ? open.hover : null;
    const target = overItem ?? slotFrom(open, { x: g.startX, y: g.startY }, x, y);
    if (moved <= FLICK_PX && (overItem === null || overItem.kind === 'slot')) {
      // Click-release or a key tap: the menu stays open for a click.
      if (showTimer !== null) timers.clear(showTimer);
      showTimer = null;
      update({ visible: true, sticky: true });
      return;
    }
    if (!open.visible && now() - g.at > FLICK_MS && target === null) {
      update({ visible: true, sticky: true });
      return;
    }
    if (target === null) {
      close();
      return;
    }
    run(open, target);
  };

  const onPointerMove = (e: PointerEvent): void => {
    pointer = { x: e.clientX, y: e.clientY };
    const open = state.getState().open;
    if (open === null) return;
    if (gesture !== null) {
      gesture.lastX = e.clientX;
      gesture.lastY = e.clientY;
    }
    if (domHover) return; // the view reports hovers over drawn items
    const target = slotFrom(open, origin(open), e.clientX, e.clientY);
    const same =
      (target === null && open.hover === null) ||
      (target?.kind === 'slot' && open.hover?.kind === 'slot' && target.slot === open.hover.slot);
    if (!same) update({ hover: target });
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (gesture?.kind === 'pointer' && e.button === gesture.button) release(e.clientX, e.clientY);
  };
  const onPointerDown = (e: PointerEvent): void => {
    const open = state.getState().open;
    if (open === null || gesture !== null) return;
    // A press outside the drawn menu closes it and goes nowhere else (no selection behind a menu).
    if (e.target instanceof Element && e.target.closest('[data-ekza-marking-menu]') !== null) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    held.add(e.code);
    lastKey = e.code;
    const open = state.getState().open;
    if (open !== null && e.code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
    if (gesture?.kind === 'key' && e.code === gesture.code) {
      e.preventDefault();
      release(gesture.lastX, gesture.lastY);
    }
  };
  const onBlur = (): void => {
    held.clear();
    if (state.getState().open !== null) close();
  };
  const contextMenu = (e: MouseEvent): void => {
    if (state.getState().open !== null) e.preventDefault();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', contextMenu, { capture: true });
    detach = () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', contextMenu, { capture: true });
    };
  }

  const clampCentre = (x: number, y: number): { x: number; y: number } => {
    const w = typeof window === 'undefined' ? 0 : window.innerWidth;
    const h = typeof window === 'undefined' ? 0 : window.innerHeight;
    if (w < 2 * EDGE_MARGIN || h < 2 * EDGE_MARGIN) return { x, y };
    return {
      x: Math.min(Math.max(x, EDGE_MARGIN), w - EDGE_MARGIN),
      y: Math.min(Math.max(y, EDGE_MARGIN), h - EDGE_MARGIN),
    };
  };

  const open = (
    def: MarkingMenuDef,
    at: { x: number; y: number },
    ctx: RunContext,
    via: OpenMarkingMenu['via'],
    sticky: boolean,
  ): void => {
    close();
    const centre = clampCentre(at.x, at.y);
    const slots: Partial<Record<CompassSlot, MarkingMenuEntry>> = {};
    for (const slot of COMPASS) {
      const item = def.slots[slot];
      if (item !== undefined) slots[slot] = entryOf(item, ctx);
    }
    state.setState({
      open: {
        def,
        x: centre.x,
        y: centre.y,
        ctx,
        via,
        visible: sticky,
        sticky,
        hover: null,
        slots,
        list: def.list.map((item) => entryOf(item, ctx)),
        expanded: null,
      },
    });
    if (!sticky) {
      showTimer = timers.set(() => {
        showTimer = null;
        update({ visible: true });
      }, FLICK_MS);
    }
  };

  function close(): void {
    if (showTimer !== null) timers.clear(showTimer);
    showTimer = null;
    gesture = null;
    domHover = false;
    if (state.getState().open !== null) state.setState({ open: null });
  }

  const match = (press: PanePointerPress): MarkingMenuDef | null => {
    const session = app.session.getState();
    let overMesh: boolean | null = null;
    const isOver = (): boolean => {
      overMesh ??= press.overMesh();
      return overMesh;
    };
    let best: MarkingMenuDef | null = null;
    let bestScore = -1;
    for (const def of app.markingMenus.list()) {
      if (!def.workspaces.includes(session.workspace)) continue;
      if (!triggerMatches(def.trigger, press, held)) continue;
      const modes = def.when.modes;
      if (modes !== undefined && !modes.includes(session.model.componentMode)) continue;
      const over = def.when.over ?? 'any';
      if (over === 'mesh' && !isOver()) continue;
      if (over === 'empty' && isOver()) continue;
      // The most specific menu wins: a component mode beats what is under the pointer, which beats neither.
      const score = (modes === undefined ? 0 : 2) + (over === 'any' ? 0 : 1);
      if (score > bestScore) {
        best = def;
        bestScore = score;
      }
    }
    return best;
  };

  return {
    state,
    match,
    handlePress(press) {
      const def = match(press);
      if (def === null) return false;
      const ctx: RunContext = { panel: 'viewport', paneId: press.paneId };
      open(def, { x: press.clientX, y: press.clientY }, ctx, 'pointer', false);
      gesture = {
        kind: 'pointer',
        button: press.button,
        code: null,
        startX: press.clientX,
        startY: press.clientY,
        at: now(),
        lastX: press.clientX,
        lastY: press.clientY,
      };
      pointer = { x: press.clientX, y: press.clientY };
      return true;
    },
    openByCommand(def, ctx) {
      const at = pointer ?? {
        x: typeof window === 'undefined' ? 0 : window.innerWidth / 2,
        y: typeof window === 'undefined' ? 0 : window.innerHeight / 2,
      };
      const code = 'key' in def.trigger ? def.trigger.key : lastKey;
      const fromKey = ctx.source === 'keyboard' && code !== null && held.has(code);
      open(def, at, ctx, fromKey ? 'key' : 'command', !fromKey);
      if (fromKey) {
        gesture = {
          kind: 'key',
          button: -1,
          code,
          startX: at.x,
          startY: at.y,
          at: now(),
          lastX: at.x,
          lastY: at.y,
        };
      }
    },
    hover(target) {
      const open = state.getState().open;
      if (open === null) return;
      domHover = target !== null;
      update({ hover: target });
    },
    activate(target) {
      const current = state.getState().open;
      if (current === null) return;
      gesture = null;
      run(current, target);
    },
    close,
    screenOfSlot() {
      const current = state.getState().open;
      const out: Partial<Record<CompassSlot, { x: number; y: number }>> = {};
      if (current === null) return out;
      for (const slot of COMPASS) {
        if (current.slots[slot] !== undefined) out[slot] = slotPosition(current.x, current.y, slot);
      }
      return out;
    },
    dispose() {
      close();
      detach?.();
      detach = null;
    },
  };
}
