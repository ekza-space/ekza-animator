import { EkzaError } from '@ekza-animator/anim-core';
import type { ControlId, IdKind, IdOfKind, IdSource, RigId, SolverId } from '../ids';
import { digestBase62, sha256 } from '../migrations/sha256';

// IDs are `<prefix>_<base62>`: 16 characters for every kind except keys (12). Characters come from an injectable
// randomness source with rejection sampling, so the alphabet is uniform for any source.

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Largest multiple of 62 that fits in a byte; bytes at or above it are rejected to keep the draw unbiased. */
const REJECT_FROM = 248;

const PREFIX: Readonly<Record<IdKind, string>> = {
  character: 'chr_',
  rig: 'rig_',
  constraint: 'cns_',
  solver: 'slv_',
  camera: 'cam_',
  clip: 'clp_',
  layer: 'lay_',
  curve: 'crv_',
  key: 'k_',
  tx: 'tx_',
  // M6a (M6A-SPEC §3 rule 3)
  mesh: 'msh_',
  group: 'grp_',
  palette: 'pal_',
  swatch: 'sw_',
  imagePlane: 'img_',
  skeleton: 'skl_',
  joint: 'jnt_',
};

const BODY_LENGTH: Readonly<Record<IdKind, number>> = {
  character: 16,
  rig: 16,
  constraint: 16,
  solver: 16,
  camera: 16,
  clip: 16,
  layer: 16,
  curve: 16,
  key: 12,
  tx: 16,
  mesh: 16,
  group: 16,
  palette: 16,
  swatch: 16,
  imagePlane: 16,
  skeleton: 16,
  joint: 16,
};

const cryptoIdSource: IdSource = {
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

let defaultSource: IdSource = cryptoIdSource;

/** A new random ID of the given kind, e.g. `newId('clip')` → `'clp_3fJ…'` (16 base62 characters). */
export function newId<K extends keyof IdOfKind>(kind: K, source?: IdSource): IdOfKind[K] {
  const prefix = PREFIX[kind];
  const length = BODY_LENGTH[kind];
  if (prefix === undefined || length === undefined) {
    throw new EkzaError('unsupported', `Unknown ID kind '${String(kind)}'`);
  }
  return (prefix + randomBase62(length, source ?? defaultSource)) as IdOfKind[K];
}

/** Deterministic auto-rig control ID: `${rig}:${templateKey}` (e.g. `rig_a1…:fk.upperArm.L`). */
export function controlId(rig: RigId, templateKey: string): ControlId {
  if (templateKey.length === 0) {
    throw new EkzaError('invalid-record', 'A control template key must not be empty');
  }
  return `${rig}:${templateKey}` as ControlId;
}

/**
 * Deterministic auto-rig solver ID (M2A-SPEC §3 rule 3): 'slv_' + 16 base62 of sha256(`${rig}:${templateKey}`), the
 * derivation of `deriveMigratedId`. Two peers adding limb IK to the same rig create identical records.
 */
export function solverId(rig: RigId, templateKey: string): SolverId {
  if (typeof templateKey !== 'string' || templateKey.length === 0) {
    throw new EkzaError('invalid-record', 'A solver template key must not be empty');
  }
  return `slv_${digestBase62(sha256(new TextEncoder().encode(`${rig}:${templateKey}`)), 16)}` as SolverId;
}

/**
 * Deterministic ID of a record created by a MeshSetOp, `mesh.create.*`, `mesh.create.template`, Make editable or the
 * default palette (M6A-SPEC §3 rule 3): the kind's prefix + base62 of
 * `sha256(opId + ':' + inputs.join(',') + ':' + seed + ':' + n)` (16 characters; keys 12). `seed` is the `LastRun` seed
 * of the run being adjusted (a fresh `newId('tx')` on a first run), so an adjusted re-run reuses the ids; `n` numbers
 * the records one run creates. Two peers or two runs with the same inputs derive the same id.
 */
export function derivedId<K extends IdKind>(
  kind: K,
  opId: string,
  inputs: readonly string[],
  seed: string,
  n: number,
): IdOfKind[K] {
  const prefix = PREFIX[kind];
  const length = BODY_LENGTH[kind];
  if (prefix === undefined || length === undefined) {
    throw new EkzaError('unsupported', `Unknown ID kind '${String(kind)}'`);
  }
  if (typeof opId !== 'string' || opId.length === 0) {
    throw new EkzaError('invalid-record', 'derivedId: opId must be a non-empty string');
  }
  if (!Number.isSafeInteger(n) || n < 0)
    throw new EkzaError('invalid-record', `derivedId: n must be an integer ≥ 0, got ${n}`);
  const text = `${opId}:${inputs.join(',')}:${seed}:${n}`;
  return (prefix + digestBase62(sha256(new TextEncoder().encode(text)), length)) as IdOfKind[K];
}

/**
 * Deterministic randomness for tests and `?e2e=1` (mulberry32). The same seed always yields the same ID sequence.
 */
export function seededIdSource(seed: number): IdSource {
  if (!Number.isFinite(seed)) throw new EkzaError('unsupported', `ID seed must be a finite number, got ${seed}`);
  let state = seed >>> 0;
  let word = 0;
  let available = 0;
  const nextByte = (): number => {
    if (available === 0) {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      word = (t ^ (t >>> 14)) >>> 0;
      available = 4;
    }
    available--;
    const byte = word & 0xff;
    word >>>= 8;
    return byte;
  };
  return {
    randomBytes(n: number): Uint8Array {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = nextByte();
      return bytes;
    },
  };
}

/** Replaces the source used by `newId` when none is passed; `null` restores `crypto.getRandomValues`. */
export function setDefaultIdSource(source: IdSource | null): void {
  defaultSource = source ?? cryptoIdSource;
}

function randomBase62(length: number, source: IdSource): string {
  let out = '';
  while (out.length < length) {
    // Request a little more than needed: about 3 % of bytes are rejected.
    const bytes = source.randomBytes(length - out.length + 4);
    for (const byte of bytes) {
      if (byte >= REJECT_FROM) continue;
      out += BASE62.charAt(byte % 62);
      if (out.length === length) break;
    }
  }
  return out;
}
