// Table registry (MVP-SPEC §4.2 `TableDef`, §4.11.21 partitions, ARCHITECTURE §4.2 / §12 extensible tables).
// Built-in tables are described by constant definitions (nothing registers on import); extensions call
// `registerTable`. Tables without a definition are opaque: they live in the `scene` partition, merge per field, have
// no soft delete and no validation beyond a string `id`, and survive snapshots verbatim.
import { type Disposer, EkzaError } from '@ekza-studio/anim-core';
import {
  BUILTIN_TABLES,
  type BuiltinTableName,
  MERGE_UNIT,
  type MergeUnit,
  type Partition,
  type PartitionLookup,
  type RecordOf,
  type TableDef,
  type TableName,
} from '../records';
import { repairSwatchShader } from '../records/swatch';
import { validateBuiltin } from '../records/validate';
import type { RigId, SkeletonId } from '../ids';

const BUILTIN_SET: ReadonlySet<string> = new Set(BUILTIN_TABLES);
/** Tables whose records reference only their rig: their partition is the rig's character partition. */
const RIG_SCOPED: ReadonlySet<string> = new Set(['controls', 'constraints', 'solvers']);
/**
 * Tables whose partition is resolved through a `PartitionLookup` from one field of the record (M6a: joints reference
 * only their skeleton, whose partition is `char:<the skeleton's character>`).
 */
const SCOPE_FIELD: Readonly<Record<string, string>> = {
  controls: 'rig',
  constraints: 'rig',
  solvers: 'rig',
  joints: 'skeleton',
};
/** Version of a built-in table without migrations (SCHEMA_VERSION 1 baseline). */
export const BUILTIN_TABLE_VERSION = 1;

/**
 * Per-table migrations of the built-in tables (`TableDef.migrations`: index i migrates version i+1 → i+2); a table's
 * version is 1 + its migration count. `swatches` 1 → 2 (SHADING-SPEC §2, ADR 0019): every swatch gets its shader
 * fields (`shader` 'lambert', `glossiness` 0.5, `specular` white) when they are missing; pure and idempotent.
 */
const BUILTIN_MIGRATIONS: Readonly<Partial<Record<BuiltinTableName, readonly ((record: unknown) => unknown)[]>>> = {
  swatches: [
    (record) => {
      if (typeof record !== 'object' || record === null || Array.isArray(record)) return record;
      const row = record as Readonly<Record<string, unknown>>;
      const patch = repairSwatchShader(row);
      return Object.keys(patch).length === 0 ? record : { ...row, ...patch };
    },
  ],
};

/** The version of a built-in table in this build (`DocSnapshot.tableVersions`). */
export function builtinTableVersion(name: BuiltinTableName): number {
  return BUILTIN_TABLE_VERSION + (BUILTIN_MIGRATIONS[name]?.length ?? 0);
}

function field(record: { readonly id: string }, name: string): string {
  return String((record as Readonly<Record<string, unknown>>)[name]);
}

/** M6a `MeshOwner`: `{character}` → `char:<id>`, anything else (`{scene: true}`, damaged) → `scene`. */
function ownerPartition(record: { readonly id: string }): Partition {
  const owner = (record as Readonly<Record<string, unknown>>)['owner'];
  if (typeof owner === 'object' && owner !== null) {
    const character = (owner as Readonly<Record<string, unknown>>)['character'];
    if (typeof character === 'string' && character.length > 0) return `char:${character}`;
  }
  return 'scene';
}

function builtinPartition(
  table: BuiltinTableName,
  record: { readonly id: string },
  lookup?: PartitionLookup,
): Partition {
  switch (table) {
    case 'project':
    case 'assets':
    case 'characters':
    case 'cameras':
    case 'palettes':
    case 'swatches':
    case 'imagePlanes':
      return 'scene';
    case 'rigs':
    case 'clips':
    case 'skeletons':
      return `char:${field(record, 'character')}`;
    case 'meshes':
    case 'groups':
      return ownerPartition(record);
    case 'joints': {
      if (lookup === undefined) {
        throw new EkzaError(
          'unsupported',
          'partitionOf(joints): the partition of a joint needs a skeleton lookup (PartitionLookup)',
        );
      }
      const character = lookup.skeletonCharacter(field(record, 'skeleton') as SkeletonId);
      return character === undefined ? 'scene' : `char:${character}`;
    }
    case 'controls':
    case 'constraints':
    case 'solvers': {
      if (lookup === undefined) {
        throw new EkzaError(
          'unsupported',
          `partitionOf(${table}): the partition of a rig-scoped record needs a rig lookup (PartitionLookup)`,
        );
      }
      const character = lookup.rigCharacter(field(record, 'rig') as RigId);
      return character === undefined ? 'scene' : `char:${character}`;
    }
    case 'layers':
    case 'curves':
    case 'keys':
      return `clip:${field(record, 'clip')}`;
  }
}

