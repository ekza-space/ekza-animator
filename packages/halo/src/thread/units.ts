// Settings › Time (STUDIO-TOUCH-SPEC §10.3 "Scale and units"; ST-T7-UNIT, owner 2026-10-24: frames by default): the
// unit Halo shows time in — the Thread's readout and ruler, the docked Halos' titles, an animation's Settings and the
// Curves axis (T10). *Frames* is the default; *Seconds* is the option. A per-device Halo preference in localStorage
// under `ekza-studio:halo:time:v1` (like `halo.input`, never Studio Pro's preferences): a choice someone made is kept,
// nothing stored means frames. Keys always land on whole frames whatever the unit.
import type { HaloController } from '../shell/controller';
import { storageOf } from '../shell/mirror';
import { animateUi, useAnimateUi } from '../stages/animate/ui';

export type TimeUnit = 'frames' | 'seconds';

/** ST-T7-UNIT: frames by default ("cycles are usually 50, at most 100 frames"). */
export const DEFAULT_TIME_UNIT: TimeUnit = 'frames';

export const HALO_TIME_KEY = 'ekza-studio:halo:time:v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const isUnit = (value: unknown): value is TimeUnit => value === 'frames' || value === 'seconds';

/** The stored choice, or frames (missing, malformed, blocked storage). */
export function readTimeUnit(storage: StorageLike | null): TimeUnit {
  try {
    const raw = storage?.getItem(HALO_TIME_KEY);
    return isUnit(raw) ? raw : DEFAULT_TIME_UNIT;
  } catch {
    return DEFAULT_TIME_UNIT;
  }
}

export function writeTimeUnit(storage: StorageLike | null, unit: TimeUnit): void {
  try {
    storage?.setItem(HALO_TIME_KEY, unit);
  } catch {
    // private mode, blocked storage: the choice lasts this page only
  }
}

function localOf(controller: HaloController): StorageLike | null {
  return controller.ctx.host.params.storageBlocked ? null : storageOf('local');
}

/** Reads the device's choice into the stage's UI state (the shell's start). */
export function loadTimeUnit(controller: HaloController): void {
  animateUi(controller.ctx.store).set({ units: readTimeUnit(localOf(controller)) });
}

/** Settings › Time: shows the new unit at once and remembers it on this device. */
export function setTimeUnit(controller: HaloController, unit: TimeUnit): void {
  animateUi(controller.ctx.store).set({ units: unit });
  writeTimeUnit(localOf(controller), unit);
}

export function timeUnitOf(controller: HaloController): TimeUnit {
  return animateUi(controller.ctx.store).get().units;
}

export function useTimeUnit(controller: HaloController): TimeUnit {
  return useAnimateUi(animateUi(controller.ctx.store), (s) => s.units);
}
