// The Animate stage's own UI state (STUDIO-TOUCH-SPEC §10.3, §10.6; T7): which Thread noun's Halo is docked above the
// Thread (a key dot, the key band, the playhead, an animation chip), the *+ New* card, the expanded transport, an
// open ▾ menu, a rename in progress, the ⋯ More of a docked noun and the Library's open card. Session-local, never in
// the document or the preferences; one store per mounted shell (keyed by the shell's store).
import type { ClipId } from '@ekza-studio/doc';
import { useSyncExternalStore } from 'react';
import type { HaloStore } from '../../shell/store';

/** A Thread noun whose Halo is docked (§6.1: in the Thread, the Halo docks; it never floats over the keys). */
export type DockNoun =
  | { readonly kind: 'keyDot'; readonly frame: number }
  | { readonly kind: 'band' }
  | { readonly kind: 'playhead' }
  | { readonly kind: 'clip'; readonly clip: ClipId };

export interface AnimateUi {
  readonly docked: DockNoun | null;
  /** A ▾ petal's choices, open under the docked Halo. */
  readonly menu: string | null;
  /** ⋯ More of the docked noun. */
  readonly more: DockNoun | null;
  /** Numbers of the docked noun (an animation's *Settings*: its clip section). */
  readonly numbers: DockNoun | null;
  /** *+ New*'s card (name and length). */
  readonly newCard: boolean;
  /** The expanded transport (tap the time readout, §10.3). */
  readonly transport: boolean;
  /** ▶'s long-press menu (repeat, once, ping-pong, backwards). */
  readonly playMenu: boolean;
  /** The `+n` chip's list of every animation. */
  readonly allClips: boolean;
  /** An animation being renamed (its Halo's *Rename*). */
  readonly renaming: ClipId | null;
  /** The Library card that is expanded (Speed, Trim, Swap sides, Stay in place, Arms out). */
  readonly libraryCard: string | null;
}

export const INITIAL_ANIMATE_UI: AnimateUi = {
  docked: null,
  menu: null,
  more: null,
  numbers: null,
  newCard: false,
  transport: false,
  playMenu: false,
  allClips: false,
  renaming: null,
  libraryCard: null,
};

export interface AnimateUiStore {
  get(): AnimateUi;
  set(patch: Partial<AnimateUi>): void;
  subscribe(listener: () => void): () => void;
}

const stores = new WeakMap<HaloStore, AnimateUiStore>();

/** The Animate stage's UI store of a mounted shell. */
export function animateUi(shell: HaloStore): AnimateUiStore {
  let store = stores.get(shell);
  if (store === undefined) {
    let state = INITIAL_ANIMATE_UI;
    const listeners = new Set<() => void>();
    store = {
      get: () => state,
      set(patch) {
        const keys = Object.keys(patch) as (keyof AnimateUi)[];
        if (keys.every((key) => Object.is(state[key], patch[key]))) return;
        state = { ...state, ...patch };
        for (const listener of Array.from(listeners)) listener();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    stores.set(shell, store);
  }
  return store;
}

/** A slice of the Animate UI state (`Object.is`-stable selectors only). */
export function useAnimateUi<T>(store: AnimateUiStore, select: (state: AnimateUi) => T): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => select(store.get()),
    () => select(store.get()),
  );
}

/** Closes every transient surface of the stage (a stage switch, a sheet, Pro). */
export function closeAnimateSurfaces(store: AnimateUiStore): void {
  store.set({
    docked: null,
    menu: null,
    more: null,
    numbers: null,
    newCard: false,
    transport: false,
    playMenu: false,
    allClips: false,
  });
}
