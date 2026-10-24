// The Halo shell's own state (STUDIO-TOUCH-SPEC §16.1, §20.2): session-local UI state that never enters the document
// or Studio Pro's preferences — the stage, the open sheet, the open Halo, the Thumb key, toasts' inputs, the input
// settings. A small store (get / set / subscribe) read by React through `useHaloStore`; the controller mirrors part of
// it to sessionStorage (`./mirror`).
import type { ControlId } from '@ekza-studio/doc';
import type { HaloStage } from '@ekza-studio/editor-core';
import type { CompassSlot, Point, ThumbState } from '@ekza-studio/ui/touch';
import { THUMB_INITIAL } from '@ekza-studio/ui/touch';
import { useSyncExternalStore } from 'react';

/** §5.1 routing modes. */
export type Routing = 'shared' | 'pencilEdits' | 'pencilOnly';

/** Halo's input settings (`halo.input`, Settings › Input; never Pro's `navProfile`). */
export interface HaloInput {
  readonly routing: Routing;
  /**
   * §4.5, ST-11: when a tap or click opens the Halo. `auto`: every finger or Pencil tap, while a mouse click only
   * selects (right-click or ⋯ Verbs opens it); `tap`: every tap and click; `secondary`: right-click, long-press or ⋯
   * Verbs only.
   */
  readonly haloOpensOn: 'auto' | 'tap' | 'secondary';
  /** §18 Reduce gestures: no two-finger undo, quick pinch or flicks (AS-ST-9). */
  readonly reduceGestures: boolean;
  /** C5's quick pinch (frame all). */
  readonly quickPinch: boolean;
  /** §4.5: the Thumb key — shown when it means something (auto), always, or never. */
  readonly thumbKey: 'auto' | 'always' | 'never';
  /** Settings › Input › Handedness: the off-hand column on the left (right-handed) or the right. */
  readonly handedness: 'right' | 'left';
}

export const DEFAULT_INPUT: HaloInput = {
  routing: 'shared',
  haloOpensOn: 'auto',
  reduceGestures: false,
  quickPinch: true,
  thumbKey: 'auto',
  handedness: 'right',
};

/** An open Halo: a tap's arc beside the selection, or a long-press's ring around a point (pane px). */
export interface HaloOpen {
  readonly mode: 'arc' | 'ring';
  /** The press point in pane CSS px (the ring's centre; the arc's fallback anchor). */
  readonly at: Point | null;
  /** The ring's flick follow: the slot under the finger. */
  readonly hot?: CompassSlot | null;
  /** The reduced Halo beside Echo chips after a face operation (no ⋯ More, §6.1). */
  readonly reduced?: boolean;
}

/** An inline confirm card a kernel question opened (§6.7). */
export interface ConfirmCard {
  readonly dialog: string;
  readonly text: string;
  readonly yes: string;
  readonly op: string;
  readonly args: unknown;
}

/** A verb that needs a second thing (§6.4: Parent to…, Weld to…): it runs on the next tap's object. */
export interface TargetState {
  readonly label: string;
  readonly op: string;
  /** The subject's records (the selection when the verb was chosen). */
  readonly subject: readonly string[];
}

export interface LoupeState {
  readonly at: Point;
  readonly candidates: readonly { readonly id: string; readonly label: string }[];
}

export interface HaloUi {
  readonly stage: HaloStage;
  /** The open sheet ('more', 'numbers', 'scene', 'share', …), else null. */
  readonly sheet: string | null;
  readonly threadLayer: 0 | 1 | 2;
  /** §7.3: the destination (`exploring` until Share or the Rig-it card sets one). */
  readonly destination: string;
  /** §10.2: Rec (this layout's auto key), on by default; T7 applies it as a `shell` override. */
  readonly rec: boolean;
  /** Home (§17) instead of the canvas chrome. */
  readonly home: boolean;
  readonly halo: HaloOpen | null;
  /** The last canvas tap (pane px): the Halo's anchor when the selection has no box of its own. */
  readonly anchor: Point | null;
  /** Candidates under the last tap (§5.2 Next ›). */
  readonly candidates: readonly string[];
  readonly loupe: LoupeState | null;
  /** §5.2: the selection a tap on empty space cleared in Animate, restorable for 4 s. */
  readonly reselect: readonly ControlId[] | null;
  readonly palette: boolean;
  readonly projectMenu: boolean;
  /** A pre-run form (§5.6) open for this operator. */
  readonly form: { readonly op: string; readonly args?: unknown } | null;
  readonly confirm: ConfirmCard | null;
  /** §4.7 Hide UI. */
  readonly hideUi: boolean;
  /** §4.7 breathing chrome: a finger or the Pencil is down on the canvas for a drag. */
  readonly breathing: boolean;
  /** §16.1: the one line before Pro on a coarse-only device; `proLineShown` keeps it to once per session. */
  readonly proLine: boolean;
  readonly proLineShown: boolean;
  readonly thumb: ThumbState;
  /** A meaning chosen in the Thumb key's chooser (slide up), for the row it was chosen in. */
  readonly thumbPick: { readonly row: string; readonly meaning: string } | null;
  /** A hardware Shift / Cmd / Alt was seen (§4.5: the Thumb key hides in `auto`). */
  readonly hardwareModifier: boolean;
  readonly penSeen: boolean;
  readonly input: HaloInput;
  /** Touches counted since mount (journeys, AS-ST-4). */
  readonly touches: number;
  /** Coach marks already shown (§17). */
  readonly coached: readonly string[];
  /** §6.4 verb → target: the verb waits for the next tap on its target. */
  readonly target: TargetState | null;
}

export function initialUi(stage: HaloStage = 'make'): HaloUi {
  return {
    stage,
    sheet: null,
    threadLayer: 0,
    destination: 'exploring',
    rec: true,
    home: false,
    halo: null,
    anchor: null,
    candidates: [],
    loupe: null,
    reselect: null,
    palette: false,
    projectMenu: false,
    form: null,
    confirm: null,
    hideUi: false,
    breathing: false,
    proLine: false,
    proLineShown: false,
    thumb: THUMB_INITIAL,
    thumbPick: null,
    hardwareModifier: false,
    penSeen: false,
    input: DEFAULT_INPUT,
    touches: 0,
    coached: [],
    target: null,
  };
}

export interface HaloStore {
  get(): HaloUi;
  set(patch: Partial<HaloUi> | ((current: HaloUi) => Partial<HaloUi>)): void;
  subscribe(listener: (next: HaloUi, previous: HaloUi) => void): () => void;
}

export function createHaloStore(initial: HaloUi): HaloStore {
  let state = initial;
  const listeners = new Set<(next: HaloUi, previous: HaloUi) => void>();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(next) as (keyof HaloUi)[]) {
        if (!Object.is(state[key], next[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const previous = state;
      state = { ...state, ...next };
      for (const listener of Array.from(listeners)) listener(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A slice of the shell's state, re-rendering only when it changes (`Object.is`). */
export function useHaloStore<T>(store: HaloStore, select: (state: HaloUi) => T): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => select(store.get()),
    () => select(store.get()),
  );
}
