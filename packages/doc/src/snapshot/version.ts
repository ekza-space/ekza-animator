import type { SnapshotTables } from '../store';

/**
 * Core document format version written by this build (DocSnapshot.schemaVersion, ProjectRecord.schemaVersion).
 * 2 since M2a (M2A-SPEC §4.2): `ik2` solver records evaluate the legs and arms, attribute curves and breakdown keys.
 * Schema 1 documents migrate by the identity (`CORE_MIGRATIONS[0]`).
 */
export const SCHEMA_VERSION = 2;
/** Snapshot `format` marker. */
export const SNAPSHOT_FORMAT = 'ekza-animator-doc';

/**
 * Lowest app schema version that evaluates this content correctly (M2A-SPEC §5.7): 2 when any live (not
 * soft-deleted) solver record is enabled with type 'ik2', else 1. An M1 app (schema 1) would evaluate an IK limb as
 * FK, so it must open such a document read-only. Pure; Node-safe; damaged rows are ignored, never rejected.
 */
export function requiredWriterVersion(tables: SnapshotTables): number {
  const solvers = (tables as Readonly<Record<string, unknown>>)['solvers'];
  if (typeof solvers !== 'object' || solvers === null) return 1;
  for (const record of Object.values(solvers as Readonly<Record<string, unknown>>)) {
    if (typeof record !== 'object' || record === null) continue;
    const row = record as Readonly<Record<string, unknown>>;
    const deleted = row['deleted'];
    if (row['type'] === 'ik2' && row['enabled'] === true && (deleted === null || deleted === undefined)) return 2;
  }
  return 1;
}
