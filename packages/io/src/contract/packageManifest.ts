// The package manifest `ekza.package.v1` (GAME-PROTOCOL-SPEC §5.2, Appendix B; CHARACTER-CONTRACT-SPEC §4.1,
// Appendix C; C2): embedded as `asset.extras.ekza_package_v1`, covered by the file's SHA-256. The strict reader (every
// Appendix B check in code; unknown keys refuse a 1.0 manifest, a newer 1.x minor has them skipped) and the writer of a
// character package's manifest: every slot of the offer listed once in the offer's order (`custom` with its animation
// index and marker seconds, or `default`), marker names sorted, no timestamps — the same input gives the same JSON.
import { EkzaError } from '@ekza-studio/anim-core';
import type { ContractModel, ContractOffer, ContractPackageKind, ContractTarget } from './model';
import { GAME_CONTRACT_SCHEMA } from './model';
import { isObject, type Json, list, map, num, oneOf, type ReadContext, record, str, text, vec3 } from './strict';

export const PACKAGE_SCHEMA = 'ekza.package.v1';
/** The `asset.extras` key of the manifest (`packaging.<kind>.manifestKey`, fixed in protocol 1.0). */
export const PACKAGE_MANIFEST_KEY = 'ekza_package_v1';
/** The manifest minor this reader and writer implement. */
export const PACKAGE_SCHEMA_VERSION = '1.0';

export type PackageFill =
  | { readonly mode: 'default' }
  | { readonly mode: 'custom'; readonly animation: number; readonly markers: Readonly<Record<string, number>> }
  | {
      readonly mode: 'custom';
      readonly node: number;
      readonly anchors: Readonly<Record<string, readonly [number, number, number]>>;
    };

export interface PackageRequirement {
  readonly kind: ContractPackageKind;
  readonly sha256: string;
  readonly reason: 'sockets' | 'rig' | 'derived-from';
}

export interface PackageManifest {
  readonly schema: typeof PACKAGE_SCHEMA;
  readonly schemaVersion: string;
  readonly kind: ContractPackageKind;
  readonly contract: { readonly schema: typeof GAME_CONTRACT_SCHEMA; readonly game: string; readonly revision: string };
  readonly target: { readonly id: string; readonly requirementId: string };
  readonly slots: Readonly<Record<string, PackageFill>>;
  readonly requires: readonly PackageRequirement[];
  readonly provenance: { readonly tool: string; readonly toolVersion: string };
}

const VERSION = /^1\.(0|[1-9][0-9]{0,3})$/;
const GAME = /^[a-z][a-z0-9-]{1,62}$/;
const REVISION = /^sha256-[0-9a-f]{64}$/;
const TARGET = /^[a-z][a-z0-9_-]{0,47}$/;
const REQUIREMENT = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const SLOT = /^[a-z][a-z0-9_-]{0,47}(\.[a-z0-9][a-z0-9_-]{0,47}){0,7}$/;
const MARKER = /^[a-z][a-z0-9_]{0,31}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KINDS: readonly ContractPackageKind[] = ['character', 'animation-pack', 'asset-pack', 'accessory'];

function readFill(ctx: ReadContext, value: unknown, field: string): PackageFill {
  if (!isObject(value)) return fail(field, 'an object');
  if (value['mode'] === 'default') {
    record(ctx, value, field, ['mode']);
    return { mode: 'default' };
  }
  if (value['mode'] !== 'custom') return fail(`${field}.mode`, "'default' or 'custom'");
  if ('animation' in value) {
    const json = record(ctx, value, field, ['mode', 'animation', 'markers']);
    const markersJson = map(json['markers'], `${field}.markers`, MARKER, 8);
    const markers: Record<string, number> = {};
    for (const name of Object.keys(markersJson)) {
      markers[name] = num(markersJson, name, `${field}.markers`, { min: 0, max: 600 });
    }
    return {
      mode: 'custom',
      animation: num(json, 'animation', field, { integer: true, min: 0, max: 1023 }),
      markers,
    };
  }
  const json = record(ctx, value, field, ['mode', 'node', 'anchors']);
  const anchorsJson = map(json['anchors'], `${field}.anchors`, MARKER, 8);
  const anchors: Record<string, readonly [number, number, number]> = {};
  for (const name of Object.keys(anchorsJson)) anchors[name] = vec3(anchorsJson[name], `${field}.anchors.${name}`);
  return { mode: 'custom', node: num(json, 'node', field, { integer: true, min: 0, max: 65535 }), anchors };
}

