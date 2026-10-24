// The session mirror (STUDIO-TOUCH-SPEC §16.1, following `autorig/session`): Halo's shell-local state in
// sessionStorage under `ekza-studio:halo:session:v1` — stage, open sheet, Thread layer, the Thumb key's lock,
// destination, Rec — so a reload or a round trip through Pro comes back to the same place. The input settings
// (`halo.input`, §5.1) are a per-device preference in localStorage, never in Pro's prefs. Reads and writes never throw
// (private mode, blocked storage).
import type { HaloStage } from '@ekza-studio/editor-core';
import { HALO_STAGES } from './stage';
import { DEFAULT_INPUT, type HaloInput, type HaloUi } from './store';

export const HALO_SESSION_KEY = 'ekza-studio:halo:session:v1';
export const HALO_INPUT_KEY = 'ekza-studio:halo:input:v1';

export interface SessionMirror {
  readonly stage: HaloStage;
  readonly sheet: string | null;
  readonly threadLayer: 0 | 1 | 2;
  readonly thumbLocked: boolean;
  readonly destination: string;
  readonly rec: boolean;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function storageOf(kind: 'session' | 'local'): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

const isStage = (value: unknown): value is HaloStage => (HALO_STAGES as readonly unknown[]).includes(value);

/** The mirror of a previous page of this tab, or null (missing, malformed, another version). */
export function readMirror(storage: StorageLike | null): SessionMirror | null {
  try {
    const raw = storage?.getItem(HALO_SESSION_KEY);
    if (raw === null || raw === undefined) return null;
    const value = JSON.parse(raw) as Partial<SessionMirror>;
    if (!isStage(value.stage)) return null;
    return {
      stage: value.stage,
      sheet: typeof value.sheet === 'string' ? value.sheet : null,
      threadLayer: value.threadLayer === 1 || value.threadLayer === 2 ? value.threadLayer : 0,
      thumbLocked: value.thumbLocked === true,
      destination: typeof value.destination === 'string' ? value.destination : 'exploring',
      rec: value.rec !== false,
    };
  } catch {
    return null;
  }
}

export function mirrorOf(ui: HaloUi): SessionMirror {
  return {
    stage: ui.stage,
    sheet: ui.sheet,
    threadLayer: ui.threadLayer,
    thumbLocked: ui.thumb.latch === 'locked',
    destination: ui.destination,
    rec: ui.rec,
  };
}

export function writeMirror(storage: StorageLike | null, mirror: SessionMirror): void {
  try {
    storage?.setItem(HALO_SESSION_KEY, JSON.stringify(mirror));
  } catch {
    // storage full or blocked: the mirror is a convenience
  }
}

/** The input settings of this device (defaults for anything missing or malformed). */
export function readInput(storage: StorageLike | null): HaloInput {
  try {
    const raw = storage?.getItem(HALO_INPUT_KEY);
    if (raw === null || raw === undefined) return DEFAULT_INPUT;
    const v = JSON.parse(raw) as Partial<HaloInput>;
    return {
      routing: v.routing === 'pencilEdits' || v.routing === 'pencilOnly' ? v.routing : 'shared',
      haloOpensOn: v.haloOpensOn === 'secondary' || v.haloOpensOn === 'tap' ? v.haloOpensOn : 'auto',
      reduceGestures: v.reduceGestures === true,
      quickPinch: v.quickPinch !== false,
      thumbKey: v.thumbKey === 'always' || v.thumbKey === 'never' ? v.thumbKey : 'auto',
      handedness: v.handedness === 'left' ? 'left' : 'right',
    };
  } catch {
    return DEFAULT_INPUT;
  }
}

export function writeInput(storage: StorageLike | null, input: HaloInput): void {
  try {
    storage?.setItem(HALO_INPUT_KEY, JSON.stringify(input));
  } catch {
    // blocked: the setting lasts for this page
  }
}
