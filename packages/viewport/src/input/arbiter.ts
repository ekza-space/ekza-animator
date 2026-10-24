// The pointer arbiter (STUDIO-TOUCH-SPEC §5.1–§5.3, §20.4; spiked in T1a): a stage at the front of the
// ViewportManager's own pointer path for the pointer types a touch shell buffers (finger, pen). A press is held — the
// real `pointerdown` and the moves after it, with their coalesced samples — until it is decided:
//   - travel beyond the slop: a drag. The claim (`config.claims`) says whose: the tool gets the original down and the
//     held moves replayed into the normal pipeline in order (every pen sample, `coalesced`), or the press navigates
//     (orbit, or pan in an orthographic pane);
//   - still at `longPressMs`: a long-press (`onLongPress`); the tool never sees the press, the ring may follow it;
//   - up before either: a tap (`onTap`: delivered to the tool as a click, or consumed), or the second tap of a
//     double-tap (`onDoubleTap`: absorbed, the tool never sees it).
// A second finger in the same pane makes a two-finger gesture (pan, pinch, two-finger tap); the first finger is never
// delivered (or its tool drag is cancelled, its orbit ended). While a pen is down or hovered recently, fingers only
// navigate (palm rejection). Brush claims start after the slop or `brushDelayMs`, and a long-press that fires after
// that rolls the stroke back (the tool's cancel).
// The manager owns the pipeline; this module only decides. A shell builds an arbiter with `createPointerArbiter` and
// installs it with `ViewportManager.setPointerArbiter`; Studio Pro installs none, so its input is unchanged and its
// route never loads this module.
import type { PickResult } from '../types';
import type { NavGesture } from '../navigation/profiles';

/** The pointer types an arbiter may buffer (the mouse stays eager, as in Studio Pro). */
export type ArbiterPointerType = 'touch' | 'pen';
/** §5.1 routing modes. */
export type ArbiterRouting = 'shared' | 'pencilEdits' | 'pencilOnly';
/** Whose a drag is: the tool's, the camera's, or a brush stroke's (the tool's after the brush delay). */
export type ArbiterClaim = 'tool' | 'navigate' | 'brush';
/** A view gesture of `ViewportManager.navigate`. */
export type ViewGesture = 'orbit' | 'pan' | 'dolly';

/** A decided press that did not travel: where it was, what was under it. */
export interface ArbiterTap {
  readonly paneId: string;
  /** Pane CSS px. */
  readonly x: number;
  readonly y: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: 'mouse' | 'pen' | 'touch';
  /** The top pick candidate at the press point, or null. */
  readonly hit: PickResult | null;
}

/** What follows a long-press (the flick ring: release on a slot runs it); pane CSS px. */
export interface ArbiterFollow {
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  cancel(): void;
}

export interface ArbiterConfig {
  readonly buffered: readonly ArbiterPointerType[];
  readonly slopPx: { readonly touch: number; readonly pen: number };
  readonly longPressMs: number;
  /** Multi-tap windows; `mouse` set: a mouse click close in time and place to the last one is a double-click too. */
  readonly multiTapMs: { readonly touch: number; readonly pen: number; readonly mouse?: number };
  /** Multi-tap radii (CSS px, §5.4: touch 24, pen 8, mouse 4). */
  readonly multiTapPx: { readonly touch: number; readonly pen: number; readonly mouse?: number };
  /** A brush claim starts after the slop or this time (§5.1: 120 ms). */
  readonly brushDelayMs: number;
  /** Two fingers lifted within this time and the slop: a two-finger tap (undo). */
  readonly twoFingerTapMs: number;
  /** Fingers only navigate while a pen is down or for this long after its last event (§5.1: 500 ms). */
  readonly palmMs: number;
  routing(): ArbiterRouting;
  /** Whose a drag from this press is (asked at the press; the point matters: mesh-view surfaces are not candidates). */
  claims(press: ArbiterTap & { readonly pointerType: ArbiterPointerType }): ArbiterClaim;
  /** 'select': delivered to the tool as a click (down + up at the press point). */
  onTap(tap: ArbiterTap): 'select' | 'consumed';
  /** Frames; the second tap never reaches the tool. */
  onDoubleTap(tap: ArbiterTap): void;
  /** The Halo ring; the tool never saw the press. A returned follower gets the press's moves and release. */
  onLongPress(tap: ArbiterTap): ArbiterFollow | undefined;
  onTwoFingerTap(paneId: string): void;
}

