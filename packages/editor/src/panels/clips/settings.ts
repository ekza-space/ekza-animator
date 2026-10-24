// Clip naming and settings rules of the Clips panel (MVP-SPEC §4.2 ClipRecord, §4.5 ClipSettingsArgs; ADR 0010
// §2–§5): pure functions over a string draft, so the form can validate while the user types and send
// `clip.setSettings` with exactly the fields that changed.
import type { Fps, Frame } from '@ekza-studio/anim-core';
import type { ClipRecord, DerivedFrom, Redistributable, RootMotionMode } from '@ekza-studio/doc';
import { type ClipSettingsArgs, isTargetSlotId } from '@ekza-studio/editor-core';
import { formatFixed, parseNumericInput } from '../channels/kit/kernel';

// ---------- names ----------

export const CLIP_NAME_MAX = 64;
const CLIP_NAME_CHARS = /^[A-Za-z0-9 _.-]+$/;

/**
 * Display-name rule (ClipRecord.name; ADR 0010 `ekza.unique-names`): 1–64 characters of `[A-Za-z0-9 _.-]`, unique
 * among the character's other clips ignoring case. `name` is checked as typed (callers trim first).
 */
export function validateClipName(name: string, otherNames: readonly string[]): string | null {
  if (name.length === 0) return 'A clip needs a name';
  if (name.length > CLIP_NAME_MAX) return `At most ${CLIP_NAME_MAX} characters (${name.length})`;
  if (!CLIP_NAME_CHARS.test(name)) return 'Use letters, digits, spaces and _ . - only';
  const lower = name.toLowerCase();
  if (otherNames.some((other) => other.toLowerCase() === lower)) return `Another clip is already called '${name}'`;
  return null;
}

// ---------- frame rates ----------

export const FPS_PRESETS = [24, 25, 30, 48, 50, 60] as const;

/** NTSC rates typed as decimals map to their exact rational form. */
const NTSC: readonly (readonly [number, Fps])[] = [
  [23.976, { num: 24000, den: 1001 }],
  [29.97, { num: 30000, den: 1001 }],
  [47.952, { num: 48000, den: 1001 }],
  [59.94, { num: 60000, den: 1001 }],
  [119.88, { num: 120000, den: 1001 }],
];

export const MAX_FPS = 1000;

export function fpsToNumber(fps: Fps): number {
  return fps.num / fps.den;
}

export function sameFps(a: Fps, b: Fps): boolean {
  return a.num * b.den === b.num * a.den;
}

/** A typed rate → rational fps: integers exact, NTSC decimals as n·1000/1001, others to 1/1000 of a frame. */
export function fpsFromNumber(value: number): Fps | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_FPS) return null;
  for (const [decimal, fps] of NTSC) if (Math.abs(value - decimal) < 5e-4) return fps;
  if (Number.isInteger(value)) return { num: value, den: 1 };
  const num = Math.round(value * 1000);
  if (num <= 0) return null;
  const divisor = gcd(num, 1000);
  return { num: num / divisor, den: 1000 / divisor };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** '30', '29.97', '23.976'. */
export function formatFps(fps: Fps): string {
  const value = fpsToNumber(fps);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Clip length in seconds for display: '1.0 s'. */
export function formatDuration(range: ClipRecord['range'], fps: Fps): string {
  return `${formatFixed(((range.end - range.start) * fps.den) / fps.num, 1)} s`;
}

// ---------- vocabularies ----------

/** Ekza clip slot vocabulary v1 (ADR 0010 §5); `tpose` is reserved and never offered. */
export const SLOT_VOCABULARY = [
  'idle',
  'walk',
  'run',
  'attack',
  'cast',
  'death',
  'jump',
  'hit',
  'stagger',
  'crouch',
  'fly',
  'climb',
  'swim',
  'dance',
  'wave',
  'emote',
  'celebrate',
] as const;

/** Tooltip of the root-motion select (MVP-SPEC §4.11.10 step 3 as amended by M2a fix round 1). */
export const ROOT_MOTION_HINT =
  "Hips keeps the hips' motion. In place removes the clip's travel on export (the hips' X/Z displacement from the first to the last frame, spread over the clip); sway and bob stay.";

export const ROOT_MOTION_LABEL: Readonly<Record<RootMotionMode, string>> = {
  hips: 'Hips (keep motion)',
  'in-place': 'In place (remove travel)',
};

export const REDISTRIBUTABLE_LABEL: Readonly<Record<Redistributable, string>> = {
  yes: 'Redistributable',
  no: 'Not redistributable',
  unknown: 'Unknown origin',
};

/** Licence picker presets (`DerivedFrom.license`: SPDX id, `LicenseRef-…`, `unknown` or `proprietary`). */
export const LICENSE_PRESETS = [
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'MIT',
  'Apache-2.0',
  'LicenseRef-VRM-PL-1.0',
  'proprietary',
  'unknown',
] as const;

const LICENSE_ID = /^(?:LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]*)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TAG = /^[a-z0-9_-]+$/;
export const MAX_TAGS = 8;

