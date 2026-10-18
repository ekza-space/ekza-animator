// M2A-SPEC §4.2 (A0): schema version 2, the identity migration from schema 1, `requiredWriterVersion`, the snapshot
// rule of the memory store, fresh writers at minWriterVersion 1, the AttrDef additions and `solverId`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ControlId,
  createMemoryStore,
  type DocSnapshot,
  deriveMigratedId,
  emptySnapshot,
  makeProject,
  migrateSnapshot,
  parseSnapshot,
  type RigId,
  requiredWriterVersion,
  SCHEMA_VERSION,
  type SnapshotTables,
  type SolverId,
  type SolverRecord,
  serializeSnapshot,
  solverId,
  validateRecord,
} from '../src';
import type * as MigrateModuleNs from '../src/migrations/migrate';
import type * as VersionModuleNs from '../src/snapshot/version';
import { makeTestControl, makeTestDocument } from '../src/testing';

type MigrateModule = typeof MigrateModuleNs;
type VersionModule = typeof VersionModuleNs;

function firstRig(doc: DocSnapshot): RigId {
  return Object.keys(doc.tables.rigs)[0] as RigId;
}

function solver(rig: RigId, key: string, fields?: Partial<SolverRecord>): SolverRecord {
  return {
    id: solverId(rig, key),
    rig,
    type: 'ik2',
    params: { v: 1 },
    enabled: true,
    deleted: null,
    ...fields,
  };
}

function withSolvers(doc: DocSnapshot, solvers: readonly SolverRecord[]): DocSnapshot {
  const rows: Record<string, SolverRecord> = {};
  for (const record of solvers) rows[record.id] = record;
  return { ...doc, tables: { ...doc.tables, solvers: rows } };
}

/** A schema 1 document as M1 wrote it (schemaVersion 1, minWriterVersion 1). */
function m1Document(): DocSnapshot {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 2 });
  const project = { ...doc.tables.project.project, schemaVersion: 1, minWriterVersion: 1 };
  return {
    ...doc,
    schemaVersion: 1,
    minWriterVersion: 1,
    tables: { ...doc.tables, project: { project } } as unknown as SnapshotTables,
  };
}

describe('schema version 2', () => {
  it('is the version this build writes', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(emptySnapshot().schemaVersion).toBe(2);
    expect(makeProject().schemaVersion).toBe(2);
  });

  it('fresh writers write minWriterVersion 1 (item 3)', () => {
    expect(emptySnapshot().minWriterVersion).toBe(1);
    expect(makeProject().minWriterVersion).toBe(1);
    expect(createMemoryStore().snapshot().minWriterVersion).toBe(1);
  });
});

describe('requiredWriterVersion', () => {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 1 });
  const rig = firstRig(doc);

  it('is 1 without solvers and with solvers that are not enabled live ik2 records', () => {
    expect(requiredWriterVersion(doc.tables)).toBe(1);
    expect(requiredWriterVersion(withSolvers(doc, [solver(rig, 'ik2.leg.L', { enabled: false })]).tables)).toBe(1);
    expect(
      requiredWriterVersion(
        withSolvers(doc, [solver(rig, 'ik2.leg.L', { deleted: { by: 'local' as never, at: 1 } })]).tables,
      ),
    ).toBe(1);
    expect(requiredWriterVersion(withSolvers(doc, [solver(rig, 'roll', { type: 'footRoll' })]).tables)).toBe(1);
    expect(requiredWriterVersion(withSolvers(doc, [solver(rig, 'chain', { type: 'chain' })]).tables)).toBe(1);
  });

  it('is 2 with one enabled live ik2 solver', () => {
    const tables = withSolvers(doc, [
      solver(rig, 'ik2.leg.L', { enabled: false }),
      solver(rig, 'ik2.leg.R'),
      solver(rig, 'roll', { type: 'footRoll' }),
    ]).tables;
    expect(requiredWriterVersion(tables)).toBe(2);
  });

  it('ignores damaged rows and missing tables (repair, never reject)', () => {
    const damaged = {
      ...doc.tables,
      solvers: { a: null, b: 'junk', c: { type: 'ik2', enabled: 'yes' }, d: { type: 'ik2', enabled: true } },
    } as unknown as SnapshotTables;
    expect(requiredWriterVersion(damaged)).toBe(2);
    const { solvers: _solvers, ...rest } = doc.tables as unknown as Record<string, unknown>;
    expect(requiredWriterVersion(rest as unknown as SnapshotTables)).toBe(1);
  });
});

