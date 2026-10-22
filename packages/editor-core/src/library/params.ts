// Clip parameters on the editor side (AUTORIG-SPEC §5.5.3, §5.5.4; D5): the identity, the argument check of
// `library.preview` / `library.useClip` / `autorig.clip.add`, and the `ar-*` clip tags that record the parameters of a
// parametrized Use Clip in the shipped `ClipRecord.tags` vocabulary (`[a-z0-9_-]`, ≤ 32 characters, ≤ 8 tags; no
// schema change). Pure and tiny: part of the clip-library chunk (and of the rig-workspace chunk, for the
// composition's poll); the parameters themselves are applied by io's `deriveHumanoidVrma` through the import path.
//
// Tags: `ar-<library id>`, `ar-speed-<percent>`, `ar-trim-<startMs>-<endMs>`, `ar-mirror`, `ar-inplace`,
// `ar-arms-<deg>` (`m` for minus: `ar-arms-m10`). Written only for parameters that are not the identity, so a Use
// Clip with identity parameters is C12's Use Clip exactly.
import type { ClipParams } from '../types';

export const IDENTITY_CLIP_PARAMS: ClipParams = Object.freeze({
  speed: 1,
  trim: null,
  mirror: false,
  inPlace: false,
  armSpace: 0,
});

/** The ranges of §5.5.3 (speed in steps of 0.05, arm space in whole degrees in the UI). */
export const CLIP_PARAM_LIMITS = { speed: { min: 0.25, max: 3 }, armSpace: { min: -10, max: 30 } } as const;

/** True for the identity parameters (a trim that covers the whole clip is not detected here: no duration). */
export function isIdentityParams(params: ClipParams | undefined): boolean {
  return (
    params === undefined ||
    (params.speed === 1 && params.trim === null && !params.mirror && !params.inPlace && params.armSpace === 0)
  );
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Why `params` is not a valid `ClipParams`, or null (the trim against the clip's length is io's check). */
export function clipParamsProblem(params: unknown): string | null {
  if (!isObject(params)) return 'params must be { speed, trim, mirror, inPlace, armSpace }';
  const { speed, trim, mirror, inPlace, armSpace } = params;
  const { speed: s, armSpace: a } = CLIP_PARAM_LIMITS;
  if (typeof speed !== 'number' || !(speed >= s.min && speed <= s.max)) return `speed must be ${s.min} … ${s.max}`;
  if (typeof mirror !== 'boolean' || typeof inPlace !== 'boolean') return 'mirror and inPlace must be booleans';
  if (typeof armSpace !== 'number' || !(armSpace >= a.min && armSpace <= a.max)) {
    return `armSpace must be ${a.min} … ${a.max} degrees`;
  }
  if (trim !== null) {
    if (!isObject(trim) || typeof trim['start'] !== 'number' || typeof trim['end'] !== 'number') {
      return 'trim must be null or { start, end } in seconds';
    }
    if (!(trim['start'] >= 0 && trim['end'] > trim['start'])) return 'trim needs 0 ≤ start < end';
  }
  return null;
}

const TAG = 'ar-';
const signed = (value: number): string => (value < 0 ? `m${Math.abs(value)}` : `${value}`);
const unsigned = (text: string): number => (text.startsWith('m') ? -Number(text.slice(1)) : Number(text));

/**
 * The `ar-*` tags of a parametrized Use Clip of library clip `clip` (§5.5.4): the library id first, then one tag per
 * parameter that is not the identity's. Empty for identity parameters (C12's Use Clip writes no tags).
 */
export function clipParamTags(clip: string, params: ClipParams): string[] {
  if (isIdentityParams(params)) return [];
  const tags = [`${TAG}${clip}`];
  if (params.speed !== 1) tags.push(`${TAG}speed-${Math.round(params.speed * 100)}`);
  if (params.trim !== null) {
    tags.push(`${TAG}trim-${Math.round(params.trim.start * 1000)}-${Math.round(params.trim.end * 1000)}`);
  }
  if (params.mirror) tags.push(`${TAG}mirror`);
  if (params.inPlace) tags.push(`${TAG}inplace`);
  if (params.armSpace !== 0) tags.push(`${TAG}arms-${signed(Math.round(params.armSpace))}`);
  return tags;
}

/** True for a tag this vocabulary writes (the clip's other tags are kept as they are). */
export const isClipParamTag = (tag: string): boolean => tag.startsWith(TAG);

/**
 * The library clip and parameters recorded by `clipParamTags` (null when the tags hold no `ar-<library id>`). The
 * Auto-Rig shell reads them with its own copy of this table (`autorig/src/steps/animations/tags.ts`): both are pinned
 * by the same examples in their tests.
 */
export function clipParamsFromTags(tags: readonly string[]): { clip: string; params: ClipParams } | null {
  let clip: string | null = null;
  let speed = 1;
  let trim: ClipParams['trim'] = null;
  let mirror = false;
  let inPlace = false;
  let armSpace = 0;
  for (const tag of tags) {
    if (!tag.startsWith(TAG)) continue;
    const body = tag.slice(TAG.length);
    let match: RegExpExecArray | null;
    if ((match = /^speed-(\d+)$/.exec(body)) !== null) speed = Number(match[1]) / 100;
    else if ((match = /^trim-(\d+)-(\d+)$/.exec(body)) !== null) {
      trim = { start: Number(match[1]) / 1000, end: Number(match[2]) / 1000 };
    } else if (body === 'mirror') mirror = true;
    else if (body === 'inplace') inPlace = true;
    else if ((match = /^arms-(m?\d+)$/.exec(body)) !== null) armSpace = unsigned(match[1] as string);
    else if (clip === null) clip = body;
  }
  return clip === null ? null : { clip, params: { speed, trim, mirror, inPlace, armSpace } };
}
