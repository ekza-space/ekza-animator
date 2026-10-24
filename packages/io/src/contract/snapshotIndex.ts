// The bundled snapshot's index (CHARACTER-CONTRACT-SPEC §8.1; C1): `apps/web/public/contracts/<game>/index.json`,
// written by `tooling/sync-contract.mjs` — every bundled revision with its file, size and SHA-256, the channels, and
// whether Hub accepts packages for the game yet (`submit`, §8.11). Game-agnostic.
import { EkzaError } from '@ekza-studio/anim-core';
import { CONTRACT_MAX_BYTES } from './read';

export interface ContractIndex {
  readonly schema: 'ekza.contract-index.v1';
  /** The game (Hub project id). */
  readonly game: string;
  /** The contract documents' schema (the profile). */
  readonly contractSchema: string;
  readonly channels: { readonly live: string; readonly test: string };
  readonly submit: boolean;
  readonly revisions: readonly ContractIndexEntry[];
}

export interface ContractIndexEntry {
  readonly revision: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly previousRevision: string | null;
  readonly characters: number;
  readonly slots: number;
}

const REVISION = /^sha256-[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GAME = /^[a-z][a-z0-9-]{1,62}$/;

type Json = Readonly<Record<string, unknown>>;

function fail(field: string, expected: string): never {
  throw new EkzaError('invalid-input', `contract index: ${field} must be ${expected}`, { field });
}

function object(value: unknown, field: string, keys: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(field, 'an object');
  const json = value as Json;
  for (const key of Object.keys(json)) if (!keys.includes(key)) fail(`${field}.${key}`, 'absent (unknown key)');
  for (const key of keys) if (!(key in json)) fail(`${field}.${key}`, 'present');
  return json;
}

function match(json: Json, key: string, field: string, pattern: RegExp): string {
  const value = json[key];
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${field}.${key}`, `a string matching ${pattern.source}`);
  return value;
}

function count(json: Json, key: string, field: string, max = Number.MAX_SAFE_INTEGER): number {
  const value = json[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    fail(`${field}.${key}`, `an integer in 1…${max}`);
  }
  return value;
}

/** Parses an index strictly (unknown keys refused; channels name listed revisions). */
export function parseContractIndex(json: unknown): ContractIndex {
  const f = 'index';
  const root = object(json, f, ['schema', 'game', 'contractSchema', 'channels', 'submit', 'revisions']);
  if (root['schema'] !== 'ekza.contract-index.v1') fail(`${f}.schema`, "'ekza.contract-index.v1'");
  const contractSchema = root['contractSchema'];
  if (typeof contractSchema !== 'string' || contractSchema.length === 0) fail(`${f}.contractSchema`, 'a schema id');
  if (typeof root['submit'] !== 'boolean') fail(`${f}.submit`, 'a boolean');
  const list = root['revisions'];
  if (!Array.isArray(list) || list.length === 0) fail(`${f}.revisions`, 'a non-empty array');
  const revisions = (list as readonly unknown[]).map((item, i): ContractIndexEntry => {
    const rf = `${f}.revisions[${i}]`;
    const entry = object(item, rf, ['revision', 'file', 'bytes', 'sha256', 'previousRevision', 'characters', 'slots']);
    const revision = match(entry, 'revision', rf, REVISION);
    if (entry['file'] !== `${revision}.json`) fail(`${rf}.file`, `'${revision}.json'`);
    const previous = entry['previousRevision'];
    if (previous !== null && (typeof previous !== 'string' || !REVISION.test(previous))) {
      fail(`${rf}.previousRevision`, 'null or sha256-<64 hex>');
    }
    return {
      revision,
      file: `${revision}.json`,
      bytes: count(entry, 'bytes', rf, CONTRACT_MAX_BYTES),
      sha256: match(entry, 'sha256', rf, SHA256),
      previousRevision: previous,
      characters: count(entry, 'characters', rf),
      slots: count(entry, 'slots', rf),
    };
  });
  const channels = object(root['channels'], `${f}.channels`, ['live', 'test']);
  const known = new Set(revisions.map((entry) => entry.revision));
  const live = match(channels, 'live', `${f}.channels`, REVISION);
  const test = match(channels, 'test', `${f}.channels`, REVISION);
  if (!known.has(live)) fail(`${f}.channels.live`, 'a listed revision');
  if (!known.has(test)) fail(`${f}.channels.test`, 'a listed revision');
  return {
    schema: 'ekza.contract-index.v1',
    game: match(root, 'game', f, GAME),
    contractSchema,
    channels: { live, test },
    submit: root['submit'],
    revisions,
  };
}