function fail(field: string, expected: string): never {
  throw new EkzaError('invalid-input', `package manifest: ${field} must be ${expected}`, { field });
}

/**
 * Reads a manifest strictly (Appendix B). Throws `EkzaError('invalid-input')` naming the field; a manifest of a newer
 * minor (`1.x`) reads with its unknown keys skipped.
 */
export function readPackageManifest(value: unknown): PackageManifest {
  try {
    return readManifest(value);
  } catch (error) {
    if (error instanceof EkzaError && error.message.startsWith('game contract: ')) {
      throw new EkzaError('invalid-input', `package manifest: ${error.message.slice(15)}`, error.details);
    }
    throw error;
  }
}

function readManifest(value: unknown): PackageManifest {
  if (!isObject(value)) return fail('manifest', 'an object');
  if (value['schema'] !== PACKAGE_SCHEMA) return fail('schema', `'${PACKAGE_SCHEMA}'`);
  const version = value['schemaVersion'];
  if (typeof version !== 'string' || !VERSION.test(version)) return fail('schemaVersion', 'a 1.x version');
  const ctx: ReadContext = { lenient: version !== PACKAGE_SCHEMA_VERSION, ignored: [] };
  const root = record(ctx, value, 'manifest', [
    'schema',
    'schemaVersion',
    'kind',
    'contract',
    'target',
    'slots',
    'requires',
    'provenance',
  ]);
  const contractJson = record(ctx, root['contract'], 'contract', ['schema', 'game', 'revision']);
  if (contractJson['schema'] !== GAME_CONTRACT_SCHEMA) fail('contract.schema', `'${GAME_CONTRACT_SCHEMA}'`);
  const targetJson = record(ctx, root['target'], 'target', ['id', 'requirementId']);
  const slotsJson = map(root['slots'], 'slots', SLOT, 512);
  const slotIds = Object.keys(slotsJson);
  if (slotIds.length < 1) fail('slots', 'at least one slot');
  const slots: Record<string, PackageFill> = {};
  for (const id of slotIds) {
    if (id.length > 96) fail(`slots['${id}']`, 'at most 96 characters');
    slots[id] = readFill(ctx, slotsJson[id], `slots['${id}']`);
  }
  const requires = list(root, 'requires', 'manifest', { max: 8 }).map((item, i): PackageRequirement => {
    const field = `requires[${i}]`;
    const json = record(ctx, item, field, ['kind', 'sha256', 'reason']);
    return {
      kind: oneOf(json, 'kind', field, KINDS),
      sha256: str(json, 'sha256', field, SHA256),
      reason: oneOf(json, 'reason', field, ['sockets', 'rig', 'derived-from'] as const),
    };
  });
  const provenanceJson = record(ctx, root['provenance'], 'provenance', ['tool', 'toolVersion']);
  return {
    schema: PACKAGE_SCHEMA,
    schemaVersion: version,
    kind: oneOf(root, 'kind', 'manifest', KINDS),
    contract: {
      schema: GAME_CONTRACT_SCHEMA,
      game: str(contractJson, 'game', 'contract', GAME),
      revision: str(contractJson, 'revision', 'contract', REVISION),
    },
    target: {
      id: str(targetJson, 'id', 'target', TARGET),
      requirementId: str(targetJson, 'requirementId', 'target', REQUIREMENT, 128),
    },
    slots,
    requires,
    provenance: {
      tool: text(provenanceJson, 'tool', 'provenance', 1, 64),
      toolVersion: text(provenanceJson, 'toolVersion', 'provenance', 1, 32),
    },
  };
}

