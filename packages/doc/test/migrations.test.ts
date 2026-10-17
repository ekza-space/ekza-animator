import { describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  deriveMigratedId,
  type DocSnapshot,
  emptySnapshot,
  migrateSnapshot,
  registerTable,
  SCHEMA_VERSION,
  serializeSnapshot,
  type TableDef,
} from '../src';
import { makeTestDocument } from '../src/testing';

describe('deriveMigratedId', () => {
  it('is deterministic, depends on id and purpose, and keeps the prefix and length', () => {
    const id = deriveMigratedId('crv_abcdefghijklmnop', 'split:x');
    expect(id).toMatch(/^crv_[0-9A-Za-z]{16}$/);
    expect(deriveMigratedId('crv_abcdefghijklmnop', 'split:x')).toBe(id);
    expect(deriveMigratedId('crv_abcdefghijklmnop', 'split:y')).not.toBe(id);
    expect(deriveMigratedId('crv_abcdefghijklmnoq', 'split:x')).not.toBe(id);
    expect(deriveMigratedId('k_abcdefghijkl', 'p')).toMatch(/^k_[0-9A-Za-z]{12}$/);
    expect(deriveMigratedId('rig_abcdefghijklmnop:fk.hips', 'p')).toMatch(/^rig_abcdefghijklmnop:[0-9A-Za-z]{16}$/);
    expect(deriveMigratedId('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'p')).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(deriveMigratedId('project', 'p')).toMatch(/^[0-9A-Za-z]{16}$/);
  });

  it('spreads derived ids (no collisions over many inputs)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(deriveMigratedId(`k_${String(i).padStart(12, '0')}`, 'purpose'));
    expect(ids.size).toBe(5000);
  });
});

describe('migrateSnapshot (v1 baseline)', () => {
  it('returns current snapshots unchanged, idempotently', () => {
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 2 });
    const once = migrateSnapshot(JSON.parse(JSON.stringify(doc)));
    expect(once).toMatchObject({ migratedFrom: SCHEMA_VERSION, readOnly: false });
    expect(once.snapshot).toEqual(doc);
    const twice = migrateSnapshot(JSON.parse(serializeSnapshot(once.snapshot)));
    expect(serializeSnapshot(twice.snapshot)).toBe(serializeSnapshot(once.snapshot));
  });

  it('fills missing built-in tables and table versions', () => {
    const { snapshot } = migrateSnapshot({
      format: 'ekza-animator-doc',
      schemaVersion: 1,
      minWriterVersion: 1,
      tables: {},
    });
    expect(snapshot).toEqual({ ...emptySnapshot(), tables: { ...emptySnapshot().tables, project: {} } });
  });

  it('repairs records: missing ids take their key, mis-keyed records move to their id, non-objects are dropped', () => {
    const { snapshot } = migrateSnapshot({
      format: 'ekza-animator-doc',
      schemaVersion: 1,
      minWriterVersion: 1,
      tableVersions: {},
      tables: { 'x.t': { a: { v: 1 }, b: { id: 'c', v: 2 }, d: 'junk' } },
    });
    expect((snapshot.tables as unknown as Record<string, unknown>)['x.t']).toEqual({
      a: { id: 'a', v: 1 },
      c: { id: 'c', v: 2 },
    });
  });

  it('opens newer projects read-only and keeps what it cannot migrate', () => {
    const base = emptySnapshot();
    expect(migrateSnapshot({ ...base, minWriterVersion: SCHEMA_VERSION + 1 }).readOnly).toBe(true);
    const newerCore = migrateSnapshot({ ...base, schemaVersion: SCHEMA_VERSION + 3 });
    expect(newerCore.readOnly).toBe(false);
    expect(newerCore.snapshot.schemaVersion).toBe(SCHEMA_VERSION + 3);
    const newerTable = migrateSnapshot({ ...base, tableVersions: { ...base.tableVersions, keys: 2 } });
    expect(newerTable.readOnly).toBe(true);
    expect(newerTable.snapshot.tableVersions['keys']).toBe(2);
    const store = createMemoryStore();
    store.load(newerTable.snapshot);
    expect(store.readOnly).toBe(true);
  });

  it('rejects things that are not snapshots', () => {
    for (const raw of [
      null,
      [],
      'x',
      { format: 'other' },
      { format: 'ekza-animator-doc', schemaVersion: 0, tables: {} },
      { format: 'ekza-animator-doc', schemaVersion: 1, tables: [] },
      { format: 'ekza-animator-doc', schemaVersion: 1, tables: { keys: 1 } },
    ]) {
      expect(() => migrateSnapshot(raw)).toThrow(expect.objectContaining({ code: 'invalid-record' }));
    }
  });
});

describe('per-table migrations', () => {
  // A registered extension table at version 3: v1 → v2 renames `text` to `body`; v2 → v3 splits every note into a
  // note plus a derived "audit" id.
  const def: TableDef = {
    name: 'acme.notes',
    version: 3,
    mergeUnit: 'field',
    softDelete: false,
    partition: () => 'scene',
    validate: () => [],
    migrations: [
      (record) => {
        const { text, ...rest } = record as { text?: string };
        return text === undefined ? rest : { ...rest, body: text };
      },
      (record) => {
        const note = record as { id: string; audit?: string };
        return note.audit !== undefined ? note : { ...note, audit: deriveMigratedId(note.id, 'audit') };
      },
    ],
  };

  it('migrates records from their table version and is idempotent', () => {
    const dispose = registerTable(def);
    try {
      const raw = {
        ...emptySnapshot(),
        tableVersions: { ...emptySnapshot().tableVersions, 'acme.notes': 1 },
        tables: { ...emptySnapshot().tables, 'acme.notes': { n1: { id: 'n1', text: 'hello' }, n2: { id: 'n2' } } },
      };
      const first = migrateSnapshot(raw);
      const notes = (first.snapshot.tables as unknown as Record<string, Record<string, Record<string, unknown>>>)[
        'acme.notes'
      ];
      expect(notes?.['n1']).toEqual({ id: 'n1', body: 'hello', audit: deriveMigratedId('n1', 'audit') });
      expect(first.snapshot.tableVersions['acme.notes']).toBe(3);
      const second = migrateSnapshot(JSON.parse(JSON.stringify(first.snapshot)));
      expect(second.snapshot).toEqual(first.snapshot);
      // Two clients migrating concurrently write identical records.
      expect(serializeSnapshot(migrateSnapshot(raw).snapshot)).toBe(serializeSnapshot(first.snapshot));
    } finally {
      dispose();
    }
  });

  it('keeps unregistered tables at their version and opaque', () => {
    const raw = {
      ...emptySnapshot(),
      tableVersions: { ...emptySnapshot().tableVersions, 'acme.notes': 1 },
      tables: { ...emptySnapshot().tables, 'acme.notes': { n1: { id: 'n1', text: 'hello' } } },
    };
    const { snapshot, readOnly } = migrateSnapshot(raw);
    expect(readOnly).toBe(false);
    expect(snapshot.tableVersions['acme.notes']).toBe(1);
    expect((snapshot.tables as unknown as Record<string, unknown>)['acme.notes']).toEqual({
      n1: { id: 'n1', text: 'hello' },
    });
    const store = createMemoryStore();
    store.load(snapshot as DocSnapshot);
    expect(store.snapshot()).toEqual(snapshot);
  });
});
