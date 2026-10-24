// The pointer arbiter (STUDIO-TOUCH-SPEC §5.1–§5.4, §20.4; spiked in T1a, built in T1): a stage at the front of the
// ViewportManager's own pointer path for the pointer types a touch shell buffers (finger, pen). A press is held — the
// real `pointerdown` and the moves after it, with their coalesced samples — until it is decided:
//   - travel beyond the slop: a drag. The claim (`config.claims`) says whose: the tool gets the original down and the
//     held moves replayed into the normal pipeline in order (every pen sample, `coalesced`), or the press navigates
//     (orbit, or pan in an orthographic pane);
//   - still at `longPressMs`: a long-press (`onLongPress`); the tool never sees the press, the ring may follow it;
//   - up before either: a tap (`onTap`: delivered to the tool as a click, or consumed), or the second tap of a
//     double-tap (`onDoubleTap`: absorbed, the tool never sees it). Taps that follow a double-tap within the multi-tap
//     window are absorbed too, so the tool never pairs two taps the arbiter did not (C17).
// A second finger in the same pane makes a two-finger gesture (pan, pinch, two-finger tap); the first finger is never
// delivered (or its tool drag is cancelled, its orbit ended). While a pen is down fingers are ignored, and for
// `palmMs` after its last event they only navigate (palm rejection). Brush claims start after the slop or
// `brushDelayMs`, and a long-press that fires after that rolls the stroke back (the tool's cancel). A press whose
// target is chrome inside a pane (`[data-ekza-chrome]`) never enters the stage or the pipeline (C6).
// The manager owns the pipeline; this module only decides. A shell builds an arbiter with `createPointerArbiter` and
// installs it with `ViewportManager.setPointerArbiter`; Studio Pro installs none, so its input is unchanged and its
// route never loads this module (T1a amendment A1: the manager holds a stage, never the state machine).
import type { NavGesture } from '../navigation/profiles';
import type { PickResult, ViewPreset } from '../types';
import { POINTER_TOLERANCE, usePointerTolerance } from './tolerance';

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
  /**
   * Multi-tap windows (ms, from a release to the next press; `POINTER_TOLERANCE`: touch 450, pen 350, mouse 500).
   * `mouse` set: a mouse click close in time and place to the last one is a double-click too (§5.2, C2).
   */
  readonly multiTapMs: { readonly touch: number; readonly pen: number; readonly mouse?: number };
  /** Multi-tap radii (CSS px between the presses; `POINTER_TOLERANCE`: touch 24, pen 8, mouse 4). */
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
  /** The element pressed and the pane element listening (a DOM event has both; recorded streams need neither). */
  readonly target?: EventTarget | null;
  readonly currentTarget?: EventTarget | null;
  getCoalescedEvents?(): readonly {
    readonly clientX: number;
    readonly clientY: number;
    readonly pressure: number;
    readonly timeStamp: number;
  }[];
}

/**
 * One step of the manager's pipeline after the stage (`ViewportManager.pipe`): the press, a move, the release or its
 * cancel into the rest of the pipeline (navigation chords, marking menus, the pointer layer, the tool), the pointer
 * captured by the pane, or the press as a navigation drag of that gesture.
 */
export type PipeStep = 'down' | 'move' | 'up' | 'cancel' | 'capture' | NavGesture;

/** What a stage is bound to: the ViewportManager itself (its queries, `navigate` and its pipeline after the stage). */
export interface ArbiterHost<E extends ArbiterPointer = ArbiterPointer> {
  paneRect(id: string): { readonly x: number; readonly y: number } | null;
  pick(paneId: string, x: number, y: number): PickResult | null;
  paneState(id: string): { readonly preset: ViewPreset | null } | null;
  navigate(paneId: string, gesture: ViewGesture, dx: number, dy: number, at?: { x: number; y: number }): void;
  /** Ends a `navigate` gesture (a shot camera's change commits once). */
  endNavigate(paneId: string): void;
  /** The pipeline after the stage; false for an unknown pane, or a navigation another gesture holds the viewport. */
  pipe(paneId: string, e: E, step: PipeStep, coalesced?: readonly CoalescedSample[]): boolean;
}

