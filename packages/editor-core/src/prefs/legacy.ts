// Ids written by builds before 2026-10-24 (DECISIONS-OPEN TM-1). Earlier builds named a few preference and operator
// argument values after third-party products; they are still read — from saved preferences (`ekza-animator.prefs`),
// option-box defaults, key bindings, agent calls and test-API URL parameters — and mapped to the neutral ids here,
// but never written again. This table is the only place in the source tree that spells the old ids.

/** Old id → current id, per field. */
export const LEGACY_IDS = {
  /** `Prefs.navProfile`, `view.setNavProfile {profile}` (`LEGACY_ARGS`), the test API's `?nav=`. */
  navProfile: { maya: 'dcc', mayaOneButton: 'oneButton' },
  /** `Prefs.spaceBehaviour`, the test API's `?space=`. */
  spaceBehaviour: { maya: 'maximize' },
  /** `Prefs.modeling.primitiveDefaults`. */
  primitiveDefaults: { maya: 'dcc' },
  /** `Prefs.rigging.orientPreset`, `skel.joint.orient {preset}`, `skel.joint.create {orient}` (`LEGACY_ARGS`). */
  orientPreset: { maya: 'xAim', blender: 'yAim' },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

export type LegacyIdField = keyof typeof LEGACY_IDS;

/** The current id of `value` for `field`: an old id maps to its replacement, anything else passes through unchanged. */
export function migrateLegacyId(field: LegacyIdField, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const table: Readonly<Record<string, string>> = LEGACY_IDS[field];
  return Object.hasOwn(table, value) ? table[value] : value;
}

/**
 * Stored preferences with their renamed enum ids mapped to the current ids (`navProfile`, `spaceBehaviour`,
 * `modeling.primitiveDefaults`, `rigging.orientPreset`); every other value, and a non-object, is returned as is.
 */
export function migrateLegacyPrefs(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = {
    ...raw,
    navProfile: migrateLegacyId('navProfile', raw['navProfile']),
    spaceBehaviour: migrateLegacyId('spaceBehaviour', raw['spaceBehaviour']),
  };
  const modeling = raw['modeling'];
  if (isRecord(modeling)) {
    out['modeling'] = {
      ...modeling,
      primitiveDefaults: migrateLegacyId('primitiveDefaults', modeling['primitiveDefaults']),
    };
  }
  const rigging = raw['rigging'];
  if (isRecord(rigging)) {
    out['rigging'] = { ...rigging, orientPreset: migrateLegacyId('orientPreset', rigging['orientPreset']) };
  }
  return out;
}

/** Operator arguments with renamed enum ids: operator id → argument → the field whose table maps it. */
export const LEGACY_ARGS: Readonly<Record<string, Readonly<Record<string, LegacyIdField>>>> = {
  'view.setNavProfile': { profile: 'navProfile' },
  'skel.joint.orient': { preset: 'orientPreset' },
  'skel.joint.create': { orient: 'orientPreset' },
};

/**
 * An operator's arguments with renamed enum ids mapped to the current ids (the runner calls it before validation, so
 * key bindings, option-box defaults, scripts and agent calls written with the old ids keep working); other operators'
 * arguments, other keys and non-objects are returned as is.
 */
export function migrateLegacyArgs(op: string, args: unknown): unknown {
  const fields = Object.hasOwn(LEGACY_ARGS, op) ? LEGACY_ARGS[op] : undefined;
  if (fields === undefined || !isRecord(args)) return args;
  let out: Record<string, unknown> | null = null;
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(args, key)) continue;
    const value = migrateLegacyId(field, args[key]);
    if (value === args[key]) continue;
    out ??= { ...args };
    out[key] = value;
  }
  return out ?? args;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
