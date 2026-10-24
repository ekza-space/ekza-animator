// STUDIO-TOUCH-SPEC §20.4, §20.7 (T1a spike): the pointer arbiter's state machine over recorded pointer streams, with
// a fake manager port — tap, double-tap (the second tap absorbed), long-press against drag, drag replay with every
// coalesced sample, two-finger tap against pinch, a third finger, pen priority and the palm, the brush delay and its
// rollback, the mouse's eager path and its double-click — and the stage inside a real ViewportManager (a tool sees the
// replayed press; without an arbiter the pipeline is today's).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ArbiterConfig,
  type ArbiterPointer,
  type ArbiterPort,
  type CoalescedSample,
  createPointerArbiter,
  type PickResult,
} from '../src';
import { createRig, type Rig } from './helpers';

interface Ev extends ArbiterPointer {
  readonly samples?: readonly { clientX: number; clientY: number; pressure: number; timeStamp: number }[];
}

type Call =
  | { readonly kind: 'down' | 'up' | 'cancel'; readonly id: number; readonly x: number; readonly y: number }
  | { readonly kind: 'move'; readonly id: number; readonly x: number; readonly y: number; readonly n: number }
  | { readonly kind: 'nav'; readonly gesture: string }
  | { readonly kind: 'navigate'; readonly gesture: string; readonly dx: number }
  | { readonly kind: 'endNavigate' };

function ev(id: number, type: 'touch' | 'pen' | 'mouse', x: number, y: number, t: number, samples?: Ev['samples']): Ev {
  return {
    pointerId: id,
    pointerType: type,
    clientX: x,
    clientY: y,
    button: 0,
    timeStamp: t,
    pressure: type === 'pen' ? 0.6 : 0.5,
    ...(samples && { samples, getCoalescedEvents: () => samples }),
  };
}

function setup(overrides: Partial<ArbiterConfig> = {}, opts: { busy?: boolean; ortho?: boolean } = {}) {
  const calls: Call[] = [];
  const taps: string[] = [];
  const config: ArbiterConfig = {
    buffered: ['touch', 'pen'],
    slopPx: { touch: 10, pen: 4 },
    longPressMs: 450,
    multiTapMs: { touch: 450, pen: 350, mouse: 400 },
    multiTapPx: { touch: 24, pen: 8, mouse: 4 },
    brushDelayMs: 120,
    twoFingerTapMs: 250,
    palmMs: 500,
    routing: () => 'shared',
    claims: ({ hit }) => (hit === null ? 'navigate' : 'tool'),
    onTap: (tap) => {
      taps.push(`tap ${tap.pointerType} ${tap.x},${tap.y}`);
      return 'select';
    },
    onDoubleTap: (tap) => taps.push(`double ${tap.pointerType}`),
    onLongPress: (tap) => {
      taps.push(`long ${tap.pointerType}`);
      return {
        move: (x, y) => taps.push(`follow move ${x},${y}`),
        up: (x, y) => taps.push(`follow up ${x},${y}`),
        cancel: () => taps.push('follow cancel'),
      };
    },
    onTwoFingerTap: (pane) => taps.push(`two ${pane}`),
    ...overrides,
  };
  let hit: PickResult | null = null;
  const port: ArbiterPort<Ev> = {
    local: (_pane, e) => ({ x: e.clientX - 100, y: e.clientY - 50 }),
    pick: () => hit,
    ortho: () => opts.ortho === true,
    capture: () => {},
    down: (_pane, e) => calls.push({ kind: 'down', id: e.pointerId, x: e.clientX, y: e.clientY }),
    move: (_pane, e, c: readonly CoalescedSample[]) =>
      calls.push({ kind: 'move', id: e.pointerId, x: e.clientX, y: e.clientY, n: c.length }),
    up: (_pane, e, cancelled) =>
      calls.push({ kind: cancelled ? 'cancel' : 'up', id: e.pointerId, x: e.clientX, y: e.clientY }),
    startNav: (_pane, _e, gesture) => {
      if (opts.busy === true) return false;
      calls.push({ kind: 'nav', gesture });
      return true;
    },
    navigate: (_pane, gesture, dx) => calls.push({ kind: 'navigate', gesture, dx }),
    endNavigate: () => calls.push({ kind: 'endNavigate' }),
  };
  const arbiter = createPointerArbiter<Ev>(config)(port);
  return {
    arbiter,
    calls,
    taps,
    setHit: (next: PickResult | null): void => {
      hit = next;
    },
  };
}

