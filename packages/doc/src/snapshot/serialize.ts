// Deterministic snapshot text (ADR 0011 §2): sorted keys at every level, numbers as shortest round-trip JSON, no
// timestamps, two-space indentation, `\n` line endings and a final newline. Small leaf objects and arrays of
// primitives stay on one line so `project.json` remains readable and diffable. Same snapshot → same bytes.
import { EkzaError } from '@ekza-animator/anim-core';
import { BUILTIN_TABLES } from '../records';
import { makeProject } from '../records/factories';
import type { DocSnapshot, SnapshotTables } from '../store';
import { compareStrings } from '../store/diff';
import { builtinTableVersion } from '../tables/registry';
import { SCHEMA_VERSION, SNAPSHOT_FORMAT } from './version';

export { SCHEMA_VERSION } from './version';

/** Inline width limit for leaf objects and primitive arrays. */
const INLINE_LIMIT = 100;

/** A snapshot with every built-in table, empty except for the project record. */
export function emptySnapshot(projectName?: string): DocSnapshot {
  const project = makeProject(projectName === undefined ? {} : { name: projectName });
  const tables: Record<string, Record<string, unknown>> = {};
  const tableVersions: Record<string, number> = {};
  for (const name of [...BUILTIN_TABLES].sort(compareStrings)) {
    tables[name] = {};
    tableVersions[name] = builtinTableVersion(name);
  }
  tables['project'] = { project };
  return {
    format: SNAPSHOT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    minWriterVersion: 1,
    tableVersions,
    tables: tables as unknown as SnapshotTables,
  };
}

/** Canonical JSON text of a snapshot. Throws `EkzaError('invalid-record')` for values JSON cannot represent. */
export function serializeSnapshot(snapshot: DocSnapshot): string {
  return `${write(snapshot, '', '$')}\n`;
}

/** Parses snapshot text; the result still needs `migrateSnapshot`. Throws `EkzaError('invalid-record')` on bad JSON. */
export function parseSnapshot(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new EkzaError('invalid-record', `parseSnapshot: not valid JSON (${(error as Error).message})`, {
      cause: error,
    });
  }
}

function write(value: unknown, indent: string, path: string): string {
  if (value === null) return 'null';
  // Exhaustive over typeof; the trailing throw only satisfies the return-type check.
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw unrepresentable(path, String(value));
      return JSON.stringify(value);
    case 'object':
      return Array.isArray(value) ? writeArray(value, indent, path) : writeObject(value, indent, path);
    case 'undefined':
    case 'bigint':
    case 'function':
    case 'symbol':
      throw unrepresentable(path, typeof value);
  }
  throw unrepresentable(path, typeof value);
}

function writeArray(items: readonly unknown[], indent: string, path: string): string {
  if (items.length === 0) return '[]';
  const inner = `${indent}  `;
  const parts = items.map((item, i) => write(item === undefined ? null : item, inner, `${path}[${i}]`));
  if (items.every(isPrimitive)) {
    const inline = `[${parts.join(', ')}]`;
    if (inline.length <= INLINE_LIMIT) return inline;
  }
  return `[\n${parts.map((part) => inner + part).join(',\n')}\n${indent}]`;
}

function writeObject(object: object, indent: string, path: string): string {
  const record = object as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareStrings);
  if (keys.length === 0) return '{}';
  const inner = `${indent}  `;
  const parts = keys.map((key) => `${JSON.stringify(key)}: ${write(record[key], inner, `${path}.${key}`)}`);
  if (keys.every((key) => isLeaf(record[key]))) {
    const inline = `{ ${parts.join(', ')} }`;
    if (inline.length <= INLINE_LIMIT) return inline;
  }
  return `{\n${parts.map((part) => inner + part).join(',\n')}\n${indent}}`;
}

function isPrimitive(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

/** Primitive, or an array of primitives: such objects may be written on one line. */
function isLeaf(value: unknown): boolean {
  return isPrimitive(value) || (Array.isArray(value) && value.every(isPrimitive));
}

function unrepresentable(path: string, what: string): EkzaError {
  return new EkzaError('invalid-record', `serializeSnapshot: ${path} holds ${what}, which JSON cannot represent`, {
    path,
  });
}
