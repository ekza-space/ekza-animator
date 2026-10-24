// Reading a contract document (GAME-PROTOCOL-SPEC §3.5 step 1; C1): the 1 MiB cap, JSON, the schema id, then the strict
// reader of `ekza.game-contract.v1` (`gameContract.ts`). Any other schema id is refused: a known-looking one with
// "needs a newer Ekza Studio".
import { EkzaError } from '@ekza-studio/anim-core';
import { readGameContract } from './gameContract';
import { GAME_CONTRACT_SCHEMA, type ContractModel } from './model';

/** Readers cap a contract document at 1 MiB (§3.5). */
export const CONTRACT_MAX_BYTES = 1_048_576;

export interface ContractReadOptions {
  /** Recompute the canonical revision and refuse a mismatch (default true). */
  readonly verifyRevision?: boolean;
}

/** Reads a parsed contract document. Throws `EkzaError('invalid-input' | 'unsupported')`. */
export function readContract(json: unknown, opts: ContractReadOptions = {}): ContractModel {
  const schema =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Readonly<Record<string, unknown>>)['schema']
      : undefined;
  if (schema === GAME_CONTRACT_SCHEMA) return readGameContract(json, opts);
  if (typeof schema === 'string' && /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\.v[0-9]+$/.test(schema)) {
    throw new EkzaError('unsupported', `This contract needs a newer Ekza Studio (${schema})`, { schema });
  }
  throw new EkzaError('invalid-input', `game contract: schema must be '${GAME_CONTRACT_SCHEMA}'`, {
    field: 'contract.schema',
  });
}

/** Reads contract text: the 1 MiB cap, JSON, then `readContract`. */
export function readContractText(text: string, opts: ContractReadOptions = {}): ContractModel {
  if (new TextEncoder().encode(text).byteLength > CONTRACT_MAX_BYTES) {
    throw new EkzaError('invalid-input', `game contract: at most ${CONTRACT_MAX_BYTES} bytes`, {
      field: 'contract',
      reason: 'size',
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new EkzaError('invalid-input', 'game contract: must be valid JSON', { field: 'contract', reason: 'json' });
  }
  return readContract(json, opts);
}
