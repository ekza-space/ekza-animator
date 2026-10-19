import type { SnapshotTables } from '../store';

/**
 * Core document format version written by this build (DocSnapshot.schemaVersion, ProjectRecord.schemaVersion).
 * 2 since M2a (M2A-SPEC §4.2): `ik2` solver records evaluate the legs and arms, attribute curves and breakdown keys.
 * 3 since M6a (M6A-SPEC §4.2): the seven modeling tables, `CharacterRecord.source`, `AssetRecord.provenance` and
 * reference-image assets. Schema 1 documents migrate by the identity (`CORE_MIGRATIONS[0]`), schema 2 documents by
 * `CORE_MIGRATIONS[1]`.
 */
export const SCHEMA_VERSION = 3;
/** Snapshot `format` marker. */
export const SNAPSHOT_FORMAT = 'ekza-animator-doc';

type Rows = Readonly<Record<string, unknown>>;

/** The rows of one table as objects (damaged rows skipped). */
function rowsOf(tables: SnapshotTables, table: string): Rows[] {
  const records = (tables as Readonly<Record<string, unknown>>)[table];
  if (typeof records !== 'object' || records === null) return [];
  const out: Rows[] = [];
  for (const record of Object.values(records as Rows)) {
    if (typeof record === 'object' && record !== null && !Array.isArray(record)) out.push(record as Rows);
  }
  return out;
}

const isLive = (row: Rows): boolean => row['deleted'] === null || row['deleted'] === undefined;

/** Tables whose live records only an M6a app (schema 3) can edit (M6A-SPEC §4.2). */
const V3_TABLES = ['meshes', 'groups', 'imagePlanes', 'skeletons', 'joints'] as const;

/**
 * Lowest app schema version that evaluates this content correctly (M2A-SPEC §5.7, M6A-SPEC §4.2): **3** when any
 * live record exists in meshes, groups, imagePlanes, skeletons or joints, any asset has ext 'png'/'jpg' (an M2a
 * validator rejects those values) or any live character has `source.kind === 'model'`; otherwise **2** when any live
 * (not soft-deleted) solver record is enabled with type 'ik2', else 1. Palettes, swatches and asset provenance alone
 * do not raise it: older apps preserve them as unknown tables and fields. Pure; Node-safe; damaged rows are ignored,
 * never rejected.
 */
export function requiredWriterVersion(tables: SnapshotTables): number {
  for (const table of V3_TABLES) if (rowsOf(tables, table).some(isLive)) return 3;
  for (const asset of rowsOf(tables, 'assets')) if (asset['ext'] === 'png' || asset['ext'] === 'jpg') return 3;
  for (const character of rowsOf(tables, 'characters')) {
    const source = character['source'];
    if (isLive(character) && typeof source === 'object' && source !== null && (source as Rows)['kind'] === 'model') {
      return 3;
    }
  }
  for (const row of rowsOf(tables, 'solvers')) {
    if (row['type'] === 'ik2' && row['enabled'] === true && isLive(row)) return 2;
  }
  return 1;
}
