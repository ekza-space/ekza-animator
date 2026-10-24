// About this character, the model (STUDIO-TOUCH-SPEC §6.8, §6.7 `vrmMeta`, §15 rows 5.14, 11.7; T6b): every field of
// `CharacterVrmMeta` (doc/records.ts) with its current value — the character's own meta, else the schema defaults the
// VRM Meta dialog starts from (`makeVrmMeta`) — in plain words with Studio Pro's names in grey, the licence presets in
// Halo's words with none pre-selected (Q-SKIN-3), and `patchFor`, which turns one edited field into one
// `char.setVrmMeta {character, patch}` run (one undo step). A character made from a file (a VRM) keeps the file's own
// meta: it is read from the file and shown read-only with a plain note. React-free: the sheet renders it, the unit
// tests drive it headless.
import {
  type AssetId,
  type CharacterId,
  type CharacterRecord,
  type CharacterVrmMeta,
  makeVrmMeta,
  type VrmLicensePreset,
} from '@ekza-studio/doc';
import type { EditorApp, RunContext } from '@ekza-studio/editor-core';

export interface OperatorCall {
  readonly op: string;
  readonly args?: unknown;
}

export type AboutSectionId = 'identity' | 'licence' | 'usage' | 'flags' | 'thumbnail';
export type AboutFieldSection = Exclude<AboutSectionId, 'thumbnail'>;
/** The meta fields a person edits (the thumbnail is rendered, never typed). */
export type MetaField = Exclude<keyof CharacterVrmMeta, 'thumbnail'>;

export interface AboutOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

interface FieldDef {
  readonly id: MetaField;
  readonly section: AboutFieldSection;
  readonly label: string;
  /** The VRM Meta dialog's name, in grey. */
  readonly pro: string;
  /** `text` one line, `list` a comma-separated list, `longText` several lines, `choice` one of `options`, `flag` on/off. */
  readonly kind: 'text' | 'list' | 'longText' | 'choice' | 'flag';
  readonly options?: readonly AboutOption[];
  readonly hint?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
}

export interface AboutField extends FieldDef {
  /** Text (lists joined with ", "), the chosen option ('' when none) or the flag. */
  readonly value: string | boolean;
  /** A required field left empty (or no licence chosen). */
  readonly missing: boolean;
  /** Shown now (the licence link only with *Custom…* or when it holds something). */
  readonly shown: boolean;
}

export interface AboutSection {
  readonly id: AboutFieldSection;
  readonly title: string;
  readonly note?: string;
  readonly fields: readonly AboutField[];
}

export interface AboutModel {
  /** The character the sheet is about: the active one, else the first; null when there is none. */
  readonly character: {
    readonly id: CharacterId;
    readonly name: string;
    readonly source: 'model' | 'asset';
  } | null;
  /** Model-sourced characters only: an asset's meta is its file's. */
  readonly editable: boolean;
  /** A plain note above the fields (read-only, or nothing to show yet). */
  readonly note: string | null;
  readonly sections: readonly AboutSection[];
  /** The licence was chosen (sharing needs an explicit choice, Q-SKIN-3). */
  readonly licenceChosen: boolean;
  readonly thumbnail: {
    readonly asset: AssetId | null;
    /** *Render thumbnail* (`char.renderThumbnail {character}`), or null without a character. */
    readonly control:
      | (OperatorCall & { readonly label: string; readonly enabled: boolean; readonly reason: string | null })
      | null;
  };
}

/** The licence presets in Halo's words (§6.8); the order of the VRM Meta dialog. */
export const LICENCE_PRESETS: readonly (AboutOption & { readonly value: VrmLicensePreset })[] = [
  { value: 'cc0', label: 'Free for anyone (CC0)', hint: 'Anyone may use, change and sell it; no credit needed' },
  { value: 'cc-by-4.0', label: 'Credit me (CC BY 4.0)', hint: 'Anyone may use, change and sell it if they credit you' },
  { value: 'personal', label: 'Personal use only', hint: 'Only you may use it; others may not share it' },
  { value: 'custom', label: 'Custom…', hint: 'Set every permission yourself, with a link to your licence' },
];

