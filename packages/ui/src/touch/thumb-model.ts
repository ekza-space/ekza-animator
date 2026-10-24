// The Thumb key's state (STUDIO-TOUCH-SPEC §5.5): it works like a touch keyboard's Shift key. Tap: the meaning
// applies to the next action only, then turns off. Double-tap: locked until tapped again. Hold: active while the
// thumb stays down. Slide up: the chooser with the other meanings that apply here. Pure; the component feeds it.
import { TOUCH } from './constants';

export type ThumbLatch = 'off' | 'once' | 'locked' | 'held';

export interface ThumbState {
  readonly latch: ThumbLatch;
  /** The latch before the current press (a press shows `held` while down). */
  readonly before: ThumbLatch;
  readonly pressedAt: number | null;
  /** Time of the last tap that set `once` (for the double-tap). */
  readonly onceAt: number | null;
  /** True once the held key was used by an action, or held past the long-press time: release turns it off. */
  readonly used: boolean;
  readonly chooser: boolean;
}

export type ThumbEvent =
  | { readonly type: 'press'; readonly time: number }
  | { readonly type: 'release'; readonly time: number }
  | { readonly type: 'slideUp' }
  | { readonly type: 'closeChooser' }
  /** The next tap or drag on the canvas used the meaning: `once` turns off, `held` stays until release. */
  | { readonly type: 'consume' }
  | { readonly type: 'cancel' }
  /** Keyboard: Space / Enter on the focused key act as a tap. */
  | { readonly type: 'key'; readonly time: number };

export const THUMB_INITIAL: ThumbState = {
  latch: 'off',
  before: 'off',
  pressedAt: null,
  onceAt: null,
  used: false,
  chooser: false,
};

function tap(state: ThumbState, before: ThumbLatch, time: number): ThumbState {
  if (before === 'locked') return { ...state, latch: 'off', before: 'off', pressedAt: null, onceAt: null };
  if (before === 'once' && state.onceAt !== null && time - state.onceAt <= TOUCH.doubleTapMs) {
    return { ...state, latch: 'locked', before: 'locked', pressedAt: null, onceAt: null };
  }
  if (before === 'once') return { ...state, latch: 'off', before: 'off', pressedAt: null, onceAt: null };
  return { ...state, latch: 'once', before: 'once', pressedAt: null, onceAt: time };
}

export function thumbReduce(state: ThumbState, event: ThumbEvent): ThumbState {
  switch (event.type) {
    case 'press':
      return { ...state, before: state.latch, latch: 'held', pressedAt: event.time, used: false };
    case 'release': {
      if (state.pressedAt === null) return state;
      if (state.chooser) return { ...state, latch: state.before, pressedAt: null };
      const long = event.time - state.pressedAt >= TOUCH.longPressMs;
      if (state.used || long)
        return { ...state, latch: 'off', before: 'off', pressedAt: null, onceAt: null, used: false };
      return tap(state, state.before, event.time);
    }
    case 'key':
      return tap(state, state.latch, event.time);
    case 'slideUp':
      return { ...state, chooser: true };
    case 'closeChooser':
      return { ...state, chooser: false };
    case 'consume':
      if (state.latch === 'once') return { ...state, latch: 'off', before: 'off', onceAt: null };
      if (state.latch === 'held') return { ...state, used: true };
      return state;
    case 'cancel':
      return state.pressedAt === null ? state : { ...state, latch: state.before, pressedAt: null };
    default:
      return state;
  }
}

/** True while the meaning applies to the next tap or drag. */
export const thumbActive = (state: ThumbState): boolean => state.latch !== 'off';