/** One coalesced sample of a move, pane CSS px (`ToolPointerEvent.coalesced`). */
export interface CoalescedSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly t: number;
}

/** What the arbiter reads of a pointer event (a DOM `PointerEvent` is one). */
export interface ArbiterPointer {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly timeStamp: number;
  readonly pressure: number;
  getCoalescedEvents?(): readonly {
    readonly clientX: number;
    readonly clientY: number;
    readonly pressure: number;
    readonly timeStamp: number;
  }[];
}

/** The manager's side: its pipeline after the arbiter stage, and the queries the arbiter asks. */
export interface ArbiterPort<E extends ArbiterPointer = ArbiterPointer> {
  /** Pane CSS px of a client point, or null for an unknown pane. */
  local(paneId: string, e: { readonly clientX: number; readonly clientY: number }): { x: number; y: number } | null;
  pick(paneId: string, x: number, y: number): PickResult | null;
  ortho(paneId: string): boolean;
  capture(paneId: string, pointerId: number): void;
  /** The press into the rest of the pipeline (navigation chords, marking menus, the pointer layer, the tool). */
  down(paneId: string, e: E): void;
  move(paneId: string, e: E, coalesced: readonly CoalescedSample[]): void;
  up(paneId: string, e: E, cancelled: boolean): void;
  /** The press as a navigation drag; false when another gesture holds the viewport. */
  startNav(paneId: string, e: E, gesture: NavGesture): boolean;
  navigate(paneId: string, gesture: ViewGesture, dx: number, dy: number, at?: { x: number; y: number }): void;
  /** A two-finger gesture ended (a shot camera's change commits once). */
  endNavigate(paneId: string): void;
}

/** What the manager calls: true = the arbiter took the event (the pipeline does not see it now). */
export interface PointerArbiter<E extends ArbiterPointer = ArbiterPointer> {
  down(paneId: string, e: E): boolean;
  move(paneId: string, e: E): boolean;
  up(paneId: string, e: E, cancelled: boolean): boolean;
  /** Esc, blur, a pane removed: drop every press (the manager cancels its own tool drag and navigation). */
  cancel(): void;
  /** Touch pointers held now (two or more: the page ignores `gesturechange`, §5.3 C15). */
  touches(): number;
}

/** What `ViewportManager.setPointerArbiter` takes: an arbiter bound to the manager's port. */
export type PointerArbiterStage<E extends ArbiterPointer = ArbiterPointer> = (
  port: ArbiterPort<E>,
) => PointerArbiter<E>;

type Kind = 'mouse' | 'pen' | 'touch';
type State = 'pending' | 'tool' | 'nav' | 'long' | 'pair' | 'idle';

interface Press<E extends ArbiterPointer> {
  readonly paneId: string;
  readonly id: number;
  readonly kind: Kind;
  readonly down: E;
  readonly x: number;
  readonly y: number;
  readonly hit: PickResult | null;
  readonly claim: ArbiterClaim;
  readonly second: boolean;
  readonly palm: boolean;
  held: { readonly e: E; readonly samples: readonly CoalescedSample[] }[];
  last: E;
  state: State;
  brush: boolean;
  follow: ArbiterFollow | null;
  timers: ReturnType<typeof setTimeout>[];
}

interface Pair {
  readonly paneId: string;
  readonly start: number;
  readonly from: Map<number, { x: number; y: number }>;
  readonly at: Map<number, { x: number; y: number }>;
  travel: number;
}

interface LastTap {
  readonly paneId: string;
  readonly kind: Kind;
  readonly clientX: number;
  readonly clientY: number;
  readonly t: number;
}

const kindOf = (type: string): Kind => (type === 'pen' || type === 'touch' ? type : 'mouse');
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

/** Builds an arbiter stage over a config (the shell's input rules). */
export function createPointerArbiter<E extends ArbiterPointer>(config: ArbiterConfig): PointerArbiterStage<E> {
  return (port) => arbiter(config, port);
}