/** Every field of `CharacterVrmMeta` but the thumbnail, in the order of §6.8 and the VRM Meta dialog. */
export const ABOUT_FIELDS: readonly FieldDef[] = [
  { id: 'name', section: 'identity', label: 'Name', pro: 'Name', kind: 'text', required: true },
  { id: 'version', section: 'identity', label: 'Version', pro: 'Version', kind: 'text', placeholder: '1.0' },
  {
    id: 'authors',
    section: 'identity',
    label: 'Made by',
    pro: 'Authors (required)',
    kind: 'list',
    placeholder: 'Your name',
    hint: 'Separate several names with commas',
    required: true,
  },
  { id: 'copyrightInformation', section: 'identity', label: 'Copyright', pro: 'Copyright', kind: 'text' },
  { id: 'contactInformation', section: 'identity', label: 'How to reach you', pro: 'Contact', kind: 'text' },
  {
    id: 'references',
    section: 'identity',
    label: 'Links',
    pro: 'References',
    kind: 'list',
    hint: 'Where it comes from or what it is based on; separate with commas',
  },
  {
    id: 'licensePreset',
    section: 'licence',
    label: 'Licence',
    pro: 'Licence preset',
    kind: 'choice',
    options: LICENCE_PRESETS,
    required: true,
  },
  {
    id: 'otherLicenseUrl',
    section: 'licence',
    label: 'Link to your licence',
    pro: 'Other licence URL',
    kind: 'text',
    placeholder: 'https://',
  },
  {
    id: 'thirdPartyLicenses',
    section: 'licence',
    label: 'Other people’s work in it',
    pro: 'Third-party licences',
    kind: 'longText',
    hint: 'Leave empty to fill it from where its parts came from',
  },
  {
    id: 'avatarPermission',
    section: 'usage',
    label: 'Who may use it as an avatar',
    pro: 'Who may use the avatar',
    kind: 'choice',
    options: [
      { value: 'onlyAuthor', label: 'Only me' },
      { value: 'onlySeparatelyLicensedPerson', label: 'People I licence separately' },
      { value: 'everyone', label: 'Everyone' },
    ],
  },
  {
    id: 'commercialUsage',
    section: 'usage',
    label: 'Commercial use',
    pro: 'Commercial use',
    kind: 'choice',
    options: [
      { value: 'personalNonProfit', label: 'Personal, non-profit' },
      { value: 'personalProfit', label: 'Personal, for profit' },
      { value: 'corporation', label: 'Companies too' },
    ],
  },
  {
    id: 'creditNotation',
    section: 'usage',
    label: 'Credit',
    pro: 'Credit',
    kind: 'choice',
    options: [
      { value: 'required', label: 'Credit me' },
      { value: 'unnecessary', label: 'No credit needed' },
    ],
  },
  {
    id: 'allowRedistribution',
    section: 'usage',
    label: 'Others may share the file',
    pro: 'Redistribution allowed',
    kind: 'flag',
  },
  {
    id: 'modification',
    section: 'usage',
    label: 'Changes by others',
    pro: 'Modification',
    kind: 'choice',
    options: [
      { value: 'prohibited', label: 'Not allowed' },
      { value: 'allowModification', label: 'Allowed' },
      { value: 'allowModificationRedistribution', label: 'Allowed, and they may share changed copies' },
    ],
  },
  {
    id: 'allowExcessivelyViolentUsage',
    section: 'flags',
    label: 'Violent use',
    pro: 'Excessively violent usage',
    kind: 'flag',
  },
  {
    id: 'allowExcessivelySexualUsage',
    section: 'flags',
    label: 'Sexual use',
    pro: 'Excessively sexual usage',
    kind: 'flag',
  },
  {
    id: 'allowPoliticalOrReligiousUsage',
    section: 'flags',
    label: 'Political or religious use',
    pro: 'Political or religious usage',
    kind: 'flag',
  },
  {
    id: 'allowAntisocialOrHateUsage',
    section: 'flags',
    label: 'Antisocial or hateful use',
    pro: 'Antisocial or hate usage',
    kind: 'flag',
  },
];

const SECTION_TITLES: Readonly<Record<AboutFieldSection, { readonly title: string; readonly note?: string }>> = {
  identity: { title: 'Who made it' },
  licence: { title: 'Licence' },
  usage: { title: 'What others may do' },
  flags: { title: 'Allowed uses', note: 'Each stays off unless you turn it on' },
};

/** A comma- or newline-separated list as the meta stores it (empty entries dropped; the VRM Meta dialog's rule). */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** The context About polls with (the sheet's controls run on the canvas's behalf). */
const ABOUT_CONTEXT: RunContext = { panel: 'viewport' };