/** The arbiter's view of its host (`hostPort`); the unit tests drive the state machine through a recorded one. */
export interface ArbiterPort<E extends ArbiterPointer = ArbiterPointer> {
  /** Pane CSS px of a client point, or null for an unknown pane. */
  local(paneId: string, e: { readonly clientX: number; readonly clientY: number }): { x: number; y: number } | null;
  pick(paneId: string, x: number, y: number): PickResult | null;
  ortho(paneId: string): boolean;
  /** Captures the press's pointer to the pane (the real `pointerdown`). */
  capture(paneId: string, e: E): void;
  /** The press into the rest of the pipeline (navigation chords, marking menus, the pointer layer, the tool). */
  down(paneId: string, e: E): void;
  move(paneId: string, e: E, coalesced: readonly CoalescedSample[]): void;
  up(paneId: string, e: E, cancelled: boolean): void;
  /** The press as a navigation drag; false when another gesture holds the viewport. */
  startNav(paneId: string, e: E, gesture: NavGesture): boolean;
  navigate(paneId: string, gesture: ViewGesture, dx: number, dy: number, at?: { x: number; y: number }): void;
  /** A two-finger gesture ended (a shot camera's change commits once). */
  endNavigate(paneId: string): void;
  /** Every event's pointer type, first: the pick tolerances follow it (§5.4). */
  pointer(type: string): void;
}

/** What the manager calls: true = the arbiter took the event (the pipeline does not see it now). */
export interface PointerArbiter<E extends ArbiterPointer = ArbiterPointer> {
  down(paneId: string, e: E): boolean;
  move(paneId: string, e: E): boolean;
  up(paneId: string, e: E, cancelled: boolean): boolean;
  /**
   * Esc, blur, the stage replaced or removed: drop every press, end a two-finger navigation, restore the mouse's pick
   * tolerances (the manager cancels its own drags).
   */
  cancel(): void;
  /** Touch pointers held now (two or more: the page ignores `gesturechange`, §5.3 C15). */
  touches(): number;
}

/** What `ViewportManager.setPointerArbiter` takes: a stage the manager binds to itself. */
export type PointerArbiterStage<E extends ArbiterPointer = ArbiterPointer> = (
  host: ArbiterHost<E>,
) => PointerArbiter<E>;

/** Builds an arbiter stage over a config (the shell's input rules). */
export function createPointerArbiter<E extends ArbiterPointer>(config: ArbiterConfig): PointerArbiterStage<E> {
  return (host) => pointerArbiter(config, hostPort(host));
}

/** A pointer-down whose target is chrome inside the pane (a chip, a petal): the shell's, never a canvas press (C6). */
export function onChrome(e: ArbiterPointer): boolean {
  const target = e.target as Element | null | undefined;
  const pane = e.currentTarget as Element | null | undefined;
  const chrome = typeof target?.closest === 'function' ? target.closest('[data-ekza-chrome]') : null;
  return chrome !== null && pane !== chrome && pane?.contains(chrome) === true;
}

const policed = new WeakSet<object>();

/**
 * The press policy of §4.1 / C10 on a pane a buffered press reaches: no text selection and no iOS callout (the manager
 * sets `touch-action: none` on every pane), so a still press is the arbiter's long-press (T1a risk 8).
 */
function pressPolicy(pane: EventTarget | null | undefined): void {
  const style = (pane as HTMLElement | null | undefined)?.style;
  if (style === undefined || policed.has(style)) return;
  policed.add(style);
  style.setProperty('-webkit-touch-callout', 'none');
  style.setProperty('-webkit-user-select', 'none');
  style.setProperty('user-select', 'none');
}

/** The port of a stage bound to a host (the manager): pane px from the pane's rectangle, the pipeline through `pipe`. */
export function hostPort<E extends ArbiterPointer>(host: ArbiterHost<E>): ArbiterPort<E> {
  return {
    local(paneId, e) {
      const rect = host.paneRect(paneId);
      return rect === null ? null : { x: e.clientX - rect.x, y: e.clientY - rect.y };
    },
    pick: (paneId, x, y) => host.pick(paneId, x, y),
    ortho(paneId) {
      const preset = host.paneState(paneId)?.preset ?? null;
      return preset !== null && preset !== 'persp';
    },
    capture(paneId, e) {
      host.pipe(paneId, e, 'capture');
      pressPolicy(e.currentTarget);
    },
    // A11: `coalesced` is [] on the replayed down and up (the event is the sample), filled on moves
    down: (paneId, e) => void host.pipe(paneId, e, 'down', []),
    move: (paneId, e, coalesced) => void host.pipe(paneId, e, 'move', coalesced),
    up: (paneId, e, cancelled) => void host.pipe(paneId, e, cancelled ? 'cancel' : 'up', []),
    startNav: (paneId, e, gesture) => host.pipe(paneId, e, gesture),
    navigate: (paneId, gesture, dx, dy, at) => host.navigate(paneId, gesture, dx, dy, at),
    endNavigate: (paneId) => host.endNavigate(paneId),
    pointer: usePointerTolerance,
  };
}

