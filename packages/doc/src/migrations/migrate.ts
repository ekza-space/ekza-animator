// Snapshot migrations (MVP-SPEC §7 WP-2, ADR 0002 §4, ADR 0011 §4, research 06 R11): pure, idempotent functions.
// - Core migrations rewrite a whole snapshot from schema v(n) to v(n+1). SCHEMA_VERSION 1 is the baseline; 1 → 2
//   (M2A-SPEC §4.2) is the identity on records: schema 1 documents contain no `ik2` solvers, no attribute curves and
//   no breakdown keys, and every M2a field is optional. 2 → 3 (M6A-SPEC §4.2) gives every character its `source` and
//   every asset its `provenance: null`; nothing else changes (the seven M6a tables start empty at version 1). 3 → 4
//   (M6B-SPEC §4.1) gives every character `vrm: null` and every joint `role: 'bone'` and a unique `key` (the sanitized
//   name, `#n` on duplicates per skeleton in id order); the swatches table is never touched (its version stays 2).
// - Repairs (MVP-SPEC §3 rule 6, M6A-SPEC §4.2) run after the migrations on every load: the per-record repairs of the
//   M6a rules table and the cross-record mesh/group hierarchy repairs. Repaired content is never rejected.
// - Per-table migrations come from `TableDef.migrations` and move each record from the snapshot's
//   `tableVersions[table]` to the registered `TableDef.version`.
// New IDs are derived, never random, so two clients migrating the same document write identical records.
import { EkzaError } from '@ekza-studio/anim-core';
import { BUILTIN_TABLES } from '../records';
import { SCHEMA_VERSION, SNAPSHOT_FORMAT } from '../snapshot/version';
import type { DocSnapshot, SnapshotTables } from '../store';
import { compareStrings } from '../store/diff';
import { jointKeyStem, repairHierarchy, repairJointKeys, repairRecord } from '../records/repair';
import { getTableDef } from '../tables/registry';
import { digestBase62 as base62, sha256 } from './sha256';

type MutableTables = Record<string, Record<string, unknown>>;

/** A snapshot whose parts migrations may replace. */
export interface MigratableSnapshot {
  schemaVersion: number;
  minWriterVersion: number;
  tableVersions: Record<string, number>;
  tables: MutableTables;
}

/** Core migrations: index i migrates schema version i+1 → i+2. */
export const CORE_MIGRATIONS: readonly ((snapshot: MigratableSnapshot) => MigratableSnapshot)[] = [
  // 1 → 2 (M2A-SPEC §4.2 item 1): the identity on records. The loop below writes schemaVersion 2.
  (snapshot) => snapshot,
  // 2 → 3 (M6A-SPEC §4.2): characters without `source` get {kind: 'asset', asset}; assets without `provenance` get
  // null. Pure and idempotent; the loop below writes schemaVersion 3.
  (snapshot) => {
    for (const table of ['characters', 'assets'] as const) {
      const rows = snapshot.tables[table];
      if (rows === undefined) continue;
      for (const [key, record] of Object.entries(rows)) {
        const repaired = repairRecord(table, record).record;
        if (repaired !== record) rows[key] = repaired;
      }
    }
    return snapshot;
  },
  // 3 → 4 (M6B-SPEC §4.1): characters without `vrm` get null; joints without `role` get 'bone' and without `key` the
  // sanitized name, de-duplicated per skeleton in id order. Pure and idempotent; the loop below writes schemaVersion 4.
  (snapshot) => {
    const characters = snapshot.tables['characters'];
    if (characters !== undefined) {
      for (const [key, record] of Object.entries(characters)) {
        if (isObject(record) && !('vrm' in record)) characters[key] = { ...record, vrm: null };
      }
    }
    const joints = snapshot.tables['joints'];
    if (joints !== undefined) {
      for (const [key, record] of Object.entries(joints)) {
        if (!isObject(record)) continue;
        const role = 'role' in record ? {} : { role: 'bone' };
        const stem = 'key' in record ? {} : { key: jointKeyStem(record['name']) };
        if ('role' in role || 'key' in stem) joints[key] = { ...record, ...role, ...stem };
      }
      snapshot.tables['joints'] = { ...repairJointKeys(joints).joints };
    }
    return snapshot;
  },
];

