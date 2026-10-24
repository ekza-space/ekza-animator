// Preference persistence through `services.storage` (ARCHITECTURE §4.1): versioned JSON, every access in try/catch,
// every field validated on load (an invalid field falls back to its default, an unknown version to all defaults).
// Enum ids renamed since (DECISIONS-OPEN TM-1) are mapped to their current ids on load (`./legacy`); the next save
// writes the current ids. Session overrides (`./overrides`, STUDIO-TOUCH-SPEC §16.4) are never saved: a save writes
// the base preferences under them.
import type { TangentType } from '@ekza-studio/anim-core';
import type { KeyBinding, KeyTrigger, Prefs, PrefsStorage } from '../types';
import { migrateLegacyPrefs } from './legacy';
import { basePrefs } from './overrides';

/** Kept from the Ekza Animator name (DECISIONS-OPEN NAME-1) so saved preferences survive the rename. */
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

/**
 * Writes the preferences — the base of an overridden value, never its session overrides; failures (quota, blocked
 * storage) are ignored: preferences are a convenience.
 */
export function savePrefs(storage: PrefsStorage | null, prefs: Prefs): void {
  if (storage === null) return;
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(basePrefs(prefs)));
  } catch {
    // Storage is unavailable or full; the session keeps working with in-memory preferences.
  }
}

/** Validates an untrusted preferences value field by field against `defaults`. */
export function sanitizePrefs(stored: unknown, defaults: Prefs): Prefs {
  const raw = migrateLegacyPrefs(stored);
  if (!isRecord(raw) || raw['version'] !== PREFS_VERSION) return defaults;
  const pick = <T>(field: string, valid: (value: unknown) => value is T, fallback: T): T => {
    const value = raw[field];
    return valid(value) ? value : fallback;
  };
  const tangents = raw['defaultTangents'];
  return {
    version: 1,
    firstRunDone: pick('firstRunDone', isBoolean, defaults.firstRunDone),
    navProfile: pick('navProfile', oneOf(['dcc', 'trackpad', 'oneButton'] as const), defaults.navProfile),
    spaceBehaviour: pick('spaceBehaviour', oneOf(['maximize', 'play'] as const), defaults.spaceBehaviour),
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
    // M2a fields: the version stays 1; a missing or invalid field takes its default (M2A-SPEC §4.5).
    autoRigIk: pickShape(raw['autoRigIk'], defaults.autoRigIk, { legs: isBoolean, arms: isBoolean }),
    ikFkVisibility: pick('ikFkVisibility', oneOf(['hide', 'ghost'] as const), defaults.ikFkVisibility),
    ikFkSwitchKey: pick('ikFkSwitchKey', oneOf(['auto', 'none', 'key', 'seamless'] as const), defaults.ikFkSwitchKey),
    tweenOvershoot: pick('tweenOvershoot', isBoolean, defaults.tweenOvershoot),
    arrowKeys: pick('arrowKeys', oneOf(['pickWalk', 'frames'] as const), defaults.arrowKeys),
    virtualSlider: pickShape(raw['virtualSlider'], defaults.virtualSlider, {
      degPerPx: isPositive,
      metresPerPx: isPositive,
      unitsPerPx: isPositive,
      viewportMmb: isBoolean,
    }),
    exportReduce: pickShape(raw['exportReduce'], defaults.exportReduce, {
      enabled: isBoolean,
      positionM: isPositive,
      rotationCapRad: isPositive,
      minLeverM: isPositive,
      scaleRel: isPositive,
    }),
    autosave: pickShape(raw['autosave'], defaults.autosave, {
      enabled: isBoolean,
      delayMs: isNonNegative,
      maxIntervalMs: isNonNegative,
    }),
    // M6a fields (M6A-SPEC §4.6): the version stays 1; a missing or invalid field takes its default.
    lastWorkspace: pick('lastWorkspace', isWorkspaceId, defaults.lastWorkspace),
    modeling: sanitizeModeling(raw['modeling'], defaults.modeling),
    // M6b fields (M6B-SPEC §4.6): the version stays 1; a missing or invalid field takes its default.
    rigging: sanitizeRigging(raw['rigging'], defaults.rigging),
  };
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isHolds(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isStringList);
}

function sanitizeRigging(raw: unknown, defaults: Prefs['rigging']): Prefs['rigging'] {
  if (!isRecord(raw)) return defaults;
  const shaped = pickShape(raw, defaults, {
    jointSize: isPositive,
    brush: isRecord,
    influenceSort: oneOf(['alpha', 'hierarchy', 'flat'] as const),
    influenceColours: isStringRecord,
    optionDefaults: isOptionDefaults,
    orientPreset: oneOf(['world', 'xAim', 'yAim'] as const),
    holds: isHolds,
  });
  return {
    ...shaped,
    brush: pickShape(raw['brush'], defaults.brush, {
      op: oneOf(['replace', 'add', 'scale', 'smooth'] as const),
      value: isUnit,
      opacity: isUnit,
      radiusPx: isPositive,
      falloff: oneOf(['smooth', 'linear', 'constant'] as const),
      reach: oneOf(['surface', 'volume'] as const),
      frontOnly: isBoolean,
      mirror: isBoolean,
    }),
  };
}

function isUnit(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 256 && value.every((item) => typeof item === 'string');
}

function isBooleanRecord(value: unknown): value is Readonly<Record<string, boolean>> {
  return isRecord(value) && Object.values(value).every(isBoolean);
}

/** Option-box defaults: per operator id, an object of JSON values (each op re-coerces them when it reads them). */
function isOptionDefaults(value: unknown): value is Prefs['modeling']['optionDefaults'] {
  if (!isRecord(value)) return false;
  return Object.values(value).every((args) => isRecord(args) && JSON.stringify(args).length <= 65_536);
}

function sanitizeModeling(raw: unknown, defaults: Prefs['modeling']): Prefs['modeling'] {
  if (!isRecord(raw)) return defaults;
  const shaped = pickShape(raw, defaults, {
    primitiveDefaults: oneOf(['low-poly', 'dcc'] as const),
    numericCapture: oneOf(['auto', 'explicit'] as const),
    undoSelection: isBooleanRecord,
    undoBudgetMB: isPositive,
    journalBudgetMB: isPositive,
    symmetryTolerance: isPositive,
    gridStep: isPositive,
    increments: isRecord,
    vertexSnapRadiusPx: isNonNegative,
    multiCutSnapStep: isPositive,
    optionDefaults: isOptionDefaults,
    toolkitCollapsed: isStringList,
    paletteRecents: isStringList,
    convertOnModeSwitch: isBoolean,
  });
  return {
    ...shaped,
    increments: pickShape(raw['increments'], defaults.increments, {
      move: isPositive,
      rotate: isPositive,
      scale: isPositive,
    }),
  };
}

/**
 * A nested preferences object field by field: every field the validator accepts is taken from `raw`, the others
 * keep their defaults (a non-object keeps the whole default).
 */
function pickShape<T extends object>(
  raw: unknown,
  defaults: T,
  validators: { readonly [K in keyof T]: (value: unknown) => boolean },
): T {
  if (!isRecord(raw)) return defaults;
  const out = { ...defaults } as Record<string, unknown>;
  for (const field of Object.keys(validators) as (keyof T & string)[]) {
    const value = raw[field];
    if (validators[field](value)) out[field] = value;
  }
  return out as T;
}

function isPositive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
