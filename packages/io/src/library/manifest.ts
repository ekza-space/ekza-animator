// The starter-pack manifest (M6B-SPEC §0.4.7, §0.5; C12): `apps/web/public/library/animations/starter-pack.json`,
// parsed strictly so a damaged or hand-edited manifest is refused with the field that is wrong. Kept apart from the
// retarget and the writer so the clip-library chunk loads only this module of io's library.
import { EkzaError } from '@ekza-studio/anim-core';
import type { StarterPackClip, StarterPackManifest } from '../types';

/** Clip id = file stem (§0.5). */
const CLIP_ID = /^[a-z0-9-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

type Json = Readonly<Record<string, unknown>>;

function fail(field: string, expected: string): never {
  throw new EkzaError('invalid-input', `starter-pack manifest: ${field} must be ${expected}`, { field });
}

function record(value: unknown, field: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, 'an object');
  return value as Json;
}

function text(json: Json, key: string, field: string): string {
  const value = json[key];
  if (typeof value !== 'string' || value.trim() === '') fail(`${field}.${key}`, 'a non-empty string');
  return value;
}

function exactly<T extends string | number>(json: Json, key: string, field: string, expected: T): T {
  if (json[key] !== expected) fail(`${field}.${key}`, JSON.stringify(expected));
  return expected;
}

function sha(json: Json, key: string, field: string): string {
  const value = json[key];
  if (typeof value !== 'string' || !SHA256.test(value)) fail(`${field}.${key}`, 'a lowercase hex SHA-256');
  return value;
}

function positive(json: Json, key: string, field: string, integer: boolean): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    fail(`${field}.${key}`, integer ? 'a positive integer' : 'a positive number');
  }
  return value;
}

function parseClip(value: unknown, field: string): StarterPackClip {
  const json = record(value, field);
  const id = text(json, 'id', field);
  if (!CLIP_ID.test(id)) fail(`${field}.id`, 'a file stem of [a-z0-9-]');
  const slot = json['slot'];
  if (slot !== null && (typeof slot !== 'string' || slot.trim() === '')) fail(`${field}.slot`, 'null or a slot name');
  const loop = json['loop'];
  if (typeof loop !== 'boolean') fail(`${field}.loop`, 'a boolean');
  const file = text(json, 'file', field);
  if (file !== `${id}.vrma`) fail(`${field}.file`, `'${id}.vrma'`);
  return {
    id,
    source: text(json, 'source', field),
    label: text(json, 'label', field),
    slot,
    loop,
    file,
    bytes: positive(json, 'bytes', field, true),
    sha256: sha(json, 'sha256', field),
    duration: positive(json, 'duration', field, false),
    fps: exactly(json, 'fps', field, 30),
    license: exactly(json, 'license', field, 'CC0-1.0'),
    credit: exactly(json, 'credit', field, 'Quaternius'),
  };
}

/** Throws EkzaError('invalid-input') naming the field. */
export function parseStarterPackManifest(json: unknown): StarterPackManifest {
  const root = record(json, 'manifest');
  const source = record(root['source'], 'manifest.source');
  const clips = root['clips'];
  if (!Array.isArray(clips) || clips.length === 0) fail('manifest.clips', 'a non-empty array');
  const parsed = (clips as readonly unknown[]).map((clip, i) => parseClip(clip, `manifest.clips[${i}]`));
  const seen = new Set<string>();
  parsed.forEach((clip, i) => {
    if (seen.has(clip.id)) fail(`manifest.clips[${i}].id`, `unique ('${clip.id}' repeats)`);
    seen.add(clip.id);
  });
  return {
    version: exactly(root, 'version', 'manifest', 1),
    id: exactly(root, 'id', 'manifest', 'ekza/starter-pack'),
    title: text(root, 'title', 'manifest'),
    license: exactly(root, 'license', 'manifest', 'CC0-1.0'),
    credit: text(root, 'credit', 'manifest'),
    sourceUrl: text(root, 'sourceUrl', 'manifest'),
    source: { file: text(source, 'file', 'manifest.source'), sha256: sha(source, 'sha256', 'manifest.source') },
    generator: text(root, 'generator', 'manifest'),
    clips: parsed,
  };
}