// ---------- the settings draft ----------

export type FpsMode = NonNullable<ClipSettingsArgs['fpsMode']>;

export interface SourceDraft {
  readonly title: string;
  readonly author: string;
  /** A preset id, or 'other' with `licenseOther`. */
  readonly license: string;
  readonly licenseOther: string;
  readonly sourceSha256: string;
}

/** Every field as the form edits it (numbers as typed text). */
export interface ClipSettingsDraft {
  /** A preset rate ('24' … '60') or 'custom'. */
  readonly fps: string;
  readonly fpsCustom: string;
  readonly fpsMode: FpsMode;
  readonly rangeStart: string;
  readonly rangeEnd: string;
  readonly sceneStart: string;
  readonly loop: boolean;
  readonly rootMotion: RootMotionMode;
  /** '' = no slot. */
  readonly slot: string;
  /** '' = no contact frame. */
  readonly contact: string;
  /** Comma- or space-separated. */
  readonly tags: string;
  readonly sources: readonly SourceDraft[];
  readonly redistributable: Redistributable;
}

export type DraftField =
  | 'fps'
  | 'rangeStart'
  | 'rangeEnd'
  | 'sceneStart'
  | 'slot'
  | 'contact'
  | 'tags'
  | `source.${number}.${'title' | 'license' | 'sourceSha256'}`;

export function sourceDraft(from: DerivedFrom): SourceDraft {
  const preset = (LICENSE_PRESETS as readonly string[]).includes(from.license);
  return {
    title: from.title,
    author: from.author,
    license: preset ? from.license : 'other',
    licenseOther: preset ? '' : from.license,
    sourceSha256: from.sourceSha256 ?? '',
  };
}

export const EMPTY_SOURCE: SourceDraft = {
  title: '',
  author: '',
  license: 'unknown',
  licenseOther: '',
  sourceSha256: '',
};

export function draftFromClip(clip: ClipRecord): ClipSettingsDraft {
  const fps = fpsToNumber(clip.fps);
  const preset = clip.fps.den === 1 && (FPS_PRESETS as readonly number[]).includes(fps);
  return {
    fps: preset ? String(fps) : 'custom',
    fpsCustom: formatFps(clip.fps),
    fpsMode: 'keep-seconds',
    rangeStart: String(clip.range.start),
    rangeEnd: String(clip.range.end),
    sceneStart: String(clip.sceneStart),
    loop: clip.loop,
    rootMotion: clip.rootMotion,
    slot: clip.slot ?? '',
    contact: clip.contact === null ? '' : String(clip.contact),
    tags: clip.tags.join(', '),
    sources: clip.provenance.derivedFrom.map(sourceDraft),
    redistributable: clip.provenance.redistributable,
  };
}

export interface DraftCheck {
  /** Problems by field; empty when the draft is valid. */
  readonly errors: Readonly<Partial<Record<DraftField, string>>>;
  /** `clip.setSettings` args with the changed fields only; null when invalid or unchanged. */
  readonly args: ClipSettingsArgs | null;
  /** The draft's frame rate is valid and differs from the clip's (the keep-seconds / keep-frames choice applies). */
  readonly fpsChanged: boolean;
}

/** Splits tag text into lowercase tags (duplicates dropped); a reason when a tag breaks the rules. */
export function parseTags(text: string): { readonly tags: readonly string[] } | { readonly error: string } {
  const tags: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.toLowerCase();
    if (tag === '' || tags.includes(tag)) continue;
    if (!TAG.test(tag)) return { error: `'${raw}': tags use a–z, 0–9, _ and - only` };
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { error: `At most ${MAX_TAGS} tags (${tags.length})` };
  return { tags };
}

