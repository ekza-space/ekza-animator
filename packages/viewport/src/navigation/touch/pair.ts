// Two-finger touch navigation for a shell whose single finger stays eager (AUTORIG-SPEC §8.1, §8.3; D3, AR-D3-5;
// moved from Auto-Rig and rebuilt as a stage of the ViewportManager's pointer path by STUDIO-TOUCH-SPEC §20.3 item 1,
// T1). One finger is not this stage's: its press goes on to the pipeline (the Simple override orbits on empty space,
// the tool takes the rest). A second finger in the same pane cancels the first one's gesture (a tool drag is
// cancelled, not committed; an orbit ends where it is) and the pair then pans (the midpoint) and pinch-zooms (the
// spread, towards the midpoint) through `navigate`, committed once by `endNavigate`. The manager calls a stage from
// each pane's own listeners, so the pane is the one under the fingers by DOM containment — no document listeners, no
// synthetic events — and a page has one stage, so this never runs alongside a touch shell's arbiter (T1a risk 4).
import type { ArbiterHost, ArbiterPointer, PointerArbiter, PointerArbiterStage } from '../../input/arbiter';

/** A finger: its pointer id and client position. */
export interface Finger {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

/** Below this spread change (px) a move is a pan only. */
const PINCH_EPSILON = 0.5;

const midOf = (pair: readonly [Finger, Finger]) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 });

/** One step of a two-finger gesture: the midpoint's move (pan) and the spread's dolly amount (ln of its ratio). */
export function twoFingerStep(
  before: readonly [Finger, Finger],
  after: readonly [Finger, Finger],
): { readonly mid: { readonly x: number; readonly y: number }; readonly pan: boolean; readonly dolly: number } {
  const spread = (pair: readonly [Finger, Finger]) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
  const a = midOf(before);
  const b = midOf(after);
  const s0 = spread(before);
  const s1 = spread(after);
  const dolly = s0 > 0 && s1 > 0 && Math.abs(s1 - s0) >= PINCH_EPSILON ? Math.log(s1 / s0) : 0;
  return { mid: b, pan: a.x !== b.x || a.y !== b.y, dolly };
}

/** The two-finger stage (`ViewportManager.setPointerArbiter`); fingers only, the mouse and the pen pass through. */
export function createTwoFingerStage<E extends ArbiterPointer>(): PointerArbiterStage<E> {
  return (host) => twoFingers(host);
}

function twoFingers<E extends ArbiterPointer>(host: ArbiterHost<E>): PointerArbiter<E> {
  /** Fingers down, by pointer id: their pane, their last event, and whether a pair has taken them. */
  const fingers = new Map<number, { readonly paneId: string; e: E; taken: boolean }>();
  let pair: { readonly paneId: string; at: [Finger, Finger] } | null = null;

  const end = (): void => {
    if (pair === null) return;
    host.endNavigate(pair.paneId);
    pair = null;
  };

  return {
    down(paneId, e) {
      if (e.pointerType !== 'touch') return false;
      const finger = { paneId, e, taken: false };
      fingers.set(e.pointerId, finger);
      if (pair !== null) {
        // a third finger in the pair's pane is ignored; one in another pane is its own press
        finger.taken = pair.paneId === paneId;
        return finger.taken;
      }
      const first = [...fingers.entries()].find(([id, f]) => id !== e.pointerId && f.paneId === paneId && !f.taken);
      if (first === undefined) return false; // one finger: the pipeline's
      const [id, other] = first;
      // the first finger's gesture ends (a tool drag cancelled, an orbit kept); both stay captured to the pane
      host.pipe(paneId, other.e, 'cancel');
      host.pipe(paneId, other.e, 'capture');
      host.pipe(paneId, e, 'capture');
      other.taken = true;
      finger.taken = true;
      pair = {
        paneId,
        at: [
          { id, x: other.e.clientX, y: other.e.clientY },
          { id: e.pointerId, x: e.clientX, y: e.clientY },
        ],
      };
      return true;
    },

    move(_paneId, e) {
      if (e.pointerType !== 'touch') return false;
      const finger = fingers.get(e.pointerId);
      if (finger === undefined) return false;
      finger.e = e;
      const p = pair;
      const index = p === null ? -1 : p.at.findIndex((f) => f.id === e.pointerId);
      if (p === null || index < 0) return finger.taken; // a finger a pair took stays idle until it lifts
      const before = p.at;
      const after: [Finger, Finger] = [...before];
      after[index] = { id: e.pointerId, x: e.clientX, y: e.clientY };
      p.at = after;
      const step = twoFingerStep(before, after);
      if (step.pan) {
        const from = midOf(before);
        host.navigate(p.paneId, 'pan', step.mid.x - from.x, step.mid.y - from.y);
      }
      if (step.dolly !== 0) {
        const rect = host.paneRect(p.paneId);
        const at = rect === null ? undefined : { x: step.mid.x - rect.x, y: step.mid.y - rect.y };
        host.navigate(p.paneId, 'dolly', step.dolly, 0, at);
      }
      return true;
    },

    up(_paneId, e) {
      if (e.pointerType !== 'touch') return false;
      const finger = fingers.get(e.pointerId);
      fingers.delete(e.pointerId);
      if (finger === undefined) return false;
      // a finger of the pair lifting ends the pair; the other one stays idle until it lifts
      if (pair?.at.some((f) => f.id === e.pointerId) === true) end();
      return finger.taken;
    },

    cancel() {
      end();
      for (const finger of fingers.values()) finger.taken = true;
    },

    touches() {
      return fingers.size;
    },
  };
}