describe('the snapshot rule (memory store, item 2)', () => {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 1 });
  const rig = firstRig(doc);

  it('fresh document 1, enabled IK 2, IK disabled or deleted back to 1', () => {
    const store = createMemoryStore();
    store.load(doc);
    expect(store.snapshot().minWriterVersion).toBe(1);
    const record = solver(rig, 'ik2.leg.L');
    store.transact({ label: 'Add Limb IK' }, (tx) => tx.put('solvers', record));
    expect(store.snapshot().minWriterVersion).toBe(2);
    store.transact({ label: 'Disable' }, (tx) => tx.patch('solvers', record.id, { enabled: false }));
    expect(store.snapshot().minWriterVersion).toBe(1);
    store.transact({ label: 'Enable' }, (tx) => tx.patch('solvers', record.id, { enabled: true }));
    expect(store.snapshot().minWriterVersion).toBe(2);
    store.transact({ label: 'Delete' }, (tx) => tx.softDelete('solvers', record.id));
    expect(store.snapshot().minWriterVersion).toBe(1);
    store.undo.undo();
    expect(store.snapshot().minWriterVersion).toBe(2);
  });

  it('a loaded future value is kept; a loaded current value follows the content', () => {
    const future = createMemoryStore();
    future.load({ ...doc, minWriterVersion: SCHEMA_VERSION + 1 });
    expect(future.readOnly).toBe(true);
    expect(future.snapshot().minWriterVersion).toBe(SCHEMA_VERSION + 1);

    // An M2a document whose last ik2 solver is gone drops back to 1 on the next save.
    const current = createMemoryStore();
    current.load({ ...doc, minWriterVersion: 2 });
    expect(current.readOnly).toBe(false);
    expect(current.snapshot().minWriterVersion).toBe(1);
    const withIk = withSolvers(doc, [solver(rig, 'ik2.arm.L')]);
    current.load({ ...withIk, minWriterVersion: 2 });
    expect(current.snapshot().minWriterVersion).toBe(2);
  });

  it('the project record keeps its own minWriterVersion (item 4)', () => {
    const store = createMemoryStore();
    store.load(doc);
    store.transact({ label: 'Add Limb IK' }, (tx) => tx.put('solvers', solver(rig, 'ik2.leg.L')));
    const snapshot = store.snapshot();
    expect(snapshot.minWriterVersion).toBe(2);
    expect(snapshot.tables.project.project?.minWriterVersion).toBe(doc.tables.project.project?.minWriterVersion);
  });
});

describe('migration 1 → 2', () => {
  it('is the identity on records and idempotent', () => {
    const m1 = m1Document();
    const once = migrateSnapshot(JSON.parse(serializeSnapshot(m1)));
    expect(once.migratedFrom).toBe(1);
    expect(once.readOnly).toBe(false);
    expect(once.snapshot.schemaVersion).toBe(2);
    expect(once.snapshot.minWriterVersion).toBe(1);
    expect(once.snapshot.tables).toEqual(m1.tables);
    expect(once.snapshot.tableVersions).toEqual(m1.tableVersions);
    const twice = migrateSnapshot(JSON.parse(serializeSnapshot(once.snapshot)));
    expect(twice.migratedFrom).toBe(2);
    expect(serializeSnapshot(twice.snapshot)).toBe(serializeSnapshot(once.snapshot));
  });

  it('an M1 project opens writable and saves schemaVersion 2 / minWriterVersion 1', () => {
    const text = serializeSnapshot(m1Document());
    const { snapshot, readOnly } = migrateSnapshot(parseSnapshot(text));
    expect(readOnly).toBe(false);
    const store = createMemoryStore();
    store.load(snapshot);
    expect(store.readOnly).toBe(false);
    const control = Object.keys(snapshot.tables.controls)[0] as ControlId;
    store.transact({ label: 'Rename' }, (tx) => tx.patch('controls', control, { name: 'Renamed' }));
    const saved = store.snapshot();
    expect(saved.schemaVersion).toBe(2);
    expect(saved.minWriterVersion).toBe(1);
  });

  it('keeps an attribute definition and breakdown flags of schema 1 records verbatim', () => {
    const m1 = m1Document();
    const rig = firstRig(m1);
    const control = {
      ...makeTestControl({ rig, key: 'custom', parent: null, order: 'z0' }),
      attrs: { flex: { type: 'float', default: 0.5, keyable: true, futureField: 1 } },
    };
    const raw = {
      ...m1,
      tables: { ...m1.tables, controls: { ...m1.tables.controls, [control.id]: control } },
    } as unknown as DocSnapshot;
    const { snapshot } = migrateSnapshot(JSON.parse(serializeSnapshot(raw)));
    expect(snapshot.tables.controls[control.id]).toEqual(control);
  });
});

