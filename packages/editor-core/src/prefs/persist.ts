// Preference persistence through `services.storage` (ARCHITECTURE §4.1): versioned JSON, every access in try/catch,
// every field validated on load (an invalid field falls back to its default, an unknown version to all defaults).
import type { TangentType } from '@ekza-animator/anim-core';
import type { KeyBinding, KeyTrigger, Prefs, PrefsStorage } from '../types';

export const PREFS_STORAGE_KEY = 'ekza-animator.prefs';
const PREFS_VERSION = 1;

const TANGENT_TYPES: readonly TangentType[] = [
  'auto',
  'autoEase',
  'autoMix',
  'spline',
  'clamped',
  'plateau',
  'linear',
  'flat',
  'step',
  'stepNext',
  'fixed',
];
const TRIGGERS: readonly KeyTrigger[] = ['press', 'tap', 'hold'];

/** Stored preferences merged over `defaults`; storage errors and unreadable values yield the defaults. */
export function loadPrefs(storage: PrefsStorage | null, defaults: Prefs): Prefs {
  if (storage === null) return defaults;
  let text: string | null;
  try {
    text = storage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return defaults;
  }
  if (text === null) return defaults;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return defaults;
  }
  return sanitizePrefs(raw, defaults);
}

/** Writes the preferences; failures (quota, blocked storage) are ignored: preferences are a convenience. */
export function savePrefs(storage: PrefsStorage | null, prefs: Prefs): void {
  if (storage === null) return;
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is unavailable or full; the session keeps working with in-memory preferences.
  }
}

/** Validates an untrusted preferences value field by field against `defaults`. */
export function sanitizePrefs(raw: unknown, defaults: Prefs): Prefs {
  if (!isRecord(raw) || raw['version'] !== PREFS_VERSION) return defaults;
  const pick = <T>(field: string, valid: (value: unknown) => value is T, fallback: T): T => {
    const value = raw[field];
    return valid(value) ? value : fallback;
  };
  const tangents = raw['defaultTangents'];
  return {
    version: 1,
    firstRunDone: pick('firstRunDone', isBoolean, defaults.firstRunDone),
    navProfile: pick('navProfile', oneOf(['maya', 'trackpad', 'mayaOneButton'] as const), defaults.navProfile),
    spaceBehaviour: pick('spaceBehaviour', oneOf(['maya', 'play'] as const), defaults.spaceBehaviour),
    keymapOverrides: Array.isArray(raw['keymapOverrides'])
      ? (raw['keymapOverrides'] as unknown[]).filter(isKeyBinding)
      : defaults.keymapOverrides,
    defaultTangents:
      isRecord(tangents) && isTangentType(tangents['in']) && isTangentType(tangents['out'])
        ? { in: tangents['in'], out: tangents['out'] }
        : defaults.defaultTangents,
    autoKey: pick('autoKey', isBoolean, defaults.autoKey),
    autoKeyMode: pick('autoKeyMode', oneOf(['keyed-only', 'all'] as const), defaults.autoKeyMode),
    graphHandles: pick('graphHandles', oneOf(['selected', 'all'] as const), defaults.graphHandles),
    moveSpace: pick('moveSpace', oneOf(['object', 'world'] as const), defaults.moveSpace),
    rotateSpace: pick('rotateSpace', oneOf(['object', 'world', 'gimbal'] as const), defaults.rotateSpace),
    reduceOnImport: pick('reduceOnImport', oneOf(['auto', 'always', 'never'] as const), defaults.reduceOnImport),
    uiScale: pick('uiScale', isUiScale, defaults.uiScale),
  };
}

export function isKeyBinding(value: unknown): value is KeyBinding {
  if (!isRecord(value) || !isRecord(value['chord'])) return false;
  const chord = value['chord'];
  const optionalBoolean = (field: string): boolean => chord[field] === undefined || typeof chord[field] === 'boolean';
  return (
    typeof chord['code'] === 'string' &&
    chord['code'].length > 0 &&
    optionalBoolean('mod') &&
    optionalBoolean('shift') &&
    optionalBoolean('alt') &&
    optionalBoolean('ctrl') &&
    typeof value['op'] === 'string' &&
    /^[^.]+\..+$/.test(value['op']) &&
    typeof value['scope'] === 'string' &&
    value['scope'].length > 0 &&
    (value['trigger'] === undefined || TRIGGERS.includes(value['trigger'] as KeyTrigger))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isTangentType(value: unknown): value is TangentType {
  return TANGENT_TYPES.includes(value as TangentType);
}

function isUiScale(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 3;
}

function oneOf<const T extends string>(values: readonly T[]): (value: unknown) => value is T {
  return (value: unknown): value is T => values.includes(value as T);
}