function builtinDef(name: BuiltinTableName): TableDef {
  return {
    name,
    version: builtinTableVersion(name),
    mergeUnit: MERGE_UNIT[name],
    softDelete: name !== 'project' && name !== 'assets' && name !== 'keys',
    partition: (record, lookup) => builtinPartition(name, record, lookup),
    validate: (record) => validateBuiltin(name, record),
    migrations: BUILTIN_MIGRATIONS[name] ?? [],
  };
}

const BUILTIN_DEFS: ReadonlyMap<string, TableDef> = new Map(BUILTIN_TABLES.map((name) => [name, builtinDef(name)]));
const registered = new Map<string, TableDef>();

/**
 * Registers an extension table ('vendor.table'). Throws `EkzaError('unsupported')` for built-in or already
 * registered names and malformed definitions. The disposer unregisters it (records already stored stay).
 */
export function registerTable(def: TableDef): Disposer {
  if (typeof def.name !== 'string' || def.name.length === 0) {
    throw new EkzaError('unsupported', 'registerTable: a table needs a non-empty name');
  }
  if (BUILTIN_SET.has(def.name)) {
    throw new EkzaError('unsupported', `registerTable: '${def.name}' is a built-in table`);
  }
  if (registered.has(def.name)) {
    throw new EkzaError('unsupported', `registerTable: '${def.name}' is already registered`);
  }
  if (!Number.isSafeInteger(def.version) || def.version < 1) {
    throw new EkzaError('unsupported', `registerTable(${def.name}): version must be an integer ≥ 1`);
  }
  if (def.mergeUnit !== 'record' && def.mergeUnit !== 'field') {
    throw new EkzaError('unsupported', `registerTable(${def.name}): mergeUnit must be 'record' or 'field'`);
  }
  if (def.migrations.length > def.version - 1) {
    throw new EkzaError(
      'unsupported',
      `registerTable(${def.name}): ${def.migrations.length} migrations for version ${def.version} (at most version − 1)`,
    );
  }
  registered.set(def.name, def);
  return () => {
    if (registered.get(def.name) === def) registered.delete(def.name);
  };
}

/** The definition of a built-in or registered table; undefined for opaque (unknown) tables. */
export function getTableDef(name: string): TableDef | undefined {
  return BUILTIN_DEFS.get(name) ?? registered.get(name);
}

/** True for the built-in tables (twelve until M2a, nineteen with the M6a tables). */
export function isBuiltinTable(name: string): name is BuiltinTableName {
  return BUILTIN_SET.has(name);
}

/**
 * Partition of a record (§4.11.21): `scene` ← project, assets, characters, cameras, palettes, swatches, image planes
 * and opaque tables; `char:<characterId>` ← rigs, clips, skeletons and the rig-scoped controls, constraints, solvers
 * and skeleton-scoped joints (resolved through `lookup`; required for those four); meshes and groups ← their owner
 * (`char:<id>` or `scene`); `clip:<clipId>` ← layers, curves, keys. Extension tables use their `TableDef`.
 */
export function partitionOf<T extends TableName>(table: T, record: RecordOf<T>, lookup?: PartitionLookup): Partition {
  return partitionOfAny(table, record, lookup);
}

/** `partitionOf` for any table name, including opaque ones. */
export function partitionOfAny(table: string, record: { readonly id: string }, lookup?: PartitionLookup): Partition {
  const def = getTableDef(table);
  return def === undefined ? 'scene' : def.partition(record, lookup);
}

/** The partition a record owns (§4.11.21): a character owns `char:<id>`, a clip owns `clip:<id>`; others none. */
export function ownedPartition(table: string, id: string): Partition | null {
  if (table === 'characters') return `char:${id}`;
  if (table === 'clips') return `clip:${id}`;
  return null;
}

/** True when the table's records reference only their rig (see `PartitionLookup`). */
export function isRigScoped(table: string): boolean {
  return RIG_SCOPED.has(table);
}

/**
 * The field through which a lookup-scoped record's partition is resolved ('rig' for controls, constraints and
 * solvers; 'skeleton' for joints), or null for tables whose records carry their partition themselves.
 */
export function scopeFieldOf(table: string): string | null {
  return SCOPE_FIELD[table] ?? null;
}

/** Problems of a record for its table ([] = valid). Opaque tables only require an object with a string `id`. */
export function validateRecord<T extends TableName>(table: T, record: unknown): readonly string[] {
  return validateAny(table, record);
}

/** `validateRecord` for any table name, including opaque ones. */
export function validateAny(table: string, record: unknown): readonly string[] {
  const def = getTableDef(table);
  if (def !== undefined) return def.validate(record);
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return ['expected a record object'];
  const id = (record as Readonly<Record<string, unknown>>)['id'];
  return typeof id === 'string' && id.length > 0 ? [] : ['id: expected a non-empty string'];
}

/** Merge unit of any table; opaque tables merge per field. */
export function mergeUnitOf(table: string): MergeUnit {
  return getTableDef(table)?.mergeUnit ?? 'field';
}

/** True when the table's records carry a `deleted` tombstone (opaque tables: false). */
export function isSoftDeletable(table: string): boolean {
  return getTableDef(table)?.softDelete ?? false;
}
