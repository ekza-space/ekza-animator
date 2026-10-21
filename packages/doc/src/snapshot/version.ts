import type { SnapshotTables } from '../store';

/**
 * Core document format version written by this build (DocSnapshot.schemaVersion, ProjectRecord.schemaVersion).
 * 2 since M2a (M2A-SPEC §4.2): `ik2` solver records evaluate the legs and arms, attribute curves and breakdown keys.
 * 3 since M6a (M6A-SPEC §4.2): the seven modeling tables, `CharacterRecord.source`, `AssetRecord.provenance` and
 * reference-image assets. 4 since M6b (M6B-SPEC §4.1): `CharacterRecord.vrm`, `JointRecord.role`/`key`,
 * `ControlShape.edited`, test clips and thumbnail assets. Schema 1 documents migrate by the identity
 * (`CORE_MIGRATIONS[0]`), schema 2 documents by `CORE_MIGRATIONS[1]`, schema 3 documents by `CORE_MIGRATIONS[2]`.
 */
export const SCHEMA_VERSION = 4;
/** Snapshot `format` marker: an on-disk identifier, kept unchanged by the Ekza Studio rename (DECISIONS-OPEN NAME-1). */
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

/** Built-in constraint types: an enabled live one needs the M6b evaluator (M6B-SPEC §4.1). */
const BUILTIN_CONSTRAINTS = new Set<unknown>(['parent', 'point', 'orient', 'aim']);

/**
 * Lowest app schema version that evaluates this content correctly (M2A-SPEC §5.7, M6A-SPEC §4.2, M6B-SPEC §4.1):
 * **4** when any live skeletons record exists, any live character has `source.kind === 'model'`, any live enabled
 * constraint has a built-in type (parent, point, orient, aim), any live clip has `source.kind === 'test'` or any asset
 * has role 'thumbnail' (a v0.3.x app opens such a project read-only instead of showing a wrong pose); otherwise **3**
 * when any live record exists in meshes, groups, imagePlanes or joints or any asset has ext 'png'/'jpg' (an M2a
 * validator rejects those values); otherwise **2** when any live (not soft-deleted) solver record is enabled with type
 * 'ik2', else 1. `ControlShape.edited` and new shape kinds alone do not raise it. Palettes, swatches and asset provenance alone
 * do not raise it: older apps preserve them as unknown tables and fields. Pure; Node-safe; damaged rows are ignored,
 * never rejected.
 */
export function requiredWriterVersion(tables: SnapshotTables): number {
  if (rowsOf(tables, 'skeletons').some(isLive)) return 4;
  for (const character of rowsOf(tables, 'characters')) {
    const source = character['source'];
    if (isLive(character) && typeof source === 'object' && source !== null && (source as Rows)['kind'] === 'model') {
      return 4;
    }
  }
  for (const row of rowsOf(tables, 'constraints')) {
    if (isLive(row) && row['enabled'] === true && BUILTIN_CONSTRAINTS.has(row['type'])) return 4;
  }
  for (const clip of rowsOf(tables, 'clips')) {
    const source = clip['source'];
    if (isLive(clip) && typeof source === 'object' && source !== null && (source as Rows)['kind'] === 'test') return 4;
  }
  for (const asset of rowsOf(tables, 'assets')) if (asset['role'] === 'thumbnail') return 4;
  for (const table of V3_TABLES) if (rowsOf(tables, table).some(isLive)) return 3;
  for (const asset of rowsOf(tables, 'assets')) if (asset['ext'] === 'png' || asset['ext'] === 'jpg') return 3;
  for (const row of rowsOf(tables, 'solvers')) {
    if (row['type'] === 'ik2' && row['enabled'] === true && isLive(row)) return 2;
  }
  return 1;
}
