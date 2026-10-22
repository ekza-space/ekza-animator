// VRM 1.0 meta of a model-sourced character (M6B-SPEC §5.22; C10): the licence presets and the `VRMC_vrm.meta` JSON
// written from `CharacterRecord.vrm`. Pure data and functions (eager-safe: the VRM Meta dialog and `char.setVrmMeta`
// use the presets without loading the writer).
//
// Presets (an explicit choice is required, "Open — CC0" first, Q-SKIN-3): CC0 and CC BY 4.0 let everyone use,
// modify and redistribute the avatar commercially (CC BY requires credit) with the deed as `otherLicenseUrl`;
// Personal = the VRM schema defaults; Custom edits every field. The four `allow…Usage` booleans are never set by a
// preset.
import type { CharacterVrmMeta, DerivedFrom, VrmLicensePreset } from '@ekza-studio/doc';
import type { VrmcMetaJson } from './extension';

/** The VRM Public License 1.0 every VRM 1.0 meta names (§5.22). */
export const VRM_LICENSE_URL = 'https://vrm.dev/licenses/1.0/';
export const CC0_DEED_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
export const CC_BY_DEED_URL = 'https://creativecommons.org/licenses/by/4.0/';

/** The fields a licence preset sets. */
export type VrmLicenceFields = Pick<
  CharacterVrmMeta,
  'avatarPermission' | 'commercialUsage' | 'modification' | 'allowRedistribution' | 'creditNotation' | 'otherLicenseUrl'
>;

export const VRM_LICENCE_FIELDS: readonly (keyof VrmLicenceFields)[] = [
  'avatarPermission',
  'commercialUsage',
  'modification',
  'allowRedistribution',
  'creditNotation',
  'otherLicenseUrl',
];

/** The presets that set fields (Custom sets none). */
export const VRM_LICENCE_PRESETS: Readonly<Record<Exclude<VrmLicensePreset, 'custom'>, VrmLicenceFields>> = {
  cc0: {
    avatarPermission: 'everyone',
    commercialUsage: 'corporation',
    modification: 'allowModificationRedistribution',
    allowRedistribution: true,
    creditNotation: 'unnecessary',
    otherLicenseUrl: CC0_DEED_URL,
  },
  'cc-by-4.0': {
    avatarPermission: 'everyone',
    commercialUsage: 'corporation',
    modification: 'allowModificationRedistribution',
    allowRedistribution: true,
    creditNotation: 'required',
    otherLicenseUrl: CC_BY_DEED_URL,
  },
  personal: {
    avatarPermission: 'onlyAuthor',
    commercialUsage: 'personalNonProfit',
    modification: 'prohibited',
    allowRedistribution: false,
    creditNotation: 'required',
    otherLicenseUrl: '',
  },
};

/** The presets as the VRM Meta dialog lists them ("Open — CC0" first, Q-SKIN-3). */
export const VRM_LICENCE_CHOICES: readonly {
  readonly id: VrmLicensePreset;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'cc0', label: 'Open — CC0', hint: 'Anyone may use, change and sell it; no credit needed' },
  { id: 'cc-by-4.0', label: 'Open with credit — CC BY 4.0', hint: 'Anyone may use, change and sell it with credit' },
  { id: 'personal', label: 'Personal', hint: 'Only you may use it; no redistribution (the VRM defaults)' },
  { id: 'custom', label: 'Custom', hint: 'Set every permission yourself' },
];

/**
 * A meta with a patch applied: a preset in the patch sets its fields first, the patch's own fields win; editing a
 * preset-controlled field away from the preset's value (without choosing a preset) makes the licence 'custom'.
 */
export function patchVrmMeta(current: CharacterVrmMeta, patch: Partial<CharacterVrmMeta>): CharacterVrmMeta {
  const preset = patch.licensePreset;
  let next: CharacterVrmMeta = { ...current };
  if (preset !== undefined && preset !== null && preset !== 'custom') {
    next = { ...next, ...VRM_LICENCE_PRESETS[preset] };
  }
  next = { ...next, ...patch };
  if (preset === undefined && next.licensePreset !== null && next.licensePreset !== 'custom') {
    const fields = VRM_LICENCE_PRESETS[next.licensePreset];
    if (VRM_LICENCE_FIELDS.some((field) => next[field] !== fields[field])) next = { ...next, licensePreset: 'custom' };
  }
  return next;
}

/** `thirdPartyLicenses` from provenance when the meta leaves it empty (§5.22): one line per distinct source. */
export function thirdPartyLicensesOf(meta: CharacterVrmMeta, derivedFrom: readonly DerivedFrom[]): string {
  if (meta.thirdPartyLicenses.trim() !== '') return meta.thirdPartyLicenses;
  const lines = new Set<string>();
  for (const source of derivedFrom) {
    const parts = [source.title, source.author === '' ? null : `by ${source.author}`, `(${source.license})`];
    lines.add(parts.filter((part) => part !== null && part !== '').join(' '));
  }
  return [...lines].sort().join('\n');
}

/** The `VRMC_vrm.meta` of a character's meta (empty optional strings and lists are omitted). */
export function vrmcMetaOf(meta: CharacterVrmMeta, derivedFrom: readonly DerivedFrom[] = []): VrmcMetaJson {
  const text = (value: string): string | undefined => (value.trim() === '' ? undefined : value);
  const authors = meta.authors.map((author) => author.trim()).filter((author) => author !== '');
  const references = meta.references.map((reference) => reference.trim()).filter((reference) => reference !== '');
  const thirdParty = text(thirdPartyLicensesOf(meta, derivedFrom));
  const out: VrmcMetaJson = {
    name: meta.name.trim(),
    authors,
    licenseUrl: VRM_LICENSE_URL,
    avatarPermission: meta.avatarPermission,
    allowExcessivelyViolentUsage: meta.allowExcessivelyViolentUsage,
    allowExcessivelySexualUsage: meta.allowExcessivelySexualUsage,
    commercialUsage: meta.commercialUsage,
    allowPoliticalOrReligiousUsage: meta.allowPoliticalOrReligiousUsage,
    allowAntisocialOrHateUsage: meta.allowAntisocialOrHateUsage,
    creditNotation: meta.creditNotation,
    allowRedistribution: meta.allowRedistribution,
    modification: meta.modification,
  };
  const version = text(meta.version);
  const copyright = text(meta.copyrightInformation);
  const contact = text(meta.contactInformation);
  const other = text(meta.otherLicenseUrl);
  return {
    ...out,
    ...(version === undefined ? {} : { version }),
    ...(copyright === undefined ? {} : { copyrightInformation: copyright }),
    ...(contact === undefined ? {} : { contactInformation: contact }),
    ...(references.length === 0 ? {} : { references }),
    ...(thirdParty === undefined ? {} : { thirdPartyLicenses: thirdParty }),
    ...(other === undefined ? {} : { otherLicenseUrl: other }),
  };
}