/** The character the sheet is about: the active one, else the first live one. */
export function aboutCharacter(app: EditorApp): CharacterRecord | null {
  const live = app.store.list('characters').filter((record) => record.deleted === null);
  const active = app.session.getState().activeCharacter;
  return live.find((record) => record.id === active) ?? live[0] ?? null;
}

type Json = Readonly<Record<string, unknown>>;
const isJson = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string' && value !== ''
      ? [value]
      : [];
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const CC0_DEED = 'creativecommons.org/publicdomain/zero/1.0';
const CC_BY_DEED = 'creativecommons.org/licenses/by/4.0';

/**
 * The meta a VRM file carries, as the fields show it (VRM 1.0 `VRMC_vrm.meta`, VRM 0.x `VRM.meta`); null for a file
 * without one (a plain glTF). Read-only: it travels with the file unchanged.
 */
export function fileMeta(json: unknown, name: string): CharacterVrmMeta | null {
  if (!isJson(json)) return null;
  const extensions = isJson(json['extensions']) ? json['extensions'] : {};
  const vrm1 = isJson(extensions['VRMC_vrm']) ? extensions['VRMC_vrm'] : null;
  if (vrm1 !== null) {
    const meta = isJson(vrm1['meta']) ? vrm1['meta'] : {};
    const other = text(meta['otherLicenseUrl']);
    return makeVrmMeta(text(meta['name']) || name, {
      version: text(meta['version']),
      authors: texts(meta['authors']),
      copyrightInformation: text(meta['copyrightInformation']),
      contactInformation: text(meta['contactInformation']),
      references: texts(meta['references']),
      licensePreset: other.includes(CC0_DEED) ? 'cc0' : other.includes(CC_BY_DEED) ? 'cc-by-4.0' : null,
      avatarPermission: oneOf(
        meta['avatarPermission'],
        ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'],
        'onlyAuthor',
      ),
      commercialUsage: oneOf(
        meta['commercialUsage'],
        ['personalNonProfit', 'personalProfit', 'corporation'],
        'personalNonProfit',
      ),
      creditNotation: oneOf(meta['creditNotation'], ['required', 'unnecessary'], 'required'),
      allowRedistribution: meta['allowRedistribution'] === true,
      modification: oneOf(
        meta['modification'],
        ['prohibited', 'allowModification', 'allowModificationRedistribution'],
        'prohibited',
      ),
      allowExcessivelyViolentUsage: meta['allowExcessivelyViolentUsage'] === true,
      allowExcessivelySexualUsage: meta['allowExcessivelySexualUsage'] === true,
      allowPoliticalOrReligiousUsage: meta['allowPoliticalOrReligiousUsage'] === true,
      allowAntisocialOrHateUsage: meta['allowAntisocialOrHateUsage'] === true,
      otherLicenseUrl: other,
      thirdPartyLicenses: text(meta['thirdPartyLicenses']),
    });
  }
  const vrm0 = isJson(extensions['VRM']) ? extensions['VRM'] : null;
  if (vrm0 !== null) {
    const meta = isJson(vrm0['meta']) ? vrm0['meta'] : {};
    const licence = text(meta['licenseName']);
    const user = text(meta['allowedUserName']);
    const open = licence.startsWith('CC');
    return makeVrmMeta(text(meta['title']) || name, {
      version: text(meta['version']),
      authors: texts(meta['author']),
      contactInformation: text(meta['contactInformation']),
      references: texts(meta['reference']),
      licensePreset: licence === 'CC0' ? 'cc0' : licence === 'CC_BY' ? 'cc-by-4.0' : null,
      avatarPermission:
        user === 'Everyone'
          ? 'everyone'
          : user === 'ExplicitlyLicensedPerson'
            ? 'onlySeparatelyLicensedPerson'
            : 'onlyAuthor',
      commercialUsage: text(meta['commercialUssageName']) === 'Allow' ? 'corporation' : 'personalNonProfit',
      creditNotation: licence === 'CC0' ? 'unnecessary' : 'required',
      allowRedistribution: open,
      modification: licence === 'CC0' || licence === 'CC_BY' ? 'allowModificationRedistribution' : 'prohibited',
      allowExcessivelyViolentUsage: text(meta['violentUssageName']) === 'Allow',
      allowExcessivelySexualUsage: text(meta['sexualUssageName']) === 'Allow',
      otherLicenseUrl: text(meta['otherLicenseUrl']),
    });
  }
  return null;
}