function arbiter<E extends ArbiterPointer>(config: ArbiterConfig, port: ArbiterPort<E>): PointerArbiter<E> {
  const presses = new Map<number, Press<E>>();
  let pair: Pair | null = null;
  let lastTap: LastTap | null = null;
  /** A mouse press passed through eagerly: tracked to tell a click (for the next double-click) from a drag. */
  let mouse: { readonly clientX: number; readonly clientY: number; travel: number } | null = null;
  let penAt = Number.NEGATIVE_INFINITY;

  const buffered = (kind: Kind): kind is ArbiterPointerType => kind !== 'mouse' && config.buffered.includes(kind);
  const slop = (kind: Kind): number => (kind === 'mouse' ? 3 : config.slopPx[kind]);

  const tapOf = (p: Press<E>): ArbiterTap => ({
    paneId: p.paneId,
    x: p.x,
    y: p.y,
    clientX: p.down.clientX,
    clientY: p.down.clientY,
    pointerType: p.kind,
    hit: p.hit,
  });

  const samples = (paneId: string, e: E): readonly CoalescedSample[] => {
    const at = port.local(paneId, e);
    const ox = (at?.x ?? e.clientX) - e.clientX;
    const oy = (at?.y ?? e.clientY) - e.clientY;
    const list = e.getCoalescedEvents?.() ?? [];
    const source = list.length === 0 ? [e] : list;
    return source.map((c) => ({ x: c.clientX + ox, y: c.clientY + oy, pressure: c.pressure, t: c.timeStamp }));
  };

  const clear = (p: Press<E>): void => {
    for (const timer of p.timers) clearTimeout(timer);
    p.timers = [];
  };

  /** The held press to the tool: the original down, then every held move with its samples, in order. */
  const deliver = (p: Press<E>): void => {
    p.state = 'tool';
    port.down(p.paneId, p.down);
    for (const move of p.held) port.move(p.paneId, move.e, move.samples);
    p.held = [];
  };

  const decideDrag = (p: Press<E>): void => {
    clear(p);
    if (p.claim === 'navigate') {
      if (!port.startNav(p.paneId, p.down, port.ortho(p.paneId) ? 'track' : 'tumble')) {
        p.state = 'idle';
        return;
      }
      p.state = 'nav';
      for (const move of p.held) port.move(p.paneId, move.e, move.samples);
      p.held = [];
      return;
    }
    deliver(p);
  };

  const longPress = (p: Press<E>): void => {
    if (p.state === 'tool' && p.brush)
      port.up(p.paneId, p.last, true); // the stroke's preview is rolled back
    else if (p.state !== 'pending') return;
    clear(p);
    p.held = [];
    p.state = 'long';
    p.follow = config.onLongPress(tapOf(p)) ?? null;
  };

  /** Ends whatever a press was doing when a second finger turns it into a pair. */
  const absorb = (p: Press<E>): void => {
    clear(p);
    if (p.state === 'tool') port.up(p.paneId, p.last, true);
    else if (p.state === 'nav') port.up(p.paneId, p.last, false);
    else if (p.state === 'long') p.follow?.cancel();
    p.held = [];
    p.follow = null;
    p.state = 'pair';
  };

  const pairStep = (paneId: string, id: number, x: number, y: number): void => {
    const current = pair;
    if (current === null || current.paneId !== paneId) return;
    const before = [...current.at.values()];
    const prev = current.at.get(id);
    if (prev === undefined || before.length < 2) return;
    current.at.set(id, { x, y });
    const after = [...current.at.values()];
    const from = current.from.get(id);
    if (from !== undefined) current.travel = Math.max(current.travel, dist(from.x, from.y, x, y));
    const [a0, b0] = before as [{ x: number; y: number }, { x: number; y: number }];
    const [a1, b1] = after as [{ x: number; y: number }, { x: number; y: number }];
    const mx0 = (a0.x + b0.x) / 2;
    const my0 = (a0.y + b0.y) / 2;
    const mx1 = (a1.x + b1.x) / 2;
    const my1 = (a1.y + b1.y) / 2;
    if (mx1 !== mx0 || my1 !== my0) port.navigate(paneId, 'pan', mx1 - mx0, my1 - my0);
    const s0 = dist(a0.x, a0.y, b0.x, b0.y);
    const s1 = dist(a1.x, a1.y, b1.x, b1.y);
    if (s0 > 0 && s1 > 0 && Math.abs(s1 - s0) >= 0.5) {
      const mid = port.local(paneId, { clientX: mx1, clientY: my1 }) ?? undefined;
      port.navigate(paneId, 'dolly', Math.log(s1 / s0), 0, mid);
    }
  };

  const endPair = (t: number, cancelled: boolean): void => {
    const current = pair;
    if (current === null) return;
    pair = null;
    for (const p of presses.values()) if (p.state === 'pair') p.state = 'idle';
    if (!cancelled && t - current.start <= config.twoFingerTapMs && current.travel <= config.slopPx.touch) {
      config.onTwoFingerTap(current.paneId);
    }
    port.endNavigate(current.paneId);
  };

  return {
    down(paneId, e) {
      const kind = kindOf(e.pointerType);
      if (kind === 'pen') penAt = e.timeStamp;
      // a pair is navigating in this pane (a third finger), or a pen is down (the palm): the finger is ignored
      const penDown = [...presses.values()].some((p) => p.kind === 'pen');
      if (kind === 'touch' && ((pair !== null && pair.paneId === paneId) || penDown)) {
        presses.set(e.pointerId, press(paneId, e, kind, null, 'navigate', false, false, 'idle'));
        return true;
      }
      if (kind === 'touch' && buffered(kind)) {
        const first = [...presses.values()].find(
          (p) => p.kind === 'touch' && p.paneId === paneId && p.state !== 'idle' && p.id !== e.pointerId,
        );
        if (first !== undefined) {
          absorb(first);
          const second = press(paneId, e, kind, null, 'navigate', false, false, 'pair');
          presses.set(e.pointerId, second);
          pair = {
            paneId,
            start: e.timeStamp,
            from: new Map([
              [first.id, { x: first.last.clientX, y: first.last.clientY }],
              [e.pointerId, { x: e.clientX, y: e.clientY }],
            ]),
            at: new Map([
              [first.id, { x: first.last.clientX, y: first.last.clientY }],
              [e.pointerId, { x: e.clientX, y: e.clientY }],
            ]),
            travel: 0,
          };
          port.capture(paneId, e.pointerId);
          return true;
        }
      }
      const tapWindow = config.multiTapMs[kind];
      const radius = config.multiTapPx[kind] ?? 0;
      const second =
        tapWindow !== undefined &&
        lastTap !== null &&
        lastTap.paneId === paneId &&
        lastTap.kind === kind &&
        e.timeStamp - lastTap.t <= tapWindow &&
        dist(lastTap.clientX, lastTap.clientY, e.clientX, e.clientY) <= radius;
      if (!buffered(kind)) {
        // the mouse stays eager; only a candidate second click of a double-click is held (§5.2: double-click frames)
        if (!(kind === 'mouse' && second && e.button === 0)) {
          if (kind === 'mouse') mouse = e.button === 0 ? { clientX: e.clientX, clientY: e.clientY, travel: 0 } : null;
          return false;
        }
        presses.set(e.pointerId, press(paneId, e, kind, null, 'tool', true, false, 'pending'));
        mouse = null;
        return true;
      }
      const palm = kind === 'touch' && e.timeStamp - penAt <= config.palmMs;
      const at = port.local(paneId, e) ?? { x: 0, y: 0 };
      const hit = port.pick(paneId, at.x, at.y);
      let claim: ArbiterClaim = palm
        ? 'navigate'
        : config.claims({ paneId, ...at, clientX: e.clientX, clientY: e.clientY, pointerType: kind, hit });
      const routing = config.routing(); // after the claim: the first pen press may switch it (§5.1)
      if (kind === 'touch' && routing !== 'shared') claim = 'navigate';
      if (kind === 'pen' && routing !== 'shared' && claim === 'navigate') claim = 'tool';
      const p = press(paneId, e, kind, hit, claim, second, palm, 'pending');
      presses.set(e.pointerId, p);
      port.capture(paneId, e.pointerId);
      if (!palm && !second) {
        p.timers.push(setTimeout(() => longPress(p), config.longPressMs));
        if (claim === 'brush') {
          p.timers.push(
            setTimeout(() => {
              if (p.state !== 'pending') return;
              p.brush = true;
              deliver(p);
            }, config.brushDelayMs),
          );
        }
      }
      return true;
    },

    move(paneId, e) {
      const kind = kindOf(e.pointerType);
      if (kind === 'pen') penAt = e.timeStamp;
      const p = presses.get(e.pointerId);
      if (p === undefined) {
        if (kind === 'mouse' && mouse !== null) {
          mouse.travel = Math.max(mouse.travel, dist(mouse.clientX, mouse.clientY, e.clientX, e.clientY));
        }
        return false;
      }
      if (p.paneId !== paneId) return true;
      p.last = e;
      switch (p.state) {
        case 'idle':
          return true;
        case 'pair':
          pairStep(paneId, e.pointerId, e.clientX, e.clientY);
          return true;
        case 'long': {
          const at = port.local(paneId, e);
          if (at !== null) p.follow?.move(at.x, at.y);
          return true;
        }
        case 'tool':
        case 'nav':
          // a brush stroke that travelled is a stroke: the long-press can no longer roll it back
          if (p.brush && dist(p.down.clientX, p.down.clientY, e.clientX, e.clientY) > slop(p.kind)) clear(p);
          port.move(paneId, e, samples(paneId, e));
          return true;
        case 'pending': {
          p.held.push({ e, samples: samples(paneId, e) });
          if (dist(p.down.clientX, p.down.clientY, e.clientX, e.clientY) > slop(p.kind)) decideDrag(p);
          return true;
        }
      }
    },

    up(paneId, e, cancelled) {
      const kind = kindOf(e.pointerType);
      if (kind === 'pen') penAt = e.timeStamp;
      const p = presses.get(e.pointerId);
      if (p === undefined) {
        if (kind === 'mouse' && mouse !== null && !cancelled) {
          lastTap =
            mouse.travel <= slop('mouse')
              ? { paneId, kind, clientX: mouse.clientX, clientY: mouse.clientY, t: e.timeStamp }
              : null;
        }
        mouse = null;
        return false;
      }
      presses.delete(e.pointerId);
      clear(p);
      p.last = e;
      switch (p.state) {
        case 'pending': {
          if (cancelled) return true;
          const tap = tapOf(p);
          if (p.second) {
            lastTap = null;
            config.onDoubleTap(tap);
          } else if (p.palm || (p.kind === 'touch' && config.routing() === 'pencilOnly')) {
            lastTap = null;
          } else {
            if (config.onTap(tap) === 'select') {
              port.down(paneId, p.down);
              port.up(paneId, e, false);
            }
            lastTap = { paneId, kind: p.kind, clientX: p.down.clientX, clientY: p.down.clientY, t: e.timeStamp };
          }
          return true;
        }
        case 'tool':
        case 'nav':
          port.up(paneId, e, cancelled);
          lastTap = null;
          return true;
        case 'long': {
          const at = port.local(paneId, e);
          if (cancelled || at === null) p.follow?.cancel();
          else p.follow?.up(at.x, at.y);
          lastTap = null;
          return true;
        }
        case 'pair':
          endPair(e.timeStamp, cancelled);
          lastTap = null;
          return true;
        case 'idle':
          return true;
      }
    },

    cancel() {
      for (const p of presses.values()) {
        clear(p);
        p.follow?.cancel();
        p.follow = null;
        p.held = [];
        p.state = 'idle';
      }
      pair = null;
      lastTap = null;
      mouse = null;
    },

    touches() {
      return [...presses.values()].filter((p) => p.kind === 'touch').length;
    },
  };

  function press(
    paneId: string,
    e: E,
    kind: Kind,
    hit: PickResult | null,
    claim: ArbiterClaim,
    second: boolean,
    palm: boolean,
    state: State,
  ): Press<E> {
    const at = port.local(paneId, e) ?? { x: 0, y: 0 };
    return {
      paneId,
      id: e.pointerId,
      kind,
      down: e,
      x: at.x,
      y: at.y,
      hit,
      claim,
      second,
      palm,
      held: [],
      last: e,
      state,
      brush: false,
      follow: null,
      timers: [],
    };
  }
}
