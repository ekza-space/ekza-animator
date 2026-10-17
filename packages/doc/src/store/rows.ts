// Untyped record plumbing shared by the store, queries and undo. Built-in tables are typed at the API boundary;
// internally every record is a `Row` so opaque (unknown) tables flow through the same code.
import type { Partition } from '../records';
import { mergeUnitOf } from '../tables/registry';
import { diffFields } from './diff';

/** Any stored record. */
export interface Row {
  readonly id: string;
  readonly [field: string]: unknown;
}

/** A stored record and the partition it was assigned when it was last written. */
export interface Entry {
  readonly record: Row;
  readonly partition: Partition;
}

/** Loosely typed `Change` (cast to `AnyChange` at the API boundary). */
export interface RowChange {
  readonly table: string;
  readonly id: string;
  readonly before: Row | undefined;
  readonly after: Row | undefined;
  readonly fields?: readonly string[];
}

/** Map key of a record: table and id joined by NUL (neither may contain it). */
export function rowKey(table: string, id: string): string {
  return `${table}\u0000${id}`;
}

/** A change; `fields` only for updates of field-merge tables (MVP-SPEC §4.2 `Change`). */
export function makeChange(table: string, id: string, before: Row | undefined, after: Row | undefined): RowChange {
  if (before !== undefined && after !== undefined && mergeUnitOf(table) === 'field') {
    return { table, id, before, after, fields: diffFields(before, after) };
  }
  return { table, id, before, after };
}

/** True when a record carries a tombstone (`deleted` is neither null nor absent). */
export function hasTombstone(record: Row): boolean {
  const deleted = record['deleted'];
  return deleted !== null && deleted !== undefined;
}

/** A shallow copy without top-level `undefined` values: stored records never alias the caller's object. */
export function normalizeRow(record: object): Row {
  const out: Record<string, unknown> = {};
  for (const key in record) {
    if (!Object.hasOwn(record, key)) continue;
    const value = (record as Readonly<Record<string, unknown>>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as Row;
}
