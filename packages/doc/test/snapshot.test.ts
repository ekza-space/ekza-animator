import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TABLES,
  createMemoryStore,
  type DocSnapshot,
  EkzaError,
  emptySnapshot,
  migrateSnapshot,
  parseSnapshot,
  SCHEMA_VERSION,
  serializeSnapshot,
} from '../src';
import { makeTestDocument, readSyntheticFixture, withSchemaV3 } from '../src/testing';
import { sha256, sha256Hex } from '../src/migrations/sha256';

describe('serializeSnapshot', () => {
  it('is byte-identical across runs and independent of key insertion order', () => {
    const doc = makeTestDocument({ characters: 2, controlsPerRig: 5, keysPerCurve: 3 });
    const text = serializeSnapshot(doc);
    expect(serializeSnapshot(makeTestDocument({ characters: 2, controlsPerRig: 5, keysPerCurve: 3 }))).toBe(text);
    const reversed = reverseKeys(doc) as DocSnapshot;
    expect(serializeSnapshot(reversed)).toBe(text);
    expect(serializeSnapshot(parseSnapshot(text) as DocSnapshot)).toBe(text);
  });

  it('sorts keys at every level, inlines leaf objects and ends with a newline', () => {
    const text = serializeSnapshot(emptySnapshot('Shot'));
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('"sceneFps": { "den": 1, "num": 30 }');
    const keys = [...text.matchAll(/^ {2}"(\w+)":/gm)].map((m) => m[1]);
    expect(keys).toEqual(['format', 'minWriterVersion', 'schemaVersion', 'tableVersions', 'tables']);
  });

  it('round-trips arbitrary JSON values exactly', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (extra) => {
        const snapshot = {
          ...emptySnapshot(),
          tables: { ...emptySnapshot().tables, 'x.t': { r: { id: 'r', extra } } },
        } as DocSnapshot;
        const parsed = parseSnapshot(serializeSnapshot(snapshot));
        expect(parsed).toEqual(JSON.parse(JSON.stringify(snapshot)));
      }),
    );
  });

  it('refuses values JSON cannot represent', () => {
    const snapshot = {
      ...emptySnapshot(),
      tables: { ...emptySnapshot().tables, x: { r: { id: 'r', v: Number.NaN } } },
    } as DocSnapshot;
    expect(() => serializeSnapshot(snapshot)).toThrow(EkzaError);
  });

  it('parseSnapshot reports bad JSON as invalid-record', () => {
    expect(() => parseSnapshot('{')).toThrow(expect.objectContaining({ code: 'invalid-record' }));
  });
});

describe('emptySnapshot', () => {
  it('has every built-in table, the project record and current versions', () => {
    const snapshot = emptySnapshot('Shot 1');
    expect(snapshot.format).toBe('ekza-animator-doc');
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(snapshot.tables).sort()).toEqual([...BUILTIN_TABLES].sort());
    expect(snapshot.tables.project.project?.name).toBe('Shot 1');
    expect(Object.values(snapshot.tableVersions).every((v) => v === 1)).toBe(true);
    const store = createMemoryStore();
    store.load(snapshot);
    expect(store.snapshot()).toEqual(snapshot);
  });
});

describe('the synthetic wave document', () => {
  // M2A-SPEC §3 rule 8: the fixture stays an M1 (schema 1) document; it migrates to SCHEMA_VERSION 2 by the
  // identity. M6A-SPEC §3 rule 9 (literal update, §4.2 schema v3): 2 → 3 adds `source` to characters and
  // `provenance: null` to assets and the seven empty M6a tables (`withSchemaV3`); nothing else changes.
  it('migrates, loads and snapshots back to the same content', () => {
    const raw = readSyntheticFixture('wave-doc.json') as DocSnapshot;
    expect(raw.schemaVersion).toBe(1);
    const { snapshot, readOnly, migratedFrom } = migrateSnapshot(raw);
    expect(readOnly).toBe(false);
    expect(migratedFrom).toBe(1);
    const store = createMemoryStore();
    store.load(snapshot);
    const written = withSchemaV3(raw);
    expect(written.schemaVersion).toBe(SCHEMA_VERSION);
    expect(store.snapshot()).toEqual(written);
    expect(serializeSnapshot(store.snapshot())).toBe(serializeSnapshot(written));
  });
});

describe('sha256', () => {
  it('matches node:crypto', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
      }),
    );
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reverseKeys(inner)]),
  );
}