/** Tables whose records `migrateSnapshot` repairs one by one after the migrations (M6A-SPEC §4.2 rules). */
const REPAIRED_TABLES = [
  'characters',
  'assets',
  'meshes',
  'groups',
  'palettes',
  'swatches',
  'imagePlanes',
  'skeletons',
  // M6B-SPEC §4.1 (schema v4)
  'joints',
  'controls',
  'clips',
] as const;

function repairSnapshot(snapshot: MigratableSnapshot): void {
  for (const table of REPAIRED_TABLES) {
    const rows = snapshot.tables[table];
    if (rows === undefined) continue;
    for (const [key, record] of Object.entries(rows)) {
      const repaired = repairRecord(table, record).record;
      if (repaired !== record) rows[key] = repaired;
    }
  }
  const joints = snapshot.tables['joints'];
  if (joints !== undefined) snapshot.tables['joints'] = { ...repairJointKeys(joints).joints };
  const meshes = snapshot.tables['meshes'];
  const groups = snapshot.tables['groups'];
  if (meshes === undefined && groups === undefined) return;
  const hierarchy = repairHierarchy(meshes ?? {}, groups ?? {});
  if (meshes !== undefined) snapshot.tables['meshes'] = { ...hierarchy.meshes };
  if (groups !== undefined) snapshot.tables['groups'] = { ...hierarchy.groups };
}

const GENERATED_ID = /^([a-z]+_)([0-9A-Za-z]+)$/;
const SHA256_ID = /^[0-9a-f]{64}$/;

/**
 * Deterministic ID for a record a migration creates from `oldId`: hash(oldId + ':' + purpose) with the old ID's
 * prefix. Generated IDs (`crv_…`, `k_…`) keep their prefix and body length; content hashes (assets) stay 64-hex;
 * composite IDs (`rig_…:fk.hips`) keep everything up to the last ':' and get a 16-character tail; anything else
 * becomes 16 base62 characters.
 */
export function deriveMigratedId(oldId: string, purpose: string): string {
  if (typeof oldId !== 'string' || oldId.length === 0) {
    throw new EkzaError('invalid-record', 'deriveMigratedId: oldId must be a non-empty string');
  }
  const digest = sha256(new TextEncoder().encode(`${oldId}:${purpose}`));
  if (SHA256_ID.test(oldId)) return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const generated = GENERATED_ID.exec(oldId);
  if (generated !== null) return (generated[1] as string) + base62(digest, (generated[2] as string).length);
  const colon = oldId.lastIndexOf(':');
  if (colon > 0) return `${oldId.slice(0, colon + 1)}${base62(digest, 16)}`;
  return base62(digest, 16);
}

/**
 * Validates the container of a parsed snapshot, runs core and per-table migrations, and reports whether the
 * project must open read-only (its `minWriterVersion` or a registered table's version is newer than this build).
 * Throws `EkzaError('invalid-record')` when `raw` is not an `ekza-animator-doc` snapshot. Records are repaired, never
 * rejected: a record without a string `id` takes its key, a record stored under another key moves to its `id`, and
 * non-object records are dropped. Idempotent: migrating a migrated snapshot returns an equal one.
 */
