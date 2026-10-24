// The bundled snapshot's index `ekza.contract-index.v1` (GAME-PROTOCOL-SPEC §8.10; C1):
// `apps/web/public/contracts/<game>/index.json`, written by `tooling/sync-contract.mjs` — the contract schema and the
// profiles it uses, every bundled revision with its file, size and SHA-256, the channels, and whether Hub accepts
// packages for the game yet (`submit`).
import { EkzaError } from '@ekza-studio/anim-core';
import { CONTRACT_MAX_BYTES } from './read';

export interface ContractIndex {
  readonly schema: 'ekza.contract-index.v1';
  /** The game (Hub project id). */
  readonly game: string;
  /** The contract documents' schema: `ekza.game-contract.v1`. */
  readonly contractSchema: string;
  /** The profiles the bundled revisions use (`profiles.used`, union). */
  readonly profiles: readonly string[];
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
  readonly targets: number;
  readonly slots: number;
}

const REVISION = /^sha256-[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GAME = /^[a-z][a-z0-9-]{1,62}$/;
const PROFILE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/;

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
  const root = object(json, f, ['schema', 'game', 'contractSchema', 'profiles', 'channels', 'submit', 'revisions']);
  if (root['schema'] !== 'ekza.contract-index.v1') fail(`${f}.schema`, "'ekza.contract-index.v1'");
  const contractSchema = root['contractSchema'];
  if (typeof contractSchema !== 'string' || !PROFILE.test(contractSchema)) fail(`${f}.contractSchema`, 'a schema id');
  const profiles = root['profiles'];
  if (!Array.isArray(profiles) || profiles.some((p) => typeof p !== 'string' || !PROFILE.test(p))) {
    fail(`${f}.profiles`, 'a list of profile ids');
  }
  if (typeof root['submit'] !== 'boolean') fail(`${f}.submit`, 'a boolean');
  const list = root['revisions'];
  if (!Array.isArray(list) || list.length === 0) fail(`${f}.revisions`, 'a non-empty array');
  const revisions = (list as readonly unknown[]).map((item, i): ContractIndexEntry => {
    const rf = `${f}.revisions[${i}]`;
    const entry = object(item, rf, ['revision', 'file', 'bytes', 'sha256', 'previousRevision', 'targets', 'slots']);
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
      targets: count(entry, 'targets', rf),
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
    profiles: profiles as string[],
    channels: { live, test },
    submit: root['submit'],
    revisions,
  };
}
