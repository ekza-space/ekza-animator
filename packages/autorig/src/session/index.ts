// The Auto-Rig session store (AUTORIG-SPEC §4.3; D3): the wizard's U state (never in the document, never an undo
// step) in a small external store the shell and its steps subscribe to. It stores and mirrors slices generically —
// `patch(slice, partial)`; each slice's reducers live in its step's directory — and mirrors the step, the subject,
// the intake, the start pose and the five slices to `sessionStorage['ekza-studio:autorig:v1']`, so a reload in the same
// tab returns to the same step once the document is back (every access in try/catch; blocked storage skips it).
import { ANIMATIONS_SLICE } from '../steps/animations';
import { EXPORT_SLICE } from '../steps/export';
import { MARKERS_SLICE } from '../steps/markers';
import { MODEL_SLICE } from '../steps/model';
import { RIG_SLICE } from '../steps/rig';
import {
  AUTORIG_SESSION_KEY,
  AUTORIG_STEPS,
  type AutoRigSession,
  type AutoRigSliceName,
  type AutoRigSlices,
} from '../types';

/** A fresh session: step ①, no subject, no intake, no start pose, every slice at its owner's default. */
export function defaultAutoRigSession(): AutoRigSession {
  return {
    step: 'model',
    subject: { character: null, meshes: [] },
    intake: null,
    startPose: null,
    nav: null,
    busy: null,
    model: MODEL_SLICE,
    markers: MARKERS_SLICE,
    rig: RIG_SLICE,
    animations: ANIMATIONS_SLICE,
    export: EXPORT_SLICE,
  };
}

/** The session's own fields (everything but the slices). */
export type AutoRigSessionFields = Omit<AutoRigSession, AutoRigSliceName>;

export interface AutoRigSessionStore {
  getState(): AutoRigSession;
  subscribe(listener: () => void): () => void;
  /** Sets session fields (step, subject, intake, startPose, nav, busy). */
  set(partial: Partial<AutoRigSessionFields>): void;
  /** Merges `partial` into one slice (the generic write every step's reducers use). */
  patch<K extends AutoRigSliceName>(slice: K, partial: Partial<AutoRigSlices[K]>): void;
  /** A new subject: every slice back to its default, no intake, no start pose (the step and nav stay). */
  resetSubject(subject: AutoRigSession['subject']): void;
  /** Replaces the whole session (an arrival restoring the mirror or a handoff record). */
  load(next: AutoRigSession): void;
}

/** Where the mirror goes: the tab's `sessionStorage`, or null (blocked storage, Node). */
export type MirrorStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;

export function sessionStorageOf(): MirrorStorage {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const SLICES: readonly AutoRigSliceName[] = ['model', 'markers', 'rig', 'animations', 'export'];

/** What the mirror holds (§4.3): the step, the subject, the intake, the start pose and the five slices. */
export type SessionMirror = Pick<AutoRigSession, 'step' | 'subject' | 'intake' | 'startPose' | AutoRigSliceName>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The mirrored session merged over the defaults (each slice field by field), or null when absent or unreadable. */
export function readSessionMirror(storage: MirrorStorage): SessionMirror | null {
  if (storage === null) return null;
  let raw: unknown;
  try {
    const text = storage.getItem(AUTORIG_SESSION_KEY);
    if (text === null) return null;
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || !(AUTORIG_STEPS as readonly unknown[]).includes(raw['step'])) return null;
  const base = defaultAutoRigSession();
  const subject = isObject(raw['subject']) ? raw['subject'] : {};
  const meshes = Array.isArray(subject['meshes']) ? subject['meshes'].filter((id) => typeof id === 'string') : [];
  const startPose = isObject(raw['startPose']) ? raw['startPose'] : null;
  const mirror: Record<string, unknown> = {
    step: raw['step'],
    subject: {
      character: typeof subject['character'] === 'string' ? subject['character'] : null,
      meshes,
    },
    intake: isObject(raw['intake']) ? raw['intake'] : null,
    startPose:
      startPose !== null &&
      typeof startPose['armAngle'] === 'number' &&
      (startPose['kind'] === 't' || startPose['kind'] === 'a')
        ? { armAngle: startPose['armAngle'], kind: startPose['kind'] }
        : null,
  };
  for (const slice of SLICES) {
    const value = raw[slice];
    mirror[slice] = isObject(value) ? { ...base[slice], ...value } : base[slice];
  }
  return mirror as unknown as SessionMirror;
}

export function writeSessionMirror(storage: MirrorStorage, session: AutoRigSession): void {
  if (storage === null) return;
  const mirror: SessionMirror = {
    step: session.step,
    subject: session.subject,
    intake: session.intake,
    startPose: session.startPose,
    model: session.model,
    markers: session.markers,
    rig: session.rig,
    animations: session.animations,
    export: session.export,
  };
  try {
    storage.setItem(AUTORIG_SESSION_KEY, JSON.stringify(mirror));
  } catch {
    // quota or blocked: the mirror is a convenience (§6.3)
  }
}

export function clearSessionMirror(storage: MirrorStorage): void {
  try {
    storage?.removeItem(AUTORIG_SESSION_KEY);
  } catch {
    // blocked storage
  }
}

/** A session store over `initial`, mirrored to `storage` on every change (null: no mirror). */
export function createAutoRigSessionStore(
  initial: AutoRigSession = defaultAutoRigSession(),
  storage: MirrorStorage = null,
): AutoRigSessionStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const commit = (next: AutoRigSession): void => {
    if (next === state) return;
    state = next;
    writeSessionMirror(storage, next);
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(partial) {
      const keys = Object.keys(partial) as (keyof AutoRigSessionFields)[];
      if (keys.every((key) => Object.is(state[key], partial[key]))) return;
      commit({ ...state, ...partial });
    },
    patch(slice, partial) {
      const current = state[slice] as unknown as Readonly<Record<string, unknown>>;
      const fields = partial as Readonly<Record<string, unknown>>;
      if (Object.keys(fields).every((key) => Object.is(current[key], fields[key]))) return;
      commit({ ...state, [slice]: { ...current, ...partial } });
    },
    load(next) {
      commit(next);
    },
    resetSubject(subject) {
      const base = defaultAutoRigSession();
      commit({
        ...state,
        subject,
        intake: null,
        startPose: null,
        model: base.model,
        markers: base.markers,
        rig: base.rig,
        animations: base.animations,
        export: base.export,
      });
    },
  };
}