/** Validates the draft against the clip it edits and lists the changed fields as `clip.setSettings` args. */
export function checkDraft(clip: ClipRecord, draft: ClipSettingsDraft): DraftCheck {
  const errors: Partial<Record<DraftField, string>> = {};

  let fps: Fps | null = null;
  if (draft.fps === 'custom') {
    const value = parseNumericInput(draft.fpsCustom, fpsToNumber(clip.fps));
    fps = value === null ? null : fpsFromNumber(value);
    if (fps === null) errors.fps = `Frame rate must be a number above 0 and at most ${MAX_FPS}`;
  } else {
    fps = fpsFromNumber(Number(draft.fps));
    if (fps === null) errors.fps = 'Pick a frame rate';
  }

  const frame = (text: string, current: Frame, field: DraftField, what: string): number | null => {
    const value = parseNumericInput(text, current);
    if (value === null) errors[field] = `${what} must be a number`;
    else if (!Number.isInteger(value)) errors[field] = `${what} must be a whole frame`;
    else return value;
    return null;
  };
  const start = frame(draft.rangeStart, clip.range.start, 'rangeStart', 'Start');
  const end = frame(draft.rangeEnd, clip.range.end, 'rangeEnd', 'End');
  if (start !== null && end !== null && start >= end) errors.rangeEnd = 'End must be after the start';

  const sceneStart = parseNumericInput(draft.sceneStart, clip.sceneStart);
  if (sceneStart === null) errors.sceneStart = 'Scene start must be a number';

  let contact: number | null = null;
  if (draft.contact.trim() !== '') {
    contact = frame(draft.contact, clip.contact ?? clip.range.start, 'contact', 'Contact frame');
    if (contact !== null && start !== null && end !== null && (contact < start || contact > end)) {
      errors.contact = `Contact frame must lie in ${start}–${end}`;
    }
  }

  // CHARACTER-CONTRACT-SPEC §8.2: a target slot (a dotted id, set from the Target panel) is kept as it is.
  const keptTargetSlot = draft.slot === clip.slot && isTargetSlotId(draft.slot);
  if (draft.slot !== '' && !keptTargetSlot && !(SLOT_VOCABULARY as readonly string[]).includes(draft.slot)) {
    errors.slot = `'${draft.slot}' is not an Ekza slot`;
  }

  const parsedTags = parseTags(draft.tags);
  if ('error' in parsedTags) errors.tags = parsedTags.error;

  const derivedFrom: DerivedFrom[] = [];
  draft.sources.forEach((source, i) => {
    const title = source.title.trim();
    if (title === '') errors[`source.${i}.title`] = 'A source needs a title';
    const license = source.license === 'other' ? source.licenseOther.trim() : source.license;
    if (!LICENSE_ID.test(license)) errors[`source.${i}.license`] = 'Use an SPDX id or LicenseRef-…';
    const sha = source.sourceSha256.trim().toLowerCase();
    if (sha !== '' && !SHA256.test(sha)) errors[`source.${i}.sourceSha256`] = 'A SHA-256 is 64 hex digits';
    derivedFrom.push({ title, author: source.author.trim(), license, sourceSha256: sha === '' ? null : sha });
  });

  const fpsChanged = fps !== null && !sameFps(fps, clip.fps);
  if (Object.keys(errors).length > 0 || fps === null || start === null || end === null || sceneStart === null) {
    return { errors, args: null, fpsChanged };
  }
  const tags = 'tags' in parsedTags ? parsedTags.tags : clip.tags;

  const args: { -readonly [K in keyof ClipSettingsArgs]: ClipSettingsArgs[K] } = { clip: clip.id };
  if (fpsChanged) {
    args.fps = fps;
    args.fpsMode = draft.fpsMode;
  }
  if (start !== clip.range.start || end !== clip.range.end) args.range = { start, end };
  if (sceneStart !== clip.sceneStart) args.sceneStart = sceneStart;
  if (draft.loop !== clip.loop) args.loop = draft.loop;
  if (draft.rootMotion !== clip.rootMotion) args.rootMotion = draft.rootMotion;
  const slot = draft.slot === '' ? null : draft.slot;
  if (slot !== clip.slot) args.slot = slot;
  if (contact !== clip.contact) args.contact = contact;
  if (!sameList(tags, clip.tags)) args.tags = tags;
  const provenance: { derivedFrom?: readonly DerivedFrom[]; redistributable?: Redistributable } = {};
  if (!sameSources(derivedFrom, clip.provenance.derivedFrom)) provenance.derivedFrom = derivedFrom;
  if (draft.redistributable !== clip.provenance.redistributable) provenance.redistributable = draft.redistributable;
  if (Object.keys(provenance).length > 0) args.provenance = provenance;

  return { errors, args: Object.keys(args).length > 1 ? args : null, fpsChanged };
}

/** Licences under which a derived clip is not obviously redistributable (no derivatives, unknown, proprietary). */
function doubtfulLicence(license: string): boolean {
  return license === 'unknown' || license === 'proprietary' || /-ND(?:-|$)/.test(license);
}

/**
 * A soft check that never blocks Apply (FR-CLIP-09): the draft marks the clip redistributable while a source's
 * licence does not obviously allow it. Export profiles judge provenance for real (ADR 0010 `non-redistributable`).
 */
export function redistributionHint(draft: ClipSettingsDraft): string | null {
  if (draft.redistributable !== 'yes') return null;
  const doubtful = draft.sources
    .map((source, i) => ({ i, license: source.license === 'other' ? source.licenseOther.trim() : source.license }))
    .filter(({ license }) => doubtfulLicence(license));
  if (doubtful.length === 0) return null;
  const list = doubtful.map(({ i, license }) => `source ${i + 1} is ${license}`).join(', ');
  return `Marked redistributable, but ${list}: check that you may share clips made from it.`;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function sameSources(a: readonly DerivedFrom[], b: readonly DerivedFrom[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        y !== undefined &&
        x.title === y.title &&
        x.author === y.author &&
        x.license === y.license &&
        x.sourceSha256 === y.sourceSha256
      );
    })
  );
}