function pollOf(app: EditorApp, op: string, args: unknown): { enabled: boolean; reason: string | null } {
  // Before the rig chunk loads its operators are not registered yet: a run loads it (the runner's lazy chunk).
  if (app.operators.get(op) === undefined) return { enabled: true, reason: null };
  try {
    const result = app.operators.poll(op, ABOUT_CONTEXT, args);
    return result === true ? { enabled: true, reason: null } : { enabled: false, reason: result.reason };
  } catch (error) {
    return { enabled: false, reason: error instanceof Error ? error.message : 'Not available' };
  }
}

function fieldValue(def: FieldDef, meta: CharacterVrmMeta): string | boolean {
  const value = meta[def.id];
  if (def.kind === 'list') return (value as readonly string[]).join(', ');
  if (def.kind === 'flag') return value === true;
  return value === null ? '' : String(value);
}

/** The sheet's model for the active character (null character: nothing to describe yet). */
export function aboutModel(app: EditorApp): AboutModel {
  const record = aboutCharacter(app);
  if (record === null) {
    return {
      character: null,
      editable: false,
      note: 'No character yet. Rig a model first; then give it a name, a maker and a licence here.',
      sections: [],
      licenceChosen: false,
      thumbnail: { asset: null, control: null },
    };
  }
  const model = record.source.kind === 'model';
  const json = model ? null : app.characters.get(record.id)?.container.json;
  const fromFile = model ? null : fileMeta(json, record.name);
  const meta = model ? (record.vrm ?? makeVrmMeta(record.name)) : (fromFile ?? makeVrmMeta(record.name));
  const sections = (['identity', 'licence', 'usage', 'flags'] as const).map(
    (id): AboutSection => ({
      id,
      ...SECTION_TITLES[id],
      fields: ABOUT_FIELDS.filter((def) => def.section === id).map((def): AboutField => {
        const value = fieldValue(def, meta);
        return {
          ...def,
          value,
          missing: def.required === true && (value === '' || value === false),
          shown: def.id !== 'otherLicenseUrl' || meta.licensePreset === 'custom' || meta.otherLicenseUrl !== '',
        };
      }),
    }),
  );
  const character = { id: record.id, name: record.name, source: model ? ('model' as const) : ('asset' as const) };
  const args = { character: record.id };
  const poll = pollOf(app, 'char.renderThumbnail', args);
  return {
    character,
    editable: model,
    note: model
      ? null
      : fromFile === null
        ? json === undefined
          ? 'This character came from a file; its details are read once the file has loaded.'
          : 'This character came from a file that carries no details of its own.'
        : 'This character came from a file with its own details. They travel with it unchanged, so they are shown here to read only.',
    sections,
    licenceChosen: meta.licensePreset !== null,
    thumbnail: {
      asset: model ? meta.thumbnail : null,
      control: {
        op: 'char.renderThumbnail',
        args,
        label: model && meta.thumbnail !== null ? 'Render again' : 'Render thumbnail',
        enabled: model && poll.enabled,
        reason: model ? poll.reason : 'Its picture comes from its file',
      },
    },
  };
}

/**
 * The `char.setVrmMeta` run that writes one edited field (one undo step), or null when the value does not fit the
 * field. Lists split at commas and new lines; an emptied name falls back to the character's own name (the VRM Meta
 * dialog's rule).
 */
export function patchFor(
  character: { readonly id: CharacterId; readonly name: string },
  field: MetaField,
  value: string | boolean,
): OperatorCall | null {
  const def = ABOUT_FIELDS.find((entry) => entry.id === field);
  if (def === undefined) return null;
  let next: unknown;
  if (def.kind === 'flag') {
    if (typeof value !== 'boolean') return null;
    next = value;
  } else if (typeof value !== 'string') {
    return null;
  } else if (def.kind === 'list') {
    next = splitList(value);
  } else if (def.kind === 'choice') {
    if (!(def.options ?? []).some((option) => option.value === value)) return null;
    next = value;
  } else if (field === 'name') {
    next = value.trim() === '' ? character.name : value.trim();
  } else {
    next = value;
  }
  return { op: 'char.setVrmMeta', args: { character: character.id, patch: { [field]: next } } };
}
