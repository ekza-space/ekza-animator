// `CharacterVrmMeta` (M6B-SPEC §4.1, schema v4): its schema defaults, its validation and its field-by-field repair, in
// one table so the eager route carries them once (store.load validates and repairs synchronously).
import type { CharacterVrmMeta } from '../records';

type Obj = Readonly<Record<string, unknown>>;

/** The VRMC_vrm 1.0 schema defaults (`name` is the character's; no author, no licence chosen, no thumbnail). */
const DEFAULTS: CharacterVrmMeta = {
  name: '',
  version: '',
  authors: [],
  copyrightInformation: '',
  contactInformation: '',
  references: [],
  licensePreset: null,
  avatarPermission: 'onlyAuthor',
  commercialUsage: 'personalNonProfit',
  creditNotation: 'required',
  allowRedistribution: false,
  modification: 'prohibited',
  allowExcessivelyViolentUsage: false,
  allowExcessivelySexualUsage: false,
  allowPoliticalOrReligiousUsage: false,
  allowAntisocialOrHateUsage: false,
  otherLicenseUrl: '',
  thirdPartyLicenses: '',
  thumbnail: null,
};

/** Enum fields and their values (the first is the schema default); `null` allowed where listed. */
const ENUMS: Readonly<Record<string, readonly unknown[]>> = {
  licensePreset: [null, 'cc0', 'cc-by-4.0', 'personal', 'custom'],
  avatarPermission: ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'],
  commercialUsage: ['personalNonProfit', 'personalProfit', 'corporation'],
  creditNotation: ['required', 'unnecessary'],
  modification: ['prohibited', 'allowModification', 'allowModificationRedistribution'],
};

/** A VRM meta with the schema defaults, `name` given, overridable per field. */
export function makeVrmMeta(name: string, fields: Partial<CharacterVrmMeta> = {}): CharacterVrmMeta {
  return { ...DEFAULTS, name, ...fields };
}

/**
 * The meta repaired field by field to the schema defaults (`name` to `characterName`): enums known, strings, booleans,
 * arrays of strings (non-strings dropped), `thumbnail` a non-empty string or null. The same object when nothing needs
 * repair — validation is "repairs to itself".
 */
export function repairVrmMeta(value: Obj, characterName: unknown): Obj {
  const patch: Record<string, unknown> = {};
  for (const [field, fallback] of Object.entries(DEFAULTS)) {
    const v = value[field];
    const allowed = ENUMS[field];
    if (allowed !== undefined) {
      if (!allowed.includes(v)) patch[field] = fallback;
    } else if (Array.isArray(fallback)) {
      if (!Array.isArray(v)) patch[field] = [];
      else if (v.some((item) => typeof item !== 'string')) patch[field] = v.filter((item) => typeof item === 'string');
    } else if (field === 'thumbnail') {
      if (v !== null && (typeof v !== 'string' || v === '')) patch[field] = null;
    } else if (typeof v !== typeof fallback) {
      patch[field] = field === 'name' && typeof characterName === 'string' ? characterName : fallback;
    }
  }
  return Object.keys(patch).length === 0 ? value : { ...value, ...patch };
}