export function migrateSnapshot(raw: unknown): {
  readonly snapshot: DocSnapshot;
  readonly migratedFrom: number;
  readonly readOnly: boolean;
} {
  if (!isObject(raw)) throw invalid('a document snapshot must be a JSON object');
  if (raw['format'] !== SNAPSHOT_FORMAT) throw invalid(`unknown snapshot format ${JSON.stringify(raw['format'])}`);
  const schemaVersion = raw['schemaVersion'];
  if (!isVersion(schemaVersion)) throw invalid('schemaVersion must be an integer ≥ 1');
  const minWriter = raw['minWriterVersion'] ?? 1;
  if (!isVersion(minWriter)) throw invalid('minWriterVersion must be an integer ≥ 1');
  if (!isObject(raw['tables'])) throw invalid('tables must be an object');
  const rawVersions = raw['tableVersions'] ?? {};
  if (!isObject(rawVersions)) throw invalid('tableVersions must be an object');

  let snapshot: MigratableSnapshot = {
    schemaVersion,
    minWriterVersion: minWriter,
    tableVersions: {},
    tables: {},
  };
  for (const [name, version] of Object.entries(rawVersions)) {
    if (!isVersion(version)) throw invalid(`tableVersions.${name} must be an integer ≥ 1`);
    snapshot.tableVersions[name] = version;
  }
  for (const name of Object.keys(raw['tables']).sort(compareStrings)) {
    const table = raw['tables'][name];
    if (!isObject(table)) throw invalid(`tables.${name} must be an object of records`);
    snapshot.tables[name] = repairTable(table);
  }

  // Core migrations. A newer core version cannot be migrated down: it is kept as is and the project is writable only
  // if its minWriterVersion allows this build.
  for (let version = schemaVersion; version < SCHEMA_VERSION; version++) {
    const migration = CORE_MIGRATIONS[version - 1];
    if (migration === undefined) throw invalid(`no core migration from schema version ${version}`);
    snapshot = migration(snapshot);
    snapshot.schemaVersion = version + 1;
  }

  let newerTable = false;
  for (const name of Object.keys(snapshot.tables)) {
    const def = getTableDef(name);
    const from = snapshot.tableVersions[name] ?? 1;
    if (def === undefined) {
      snapshot.tableVersions[name] = from;
      continue;
    }
    if (from > def.version) {
      newerTable = true;
      snapshot.tableVersions[name] = from;
      continue;
    }
    if (from < def.version) {
      snapshot.tables[name] = migrateTable(
        snapshot.tables[name] as Record<string, unknown>,
        def.migrations,
        from,
        def.version,
      );
    }
    snapshot.tableVersions[name] = def.version;
  }
  for (const name of BUILTIN_TABLES) {
    snapshot.tables[name] ??= {};
    snapshot.tableVersions[name] ??= getTableDef(name)?.version ?? 1;
  }
  // Repairs apply to documents of this build's schema (a newer core version is kept as is and opens read-only).
  if (snapshot.schemaVersion <= SCHEMA_VERSION) repairSnapshot(snapshot);

  const readOnly = snapshot.minWriterVersion > SCHEMA_VERSION || newerTable;
  const result: DocSnapshot = {
    format: SNAPSHOT_FORMAT,
    schemaVersion: snapshot.schemaVersion,
    minWriterVersion: snapshot.minWriterVersion,
    tableVersions: sortKeys(snapshot.tableVersions),
    tables: sortTables(snapshot.tables) as unknown as SnapshotTables,
  };
  return { snapshot: result, migratedFrom: schemaVersion, readOnly };
}

function migrateTable(
  rows: Readonly<Record<string, unknown>>,
  migrations: readonly ((record: unknown) => unknown)[],
  from: number,
  to: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(rows).sort(compareStrings)) {
    let record: unknown = rows[key];
    for (let version = from; version < to && record !== undefined && record !== null; version++) {
      const migration = migrations[version - 1];
      if (migration === undefined) throw invalid(`missing migration ${version} → ${version + 1}`);
      record = migration(record);
    }
    if (!isObject(record)) continue; // a migration may drop a record by returning null/undefined
    const id = typeof record['id'] === 'string' && record['id'].length > 0 ? record['id'] : key;
    out[id] = record['id'] === id ? record : { ...record, id };
  }
  return out;
}

function repairTable(rows: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Sorted, so a collision after re-keying resolves the same way on every client.
  for (const key of Object.keys(rows).sort(compareStrings)) {
    const record = rows[key];
    if (!isObject(record)) continue;
    const ownId = record['id'];
    const id = typeof ownId === 'string' && ownId.length > 0 ? ownId : key;
    out[id] = ownId === id ? record : { ...record, id };
  }
  return out;
}

function sortKeys<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort(compareStrings)) out[key] = record[key] as T;
  return out;
}

function sortTables(tables: MutableTables): MutableTables {
  const out: MutableTables = {};
  for (const name of Object.keys(tables).sort(compareStrings)) out[name] = sortKeys(tables[name] ?? {});
  return out;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function invalid(message: string): EkzaError {
  return new EkzaError('invalid-record', `migrateSnapshot: ${message}`);
}
