// Plain-record helpers of the naive document store (shared test kit, MVP-SPEC §7 WP-0b). They mirror the doc
// contracts (§4.2) without depending on WP-2's implementation.
import type { MergeUnit, Partition } from '@ekza-animator/doc';

/** Any stored record: built-in tables are typed at the API boundary; unknown tables stay opaque. */
export interface Row {
  readonly id: string;
  readonly [field: string]: unknown;
}

/** Merge unit per table (doc `MERGE_UNIT`); unknown tables merge per field. */
export function mergeUnitOf(table: string): MergeUnit {
  return table === 'keys' || table === 'assets' ? 'record' : 'field';
}

/** Tables whose records carry a `deleted` tombstone. */
export function isSoftDeletable(table: string): boolean {
  return table !== 'project' && table !== 'assets' && table !== 'keys';
}

export function isDeleted(row: Row): boolean {
  return row['deleted'] !== null && row['deleted'] !== undefined;
}

/** Structural equality of JSON-like values (records are plain data). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const ra = a as Readonly<Record<string, unknown>>;
  const rb = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((key) => Object.hasOwn(rb, key) && deepEqual(ra[key], rb[key]));
}

/** Top-level fields whose values differ (a field present on one side only counts as changed). */
export function diffFields(before: Row, after: Row): string[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields].filter((field) => !deepEqual(before[field], after[field])).sort(compareStrings);
}

/** Code-unit order (fractional indexes and IDs compare this way; never locale-dependent). */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sibling order: fractional `order` string, then id. */
export function byOrderThenId(
  a: { readonly id: string; readonly order: string },
  b: { readonly id: string; readonly order: string },
): number {
  return compareStrings(a.order, b.order) || compareStrings(a.id, b.id);
}

/**
 * Partition of a record (ARCHITECTURE §4.2): scene (project, assets, characters, cameras, palettes, swatches, image
 * planes, unknown tables), char:<characterId> (rigs, controls, constraints, solvers, clips, skeletons, joints, meshes and
 * groups owned by a character), clip:<clipId> (layers, curves, keys). `rigCharacter` resolves a rig id for the records
 * that only reference their rig; `skeletonCharacter` a skeleton id for joints (M6a).
 */
export function partitionOfRow(
  table: string,
  row: Row,
  rigCharacter: (rig: string) => string | undefined,
  skeletonCharacter: (skeleton: string) => string | undefined = () => undefined,
): Partition {
  switch (table) {
    case 'rigs':
    case 'clips':
    case 'skeletons':
      return `char:${String(row['character'])}`;
    case 'meshes':
    case 'groups': {
      const owner = row['owner'];
      const character =
        typeof owner === 'object' && owner !== null ? (owner as Readonly<Record<string, unknown>>)['character'] : null;
      return typeof character === 'string' ? `char:${character}` : 'scene';
    }
    case 'joints': {
      const character = skeletonCharacter(String(row['skeleton']));
      return character === undefined ? 'scene' : `char:${character}`;
    }
    case 'controls':
    case 'constraints':
    case 'solvers': {
      const character = rigCharacter(String(row['rig']));
      return character === undefined ? 'scene' : `char:${character}`;
    }
    case 'layers':
    case 'curves':
    case 'keys':
      return `clip:${String(row['clip'])}`;
    default:
      return 'scene';
  }
}