describe('an M1 reader (simulated SCHEMA_VERSION 1)', () => {
  afterEach(() => {
    vi.doUnmock('../src/snapshot/version');
    vi.resetModules();
  });

  it('opens an IK project read-only and a project without IK writable', async () => {
    vi.resetModules();
    vi.doMock('../src/snapshot/version', async (importOriginal) => {
      const actual = await importOriginal<VersionModule>();
      return { ...actual, SCHEMA_VERSION: 1 };
    });
    const m1: MigrateModule = await import('../src/migrations/migrate');
    const store = createMemoryStore();
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 1 });
    store.load(doc);
    const plain = JSON.parse(serializeSnapshot(store.snapshot())) as unknown;
    expect(m1.migrateSnapshot(plain).readOnly).toBe(false);
    store.transact({ label: 'Add Limb IK' }, (tx) => tx.put('solvers', solver(firstRig(doc), 'ik2.leg.L')));
    const ik = JSON.parse(serializeSnapshot(store.snapshot())) as unknown;
    const opened = m1.migrateSnapshot(ik);
    expect(opened.readOnly).toBe(true);
    // The M1 reader keeps the newer schema version as is (it cannot migrate down).
    expect(opened.snapshot.schemaVersion).toBe(2);
  });
});

describe('AttrDef (§4.2 additions)', () => {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 1, keysPerCurve: 1 });
  const rig = firstRig(doc);
  const withAttr = (attr: Record<string, unknown>): unknown => ({
    ...makeTestControl({ rig, key: 'ik.leg.L', parent: null, order: 'a0' }),
    attrs: { roll: attr },
  });
  const base = { type: 'float', default: 0, keyable: true };

  it('accepts the new optional fields', () => {
    expect(validateRecord('controls', withAttr(base))).toEqual([]);
    expect(
      validateRecord(
        'controls',
        withAttr({
          ...base,
          min: 0,
          max: 1,
          stepped: true,
          label: 'Roll',
          unit: 'angle',
          mirror: 'negate',
          keyAll: false,
        }),
      ),
    ).toEqual([]);
    expect(validateRecord('controls', withAttr({ ...base, unit: 'distance', mirror: 'copy', keyAll: true }))).toEqual(
      [],
    );
  });

  it('rejects wrong types', () => {
    const problems = (attr: Record<string, unknown>): readonly string[] =>
      validateRecord('controls', withAttr({ ...base, ...attr }));
    expect(problems({ label: 5 })).toEqual([expect.stringContaining('attrs.roll.label')]);
    expect(problems({ unit: 'degrees' })).toEqual([expect.stringContaining('attrs.roll.unit')]);
    expect(problems({ mirror: 'flip' })).toEqual([expect.stringContaining('attrs.roll.mirror')]);
    expect(problems({ keyAll: 'no' })).toEqual([expect.stringContaining('attrs.roll.keyAll')]);
  });

  it('never rejects a loaded document', () => {
    const control = withAttr({ ...base, unit: 'degrees', keyAll: 'no' }) as { id: string };
    const raw = {
      ...doc,
      tables: { ...doc.tables, controls: { ...doc.tables.controls, [control.id]: control } },
    } as unknown as DocSnapshot;
    const { snapshot } = migrateSnapshot(JSON.parse(serializeSnapshot(raw)));
    const store = createMemoryStore();
    store.load(snapshot);
    expect(store.get('controls', control.id as ControlId)).toEqual(control);
  });
});

describe('solverId', () => {
  const rig = 'rig_0123456789abcdef' as RigId;

  it('is deterministic: slv_ + 16 base62 of sha256(rig:templateKey)', () => {
    const id = solverId(rig, 'ik2.leg.L');
    expect(id).toMatch(/^slv_[0-9A-Za-z]{16}$/);
    expect(solverId(rig, 'ik2.leg.L')).toBe(id);
    // The derivation of deriveMigratedId (same digest and base62 draw).
    expect(id.slice(4)).toBe(deriveMigratedId(rig, 'ik2.leg.L').slice(4));
  });

  it('differs per template key and rig', () => {
    const ids = new Set<SolverId>([
      solverId(rig, 'ik2.leg.L'),
      solverId(rig, 'ik2.leg.R'),
      solverId(rig, 'ik2.arm.L'),
      solverId('rig_0123456789abcdeg' as RigId, 'ik2.leg.L'),
    ]);
    expect(ids.size).toBe(4);
  });

  it('refuses an empty template key', () => {
    expect(() => solverId(rig, '')).toThrow(expect.objectContaining({ code: 'invalid-record' }));
  });
});
