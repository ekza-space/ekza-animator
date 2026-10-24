// Ids written by builds before 2026-10-24 (DECISIONS-OPEN TM-1, TM-4). Earlier builds named a few preference and
// operator argument values, a panel kind and two key-binding scopes after third-party products or their features; they
// are still read — from saved preferences (`ekza-animator.prefs`), saved dock layouts and layout presets, option-box
// defaults, key bindings, agent calls and test-API URL parameters — and mapped to the neutral ids here, but never
// written again. This table is the only place in the source tree that spells the old ids.

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
  /**
   * Panel kinds (TM-4): the panels of saved dock layouts, focus snapshots and layout presets (`migrateLegacyPanelId`),
   * `workspace.showPanel {panel}`, `view.tool {panel}` and `view.toggleMaximize {panel}` (`LEGACY_ARGS`).
   */
  panelKind: { channelBox: 'channels' },
  /** Key-binding scopes (TM-4): a panel kind or a Rig & Skin scope, in `Prefs.keymapOverrides[].scope`. */
  keyScope: { channelBox: 'channels', 'rig.channelBox': 'rig.channels' },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

export type LegacyIdField = keyof typeof LEGACY_IDS;

/** The current id of `value` for `field`: an old id maps to its replacement, anything else passes through unchanged. */
export function migrateLegacyId(field: LegacyIdField, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const table: Readonly<Record<string, string>> = LEGACY_IDS[field];
  return Object.hasOwn(table, value) ? table[value] : value;
}

/**
 * The current id of a dock panel id: the shell names a panel after its kind (`<kind>`, or `<kind>#<n>` for a second
 * instance), so an old kind in either form maps to the new kind; any other value passes through unchanged.
 */
export function migrateLegacyPanelId(id: string): string {
  const hash = id.indexOf('#');
  const kind = hash === -1 ? id : id.slice(0, hash);
  const now = migrateLegacyId('panelKind', kind);
  return now === kind ? id : `${now as string}${id.slice(kind.length)}`;
}

/**
 * Stored preferences with their renamed enum ids mapped to the current ids (`navProfile`, `spaceBehaviour`,
 * `modeling.primitiveDefaults`, `rigging.orientPreset`, the scope and arguments of each `keymapOverrides` entry);
 * every other value, and a non-object, is returned as is.
 */
export function migrateLegacyPrefs(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = {
    ...raw,
    navProfile: migrateLegacyId('navProfile', raw['navProfile']),
    spaceBehaviour: migrateLegacyId('spaceBehaviour', raw['spaceBehaviour']),
  };
  const overrides = raw['keymapOverrides'];
  if (Array.isArray(overrides)) out['keymapOverrides'] = overrides.map(migrateLegacyBinding);
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

/** A stored key binding with a renamed scope or renamed argument ids mapped; anything else is returned as is. */
function migrateLegacyBinding(binding: unknown): unknown {
  if (!isRecord(binding)) return binding;
  const scope = migrateLegacyId('keyScope', binding['scope']);
  const args = typeof binding['op'] === 'string' ? migrateLegacyArgs(binding['op'], binding['args']) : binding['args'];
  if (scope === binding['scope'] && args === binding['args']) return binding;
  return { ...binding, scope, ...(Object.hasOwn(binding, 'args') ? { args } : {}) };
}

/** Operator arguments with renamed enum ids: operator id → argument → the field whose table maps it. */
export const LEGACY_ARGS: Readonly<Record<string, Readonly<Record<string, LegacyIdField>>>> = {
  'view.setNavProfile': { profile: 'navProfile' },
  'skel.joint.orient': { preset: 'orientPreset' },
  'skel.joint.create': { orient: 'orientPreset' },
  'workspace.showPanel': { panel: 'panelKind' },
  'view.tool': { panel: 'panelKind' },
  'view.toggleMaximize': { panel: 'panelKind' },
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
