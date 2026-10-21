// The display rebuild schedule of model-sourced characters (M6B-SPEC §5.1; C1, in the lazy character-runtime chunk):
// a character whose joints, skin or meshes changed has its display container rebuilt debounced (500 ms, then on idle
// with a 2 s timeout), and at once when the workspace leaves Rig & Skin or Model; the previous display stays until the
// new one is ready (the rebuild itself is the runtime registry's, `rebuild`). M6a's `workflows/meshDisplay.ts` is the
// same schedule for edited meshes of asset characters; this module shares its timers and constants.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId } from '@ekza-studio/doc';
import type { SessionStore } from '../types';
import { browserDisplayTimers, DISPLAY_DEBOUNCE_MS, DISPLAY_IDLE_TIMEOUT_MS, type DisplayTimers } from './meshDisplay';

/** Workspaces whose exit rebuilds pending displays at once (§5.1). */
const FLUSH_ON_LEAVE: ReadonlySet<string> = new Set(['rig', 'model']);

export interface CharacterDisplaySchedule {
  /** Marks a character's display stale; the rebuild runs debounced on idle (or at the next flush). */
  mark(character: CharacterId): void;
  /** Rebuilds every marked display now. */
  flush(): Promise<void>;
  /** Characters marked and not rebuilt yet. */
  readonly pending: ReadonlySet<CharacterId>;
  dispose(): void;
}

export function createCharacterDisplaySchedule(deps: {
  readonly session: SessionStore | null;
  readonly rebuild: (character: CharacterId) => Promise<void>;
  readonly timers?: DisplayTimers;
}): CharacterDisplaySchedule {
  const timers = deps.timers ?? browserDisplayTimers();
  const dirty = new Set<CharacterId>();
  let timer: unknown = null;
  let idleQueued = false;
  let disposed = false;

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    const characters = [...dirty];
    dirty.clear();
    await Promise.all(characters.map((character) => deps.rebuild(character).catch(() => {})));
  };

  const schedule = (): void => {
    if (disposed || timer !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (idleQueued) return;
      idleQueued = true;
      timers.idle(() => {
        idleQueued = false;
        if (!disposed) void flush();
      }, DISPLAY_IDLE_TIMEOUT_MS);
    }, DISPLAY_DEBOUNCE_MS);
  };

  const disposers: Disposer[] = [];
  if (deps.session !== null) {
    disposers.push(
      deps.session.subscribe((state, previous) => {
        if (state.workspace !== previous.workspace && FLUSH_ON_LEAVE.has(previous.workspace) && dirty.size > 0) {
          void flush();
        }
      }),
    );
  }

  return {
    mark(character: CharacterId): void {
      if (disposed) return;
      dirty.add(character);
      schedule();
    },
    flush,
    get pending() {
      return dirty;
    },
    dispose(): void {
      disposed = true;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      for (const dispose of disposers.splice(0)) dispose();
      dirty.clear();
    },
  };
}