type Kind = 'mouse' | 'pen' | 'touch';
type State = 'pending' | 'tool' | 'nav' | 'long' | 'pair' | 'idle';
/** A press within the multi-tap window: the second tap of a double-tap, or a tap after one (absorbed silently). */
type Second = 'double' | 'absorb' | null;

interface Press<E extends ArbiterPointer> {
  readonly paneId: string;
  readonly id: number;
  readonly kind: Kind;
  readonly down: E;
  readonly x: number;
  readonly y: number;
  readonly hit: PickResult | null;
  readonly claim: ArbiterClaim;
  readonly second: Second;
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
  readonly clientX: number;
  readonly clientY: number;
  readonly t: number;
  /** A double-tap ended here: a press within the window (anywhere, any pointer) is absorbed too. */
  readonly absorb: boolean;
}

const kindOf = (type: string): Kind => (type === 'pen' || type === 'touch' ? type : 'mouse');
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(bx - ax, by - ay);

/**
 * The state machine over a port (`createPointerArbiter` binds it to the manager). The tool's own double-click window
 * and radius must not exceed the config's per pointer type (`POINTER_TOLERANCE` holds both), so the taps it is handed
 * never form a double-click the arbiter did not absorb.
 */
export function pointerArbiter<E extends ArbiterPointer>(
  config: ArbiterConfig,
  port: ArbiterPort<E>,
): PointerArbiter<E> {
  const presses = new Map<number, Press<E>>();
  let pair: Pair | null = null;
  let lastTap: LastTap | null = null;
  /** The last click the tool was handed (a replayed tap, a mouse click passed through): the tool pairs presses with it. */
  let lastClick: LastTap | null = null;
  /** A mouse press passed through eagerly: tracked to tell a click (for the next double-click) from a drag. */
  let mouse: { readonly clientX: number; readonly clientY: number; travel: number } | null = null;
  let penAt = Number.NEGATIVE_INFINITY;

  const buffered = (kind: Kind): kind is ArbiterPointerType => kind !== 'mouse' && config.buffered.includes(kind);
  const slop = (kind: Kind): number => (kind === 'mouse' ? POINTER_TOLERANCE.mouse.slopPx : config.slopPx[kind]);

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
  const absorbIntoPair = (p: Press<E>): void => {
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
    // the navigation commits first: the two-finger tap's undo must not meet an open camera preview
    port.endNavigate(current.paneId);
    if (!cancelled && t - current.start <= config.twoFingerTapMs && current.travel <= config.slopPx.touch) {
      config.onTwoFingerTap(current.paneId);
    }
  };

  /**
   * Whether a press is the second tap of a double-tap, a tap after one, or neither (§5.2, C17). Whatever the first
   * tap's pointer, the second press's window and radius decide, as the tool's do; a press the tool would pair with
   * the last click it was handed is a double-tap too (a palm or consumed tap came between).
   */
  const secondOf = (paneId: string, kind: Kind, e: E): Second => {
    const window = config.multiTapMs[kind];
    if (window === undefined) return null;
    const radius = config.multiTapPx[kind] ?? 0;
    const near = (tap: LastTap | null): tap is LastTap =>
      tap !== null &&
      tap.paneId === paneId &&
      e.timeStamp - tap.t <= window &&
      (tap.absorb || dist(tap.clientX, tap.clientY, e.clientX, e.clientY) <= radius);
    if (near(lastTap)) return lastTap.absorb ? 'absorb' : 'double';
    return near(lastClick) ? 'double' : null;
  };

  return {
    down(paneId, e) {
      port.pointer(e.pointerType);
      if (onChrome(e)) return true;
      const kind = kindOf(e.pointerType);
      if (kind === 'pen') penAt = e.timeStamp;
      // a pair is navigating in this pane (a third finger), or a pen is down (the palm): the finger is ignored
      const penDown = [...presses.values()].some((p) => p.kind === 'pen');
      if (kind === 'touch' && ((pair !== null && pair.paneId === paneId) || penDown)) {
        presses.set(e.pointerId, press(paneId, e, kind, null, 'navigate', null, false, 'idle'));
        return true;
      }
      if (kind === 'touch' && buffered(kind)) {
        const first = [...presses.values()].find(
          (p) => p.kind === 'touch' && p.paneId === paneId && p.state !== 'idle' && p.id !== e.pointerId,
        );
        if (first !== undefined) {
          absorbIntoPair(first);
          const second = press(paneId, e, kind, null, 'navigate', null, false, 'pair');
          presses.set(e.pointerId, second);
          const fingers = (): Map<number, { x: number; y: number }> =>
            new Map([
              [first.id, { x: first.last.clientX, y: first.last.clientY }],
              [e.pointerId, { x: e.clientX, y: e.clientY }],
            ]);
          pair = { paneId, start: e.timeStamp, from: fingers(), at: fingers(), travel: 0 };
          lastTap = null;
          port.capture(paneId, e);
          return true;
        }
      }
      const second = secondOf(paneId, kind, e);
      if (!buffered(kind)) {
        // the mouse stays eager; only a candidate second click of a double-click is held (§5.2: double-click frames)
        if (!(kind === 'mouse' && second !== null && e.button === 0)) {
          if (kind === 'mouse') mouse = e.button === 0 ? { clientX: e.clientX, clientY: e.clientY, travel: 0 } : null;
          return false;
        }
        presses.set(e.pointerId, press(paneId, e, kind, null, 'tool', second, false, 'pending'));
        mouse = null;
        return true;
      }
      const palm = kind === 'touch' && e.timeStamp - penAt <= config.palmMs;
      const at = port.local(paneId, e) ?? { x: 0, y: 0 };
      const hit = port.pick(paneId, at.x, at.y);
      let claim: ArbiterClaim = palm
        ? 'navigate'
        : config.claims({ paneId, ...at, clientX: e.clientX, clientY: e.clientY, pointerType: kind, hit });
      const routing = config.routing(); // after the claim: the first pen press may switch it (§5.1, A6)
      if (kind === 'touch' && routing !== 'shared') claim = 'navigate';
      if (kind === 'pen' && routing !== 'shared' && claim === 'navigate') claim = 'tool';
      const p = press(paneId, e, kind, hit, claim, second, palm, 'pending');
      presses.set(e.pointerId, p);
      port.capture(paneId, e);
      if (!palm && second === null) {
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
      port.pointer(e.pointerType);
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
      port.pointer(e.pointerType);
      const kind = kindOf(e.pointerType);
      if (kind === 'pen') penAt = e.timeStamp;
      const p = presses.get(e.pointerId);
      if (p === undefined) {
        if (kind === 'mouse' && mouse !== null && !cancelled) {
          lastTap =
            mouse.travel <= slop('mouse')
              ? { paneId, clientX: mouse.clientX, clientY: mouse.clientY, t: e.timeStamp, absorb: false }
              : null;
          if (lastTap !== null) lastClick = lastTap;
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
          if (p.second !== null) {
            // the second tap frames; a tap after it is absorbed silently and keeps the window open (C17)
            if (p.second === 'double') config.onDoubleTap(tap);
            lastTap = { paneId, clientX: p.down.clientX, clientY: p.down.clientY, t: e.timeStamp, absorb: true };
          } else if (p.palm || (p.kind === 'touch' && config.routing() === 'pencilOnly')) {
            lastTap = null;
          } else {
            lastTap = { paneId, clientX: p.down.clientX, clientY: p.down.clientY, t: e.timeStamp, absorb: false };
            if (config.onTap(tap) === 'select') {
              port.down(paneId, p.down);
              port.up(paneId, e, false);
              lastClick = lastTap;
            }
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
      if (pair !== null) port.endNavigate(pair.paneId);
      pair = null;
      lastTap = null;
      lastClick = null;
      mouse = null;
      port.pointer('mouse'); // Studio Pro's tolerances until the next event (the stage may be leaving)
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
    second: Second,
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
