// Reading any contract document (CHARACTER-CONTRACT-SPEC §8.1; C1): the 1 MiB cap, JSON, then the profile named by the
// document's `schema` parses it strictly and maps it to the game-agnostic `ContractModel`. A schema this build has no
// profile for is refused with "needs a newer Ekza Studio".
import { EkzaError } from '@ekza-studio/anim-core';
import type { ContractModel } from './model';
import { characterContractV1Model, parseCharacterContractV1 } from './profiles/characterContractV1';
import { CHARACTER_CONTRACT_V1_SCHEMA } from './profiles/characterContractV1Types';

/** Readers cap a contract document at 1 MiB (§3.1). */
export const CONTRACT_MAX_BYTES = 1_048_576;

export interface ContractReadOptions {
  /** Recompute the canonical revision and refuse a mismatch (default true). */
  readonly verifyRevision?: boolean;
}

/** A contract profile: the document schema it reads and its strict reader. */
export interface ContractProfile {
  readonly schema: string;
  read(json: unknown, opts: ContractReadOptions): ContractModel;
}

/** The profiles this build reads (one per document schema). */
export const CONTRACT_PROFILES: readonly ContractProfile[] = [
  {
    schema: CHARACTER_CONTRACT_V1_SCHEMA,
    read: (json, opts) => characterContractV1Model(parseCharacterContractV1(json, opts)),
  },
];

/** The schemas of the profiles this build reads. */
export const CONTRACT_SCHEMAS: readonly string[] = CONTRACT_PROFILES.map((profile) => profile.schema);

/** Reads a parsed contract document through its profile. Throws `EkzaError('invalid-input' | 'unsupported')`. */
export function readContract(json: unknown, opts: ContractReadOptions = {}): ContractModel {
  const schema =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Readonly<Record<string, unknown>>)['schema']
      : undefined;
  const profile = CONTRACT_PROFILES.find((candidate) => candidate.schema === schema);
  if (profile === undefined) {
    if (typeof schema === 'string' && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/.test(schema)) {
      throw new EkzaError('unsupported', `This contract needs a newer Ekza Studio (${schema})`, { schema });
    }
    throw new EkzaError('invalid-input', 'contract: schema must name a contract profile', { field: 'contract.schema' });
  }
  return profile.read(json, opts);
}

/** Reads contract text: the 1 MiB cap, JSON, then `readContract`. */
export function readContractText(text: string, opts: ContractReadOptions = {}): ContractModel {
  if (new TextEncoder().encode(text).byteLength > CONTRACT_MAX_BYTES) {
    throw new EkzaError('invalid-input', `contract: at most ${CONTRACT_MAX_BYTES} bytes`, { field: 'contract' });
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new EkzaError('invalid-input', 'contract: must be valid JSON', { field: 'contract' });
  }
  return readContract(json, opts);
}