const HANDLE: PickResult = { kind: 'manipulator', handle: 'tx' as never };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pointer arbiter: one finger (§5.2, §20.4)', () => {
  it('a tap is delivered to the tool as a click (down + up), after the release', () => {
    const { arbiter, calls, taps } = setup();
    expect(arbiter.down('p', ev(1, 'touch', 300, 200, 0))).toBe(true);
    expect(calls).toEqual([]); // buffered: the tool has not seen the press
    expect(arbiter.move('p', ev(1, 'touch', 304, 203, 16))).toBe(true); // inside the 10 px slop
    expect(arbiter.up('p', ev(1, 'touch', 304, 203, 80), false)).toBe(true);
    expect(taps).toEqual(['tap touch 200,150']);
    expect(calls).toEqual([
      { kind: 'down', id: 1, x: 300, y: 200 },
      { kind: 'up', id: 1, x: 304, y: 203 },
    ]);
  });

  it('a consumed tap never reaches the tool', () => {
    const { arbiter, calls } = setup({ onTap: () => 'consumed' });
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.up('p', ev(1, 'touch', 300, 200, 50), false);
    expect(calls).toEqual([]);
  });

  it('double-tap: the first tap selects, the second frames and is absorbed', () => {
    const { arbiter, calls, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.up('p', ev(1, 'touch', 300, 200, 60), false);
    arbiter.down('p', ev(2, 'touch', 310, 210, 200)); // within 450 ms and 24 px
    vi.advanceTimersByTime(600); // a held second tap never long-presses
    arbiter.up('p', ev(2, 'touch', 310, 210, 260), false);
    expect(taps).toEqual(['tap touch 200,150', 'double touch']);
    expect(calls.filter((c) => c.kind === 'down')).toHaveLength(1);
    // a third tap right after is a fresh first tap (the tool sees it)
    arbiter.down('p', ev(3, 'touch', 310, 210, 300));
    arbiter.up('p', ev(3, 'touch', 310, 210, 340), false);
    expect(taps.at(-1)).toBe('tap touch 210,160');
  });

  it('a second tap too late or too far is a tap of its own', () => {
    const { arbiter, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.up('p', ev(1, 'touch', 300, 200, 50), false);
    arbiter.down('p', ev(2, 'touch', 300, 200, 600));
    arbiter.up('p', ev(2, 'touch', 300, 200, 650), false);
    arbiter.down('p', ev(3, 'touch', 340, 200, 700));
    arbiter.up('p', ev(3, 'touch', 340, 200, 750), false);
    expect(taps).toEqual(['tap touch 200,150', 'tap touch 200,150', 'tap touch 240,150']);
  });

  it('a long-press opens the ring; the tool never sees the press; the follower gets the moves', () => {
    const { arbiter, calls, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.move('p', ev(1, 'touch', 305, 200, 100));
    vi.advanceTimersByTime(449);
    expect(taps).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(taps).toEqual(['long touch']);
    arbiter.move('p', ev(1, 'touch', 380, 200, 600)); // a flick after the ring opened
    arbiter.up('p', ev(1, 'touch', 380, 200, 700), false);
    expect(taps).toEqual(['long touch', 'follow move 280,150', 'follow up 280,150']);
    expect(calls).toEqual([]);
  });

  it('a press that moves past the slop before 450 ms is a drag and never opens the ring (C3)', () => {
    const { arbiter, calls, taps, setHit } = setup();
    setHit(HANDLE); // a handle: the tool's
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.move('p', ev(1, 'touch', 305, 200, 50));
    arbiter.move('p', ev(1, 'touch', 312, 200, 100)); // 12 px > 10 px
    vi.advanceTimersByTime(1000);
    arbiter.move('p', ev(1, 'touch', 330, 200, 600));
    arbiter.up('p', ev(1, 'touch', 330, 200, 650), false);
    expect(taps).toEqual([]);
    expect(calls).toEqual([
      { kind: 'down', id: 1, x: 300, y: 200 }, // the original down, replayed
      { kind: 'move', id: 1, x: 305, y: 200, n: 1 }, // the held moves, in order
      { kind: 'move', id: 1, x: 312, y: 200, n: 1 },
      { kind: 'move', id: 1, x: 330, y: 200, n: 1 },
      { kind: 'up', id: 1, x: 330, y: 200 },
    ]);
  });

  it('a drag on nothing claimed orbits (persp) or pans (ortho); the tool never sees it', () => {
    for (const ortho of [false, true]) {
      const { arbiter, calls } = setup({}, { ortho });
      arbiter.down('p', ev(1, 'touch', 300, 200, 0));
      arbiter.move('p', ev(1, 'touch', 320, 200, 50));
      arbiter.up('p', ev(1, 'touch', 320, 200, 90), false);
      expect(calls).toEqual([
        { kind: 'nav', gesture: ortho ? 'track' : 'tumble' },
        { kind: 'move', id: 1, x: 320, y: 200, n: 1 },
        { kind: 'up', id: 1, x: 320, y: 200 },
      ]);
    }
  });

  it('a navigation the manager refuses (another gesture holds it) leaves the press idle', () => {
    const { arbiter, calls } = setup({}, { busy: true });
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.move('p', ev(1, 'touch', 330, 200, 50));
    arbiter.up('p', ev(1, 'touch', 330, 200, 90), false);
    expect(calls).toEqual([]);
  });

  it('a pointercancel before the decision delivers nothing', () => {
    const { arbiter, calls, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.up('p', ev(1, 'touch', 300, 200, 50), true);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
    expect(taps).toEqual([]);
  });
});

describe('pointer arbiter: the Pencil (§5.1, §5.4)', () => {
  it('replays every coalesced sample of every held move to the tool', () => {
    const { arbiter, calls, setHit } = setup();
    setHit(HANDLE);
    const burst = (x0: number, t0: number) =>
      [0, 1, 2, 3].map((i) => ({ clientX: x0 + i, clientY: 200, pressure: 0.2 + i * 0.1, timeStamp: t0 + i * 2 }));
    arbiter.down('p', ev(1, 'pen', 300, 200, 0));
    arbiter.move('p', ev(1, 'pen', 303, 200, 8, burst(300, 2))); // 3 px: inside the pen's 4 px slop
    arbiter.move('p', ev(1, 'pen', 307, 200, 16, burst(304, 10))); // decided here
    arbiter.move('p', ev(1, 'pen', 311, 200, 24, burst(308, 18)));
    expect(calls.filter((c) => c.kind === 'move').map((c) => (c.kind === 'move' ? c.n : 0))).toEqual([4, 4, 4]);
  });

  it('pen slop is 4 px and its double-tap radius 8 px', () => {
    const { arbiter, calls, taps } = setup();
    arbiter.down('p', ev(1, 'pen', 300, 200, 0));
    arbiter.move('p', ev(1, 'pen', 305, 200, 10));
    expect(calls).toEqual([
      { kind: 'nav', gesture: 'tumble' },
      { kind: 'move', id: 1, x: 305, y: 200, n: 1 },
    ]);
    arbiter.up('p', ev(1, 'pen', 305, 200, 20), false);
    arbiter.down('p', ev(2, 'pen', 400, 200, 100));
    arbiter.up('p', ev(2, 'pen', 400, 200, 120), false);
    arbiter.down('p', ev(3, 'pen', 410, 200, 200)); // 10 px > 8 px: not a double-tap
    arbiter.up('p', ev(3, 'pen', 410, 200, 220), false);
    expect(taps).toEqual(['tap pen 300,150', 'tap pen 310,150']);
  });

  it('Pencil edits: a finger only navigates (and taps select); the pen claims what a finger would orbit', () => {
    const { arbiter, calls } = setup({ routing: () => 'pencilEdits' });
    arbiter.down('p', ev(1, 'pen', 300, 200, 0));
    arbiter.move('p', ev(1, 'pen', 320, 200, 20));
    arbiter.up('p', ev(1, 'pen', 320, 200, 40), false);
    expect(calls.map((c) => c.kind)).toEqual(['down', 'move', 'up']); // the tool's (a marquee, a stroke)
  });

  it('palm: while the pen is down, fingers are ignored; within 500 ms of a pen event they only navigate', () => {
    const { arbiter, calls, taps, setHit } = setup();
    setHit(HANDLE);
    arbiter.down('p', ev(1, 'pen', 300, 200, 0));
    arbiter.down('p', ev(2, 'touch', 600, 400, 10)); // the palm, pen down
    arbiter.move('p', ev(2, 'touch', 650, 400, 20));
    arbiter.up('p', ev(2, 'touch', 650, 400, 30), false);
    arbiter.up('p', ev(1, 'pen', 300, 200, 40), false);
    expect(taps).toEqual(['tap pen 200,150']);
    calls.length = 0;
    // 200 ms after the pen lifted: a touch on a handle only navigates; its tap selects nothing
    arbiter.down('p', ev(3, 'touch', 600, 400, 240));
    arbiter.up('p', ev(3, 'touch', 600, 400, 260), false);
    arbiter.down('p', ev(4, 'touch', 600, 400, 300));
    arbiter.move('p', ev(4, 'touch', 640, 400, 320));
    arbiter.up('p', ev(4, 'touch', 640, 400, 340), false);
    expect(taps).toEqual(['tap pen 200,150']);
    expect(calls.map((c) => c.kind)).toEqual(['nav', 'move', 'up']);
  });
});

describe('pointer arbiter: two fingers (§5.2, C6, C14)', () => {
  it('a second finger makes a pair: the first is never delivered; pinch dollies, the midpoint pans', () => {
    const { arbiter, calls, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.move('p', ev(1, 'touch', 302, 200, 10));
    arbiter.down('p', ev(2, 'touch', 400, 200, 20));
    arbiter.move('p', ev(2, 'touch', 450, 200, 60)); // spread 98 → 148: a dolly; the midpoint moved: a pan
    arbiter.move('p', ev(1, 'touch', 302, 230, 70)); // both down 15: a pan
    arbiter.up('p', ev(1, 'touch', 302, 230, 400), false);
    arbiter.move('p', ev(2, 'touch', 500, 200, 410)); // the remaining finger is idle
    arbiter.up('p', ev(2, 'touch', 500, 200, 420), false);
    vi.advanceTimersByTime(1000);
    expect(taps).toEqual([]);
    expect(calls.some((c) => c.kind === 'down')).toBe(false);
    const gestures = calls.filter((c) => c.kind === 'navigate').map((c) => (c.kind === 'navigate' ? c.gesture : ''));
    expect(gestures).toContain('pan');
    expect(gestures).toContain('dolly');
    const dolly = calls.find((c) => c.kind === 'navigate' && c.gesture === 'dolly');
    expect(dolly?.kind === 'navigate' && dolly.dx).toBeCloseTo(Math.log(148 / 98), 6);
    expect(calls.at(-1)).toEqual({ kind: 'endNavigate' });
  });

  it('a quick two-finger tap is undo; fingers that rest or travel are not', () => {
    const quick = setup();
    quick.arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    quick.arbiter.down('p', ev(2, 'touch', 400, 200, 30));
    quick.arbiter.up('p', ev(1, 'touch', 300, 200, 150), false);
    quick.arbiter.up('p', ev(2, 'touch', 400, 200, 160), false);
    expect(quick.taps).toEqual(['two p']);

    const rest = setup();
    rest.arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    rest.arbiter.down('p', ev(2, 'touch', 400, 200, 30));
    rest.arbiter.up('p', ev(1, 'touch', 300, 200, 900), false);
    expect(rest.taps).toEqual([]);

    const pinch = setup();
    pinch.arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    pinch.arbiter.down('p', ev(2, 'touch', 400, 200, 30));
    pinch.arbiter.move('p', ev(2, 'touch', 430, 200, 60));
    pinch.arbiter.up('p', ev(1, 'touch', 300, 200, 100), false);
    expect(pinch.taps).toEqual([]);
  });

  it('a second finger cancels a tool drag the first began, and ends an orbit (never reverting it)', () => {
    const tool = setup();
    tool.setHit(HANDLE);
    tool.arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    tool.arbiter.move('p', ev(1, 'touch', 330, 200, 30));
    tool.arbiter.down('p', ev(2, 'touch', 400, 200, 60));
    expect(tool.calls.map((c) => c.kind)).toEqual(['down', 'move', 'cancel']);

    const orbit = setup();
    orbit.arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    orbit.arbiter.move('p', ev(1, 'touch', 330, 200, 30));
    orbit.arbiter.down('p', ev(2, 'touch', 400, 200, 60));
    expect(orbit.calls.map((c) => c.kind)).toEqual(['nav', 'move', 'up']);
  });

  it('a third finger is ignored; fingers in another pane are their own presses', () => {
    const { arbiter, taps } = setup();
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    arbiter.down('p', ev(2, 'touch', 400, 200, 10));
    arbiter.down('p', ev(3, 'touch', 500, 200, 20));
    expect(arbiter.touches()).toBe(3);
    arbiter.up('p', ev(3, 'touch', 500, 200, 40), false);
    arbiter.down('q', ev(4, 'touch', 900, 200, 50));
    arbiter.up('q', ev(4, 'touch', 900, 200, 70), false);
    expect(taps).toEqual(['tap touch 800,150']);
  });
});

describe('pointer arbiter: the brush delay (§5.1, C16)', () => {
  it('a still brush press starts the stroke at 120 ms; a long-press after it rolls the stroke back', () => {
    const { arbiter, calls, taps } = setup({ claims: () => 'brush' });
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    vi.advanceTimersByTime(119);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.map((c) => c.kind)).toEqual(['down']);
    vi.advanceTimersByTime(330);
    expect(calls.map((c) => c.kind)).toEqual(['down', 'cancel']); // the stroke's preview rolled back
    expect(taps).toEqual(['long touch']);
  });

  it('a brush stroke that travelled is never rolled back', () => {
    const { arbiter, calls, taps } = setup({ claims: () => 'brush' });
    arbiter.down('p', ev(1, 'touch', 300, 200, 0));
    vi.advanceTimersByTime(130);
    arbiter.move('p', ev(1, 'touch', 340, 200, 200));
    vi.advanceTimersByTime(1000);
    arbiter.up('p', ev(1, 'touch', 340, 200, 1300), false);
    expect(calls.map((c) => c.kind)).toEqual(['down', 'move', 'up']);
    expect(taps).toEqual([]);
  });
});

describe('pointer arbiter: the mouse stays eager (§20.4)', () => {
  it('passes presses through; only a second click close in time and place is held, and frames', () => {
    const { arbiter, taps } = setup();
    expect(arbiter.down('p', ev(1, 'mouse', 300, 200, 0))).toBe(false);
    expect(arbiter.move('p', ev(1, 'mouse', 301, 200, 10))).toBe(false);
    expect(arbiter.up('p', ev(1, 'mouse', 301, 200, 50), false)).toBe(false);
    expect(arbiter.down('p', ev(1, 'mouse', 302, 200, 200))).toBe(true); // the second click: held
    expect(arbiter.up('p', ev(1, 'mouse', 302, 200, 250), false)).toBe(true);
    expect(taps).toEqual(['double mouse']);
    // a drag is not a click: the next press passes through
    arbiter.down('p', ev(1, 'mouse', 300, 200, 1000));
    arbiter.move('p', ev(1, 'mouse', 340, 200, 1010));
    arbiter.up('p', ev(1, 'mouse', 340, 200, 1050), false);
    expect(arbiter.down('p', ev(1, 'mouse', 340, 200, 1100))).toBe(false);
  });

  it('without a mouse window every mouse press passes through', () => {
    const { arbiter } = setup({ multiTapMs: { touch: 450, pen: 350 } });
    for (const t of [0, 100, 200]) {
      expect(arbiter.down('p', ev(1, 'mouse', 300, 200, t))).toBe(false);
      expect(arbiter.up('p', ev(1, 'mouse', 300, 200, t + 20), false)).toBe(false);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------
// The stage inside a real ViewportManager.

let rig: Rig | null = null;
afterEach(() => {
  rig?.dispose();
  rig = null;
});

function touch(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  id: number,
  x: number,
  y: number,
  pointerType: 'touch' | 'pen' | 'mouse' = 'touch',
): void {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType,
      isPrimary: id === 1,
      clientX: x,
      clientY: y,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pressure: type === 'pointerup' ? 0 : 0.5,
    }),
  );
}

describe('ViewportManager.setPointerArbiter (§20.4)', () => {
  it('a finger drag on empty space orbits through the stage; removing it restores the shipped pipeline', async () => {
    vi.useRealTimers();
    rig = await createRig();
    rig.layout('single');
    rig.frame();
    const pane = rig.panes.get('pane-single') as HTMLElement;
    const config: ArbiterConfig = {
      buffered: ['touch', 'pen'],
      slopPx: { touch: 10, pen: 4 },
      longPressMs: 450,
      multiTapMs: { touch: 450, pen: 350 },
      multiTapPx: { touch: 24, pen: 8 },
      brushDelayMs: 120,
      twoFingerTapMs: 250,
      palmMs: 500,
      routing: () => 'shared',
      claims: () => 'navigate',
      onTap: () => 'select',
      onDoubleTap: () => {},
      onLongPress: () => undefined,
      onTwoFingerTap: () => {},
    };
    const off = rig.vm.setPointerArbiter(createPointerArbiter(config));
    const start = rig.vm.camera('pane-single');
    touch(pane, 'pointerdown', 1, 600, 300);
    touch(pane, 'pointermove', 1, 605, 300); // inside the slop: nothing moves yet
    expect(rig.vm.camera('pane-single').position).toEqual(start.position);
    touch(pane, 'pointermove', 1, 640, 300);
    touch(pane, 'pointerup', 1, 640, 300);
    const orbited = rig.vm.camera('pane-single');
    expect(orbited.position.some((v, i) => Math.abs(v - (start.position[i] ?? 0)) > 1e-6)).toBe(true);
    off();
    // no arbiter: a plain finger drag is the tool's (the shipped select tool), the camera stays
    touch(pane, 'pointerdown', 2, 600, 300);
    touch(pane, 'pointermove', 2, 680, 300);
    touch(pane, 'pointerup', 2, 680, 300);
    expect(rig.vm.camera('pane-single').position).toEqual(orbited.position);
  });

  it('the tool receives the replayed down and moves with `coalesced` and pressure; Pro events carry neither', async () => {
    vi.useRealTimers();
    rig = await createRig();
    rig.layout('single');
    rig.frame();
    const pane = rig.panes.get('pane-single') as HTMLElement;
    const seen: { type: string; coalesced: number | null; pressure: number | null }[] = [];
    const record =
      (type: string) =>
      (e: { coalesced?: readonly unknown[]; pressure?: number }): boolean => {
        seen.push({ type, coalesced: e.coalesced?.length ?? null, pressure: e.pressure ?? null });
        return true;
      };
    rig.app.tools.register({
      id: 'probe',
      panel: 'viewport',
      label: 'Probe',
      create: () => ({ pointerDown: record('down'), pointerMove: record('move'), pointerUp: record('up') }),
    });
    rig.app.session.setState((s) => ({ tools: { ...s.tools, viewport: 'probe' } }));
    const base: Omit<ArbiterConfig, 'claims'> = {
      buffered: ['touch', 'pen'],
      slopPx: { touch: 10, pen: 4 },
      longPressMs: 450,
      multiTapMs: { touch: 450, pen: 350 },
      multiTapPx: { touch: 24, pen: 8 },
      brushDelayMs: 120,
      twoFingerTapMs: 250,
      palmMs: 500,
      routing: () => 'shared',
      onTap: () => 'select',
      onDoubleTap: () => {},
      onLongPress: () => undefined,
      onTwoFingerTap: () => {},
    };
    // Pro: no arbiter — the press reaches the tool at once, without the additive fields
    touch(pane, 'pointerdown', 1, 600, 300, 'pen');
    touch(pane, 'pointermove', 1, 602, 300, 'pen');
    touch(pane, 'pointerup', 1, 602, 300, 'pen');
    expect(seen).toEqual([
      { type: 'down', coalesced: null, pressure: null },
      { type: 'move', coalesced: null, pressure: null },
      { type: 'up', coalesced: null, pressure: null },
    ]);
    seen.length = 0;
    const off = rig.vm.setPointerArbiter(createPointerArbiter({ ...base, claims: () => 'tool' }));
    touch(pane, 'pointerdown', 2, 600, 300, 'pen');
    touch(pane, 'pointermove', 2, 602, 300, 'pen'); // held (inside the 4 px slop)
    expect(seen).toEqual([]);
    touch(pane, 'pointermove', 2, 610, 300, 'pen'); // decided: down + both moves replayed
    touch(pane, 'pointerup', 2, 610, 300, 'pen');
    expect(seen.map((s) => s.type)).toEqual(['down', 'move', 'move', 'up']);
    expect(seen.filter((s) => s.type === 'move').every((s) => s.coalesced === 1 && s.pressure === 0.5)).toBe(true);
    off();
  });
});