/** The custom fill of one animation slot in a character package being written. */
export interface CharacterPackageFill {
  /** Index of the glTF animation. */
  readonly animation: number;
  /** Marker seconds from the clip's first key, by marker name (the ones the slot declares). */
  readonly markers: Readonly<Record<string, number>>;
}

/** The character offer of a contract target (`accepts[]` entry of package kind `character`), or undefined. */
export function characterOffer(target: ContractTarget): ContractOffer | undefined {
  return target.accepts.find((offer) => offer.package === 'character');
}

/**
 * The manifest of a character package (§5.2, Appendix C): the contract, the target and its character offer, and every
 * slot of the offer once, in the offer's order — `custom` where `fills` has it, else `default` (listing
 * `every-customizable-slot`; `filled-slots-only` lists the custom ones). Deterministic: no timestamps, sorted marker
 * names, the offer's slot order.
 */
export function characterPackageManifest(input: {
  readonly model: ContractModel;
  readonly target: string;
  readonly fills: ReadonlyMap<string, CharacterPackageFill>;
  readonly tool: string;
  readonly toolVersion: string;
}): PackageManifest {
  const { model } = input;
  const target = model.targets.find((entry) => entry.id === input.target);
  if (target === undefined) throw new EkzaError('invalid-input', `'${input.target}' is not a target of the contract`);
  const offer = characterOffer(target);
  if (offer === undefined) throw new EkzaError('unsupported', `${target.name} takes no character package`);
  const slots: Record<string, PackageFill> = {};
  for (const slot of offer.slots) {
    const fill = input.fills.get(slot);
    if (fill !== undefined) {
      const markers: Record<string, number> = {};
      for (const name of Object.keys(fill.markers).sort()) markers[name] = fill.markers[name] as number;
      slots[slot] = { mode: 'custom', animation: fill.animation, markers };
    } else if (offer.listing === 'every-customizable-slot' && model.slots[slot]?.customizable === true) {
      slots[slot] = { mode: 'default' };
    }
  }
  for (const slot of input.fills.keys()) {
    if (!(slot in slots)) throw new EkzaError('invalid-input', `'${slot}' is not a slot of ${offer.label}`);
  }
  return {
    schema: PACKAGE_SCHEMA,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    kind: 'character',
    contract: { schema: GAME_CONTRACT_SCHEMA, game: model.game, revision: model.revision },
    target: { id: target.id, requirementId: offer.requirementId },
    slots,
    requires: [],
    provenance: { tool: input.tool, toolVersion: input.toolVersion },
  };
}

/** The manifest as a plain JSON value with the Appendix B key order (what the writer embeds). */
export function packageManifestJson(manifest: PackageManifest): Json {
  const slots: Record<string, unknown> = {};
  for (const [id, fill] of Object.entries(manifest.slots)) {
    slots[id] =
      fill.mode === 'default'
        ? { mode: 'default' }
        : 'animation' in fill
          ? { mode: 'custom', animation: fill.animation, markers: { ...fill.markers } }
          : { mode: 'custom', node: fill.node, anchors: { ...fill.anchors } };
  }
  return {
    schema: manifest.schema,
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    contract: { schema: manifest.contract.schema, game: manifest.contract.game, revision: manifest.contract.revision },
    target: { id: manifest.target.id, requirementId: manifest.target.requirementId },
    slots,
    requires: manifest.requires.map((entry) => ({ kind: entry.kind, sha256: entry.sha256, reason: entry.reason })),
    provenance: { tool: manifest.provenance.tool, toolVersion: manifest.provenance.toolVersion },
  };
}
