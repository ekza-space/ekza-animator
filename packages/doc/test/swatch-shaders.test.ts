// SHADING-SPEC §2 (ADR 0019): swatch shaders — the swatches table v1 → v2 migration, validation, repairs and the
// newer-table read-only rule.
import { describe, expect, it } from 'vitest';
import {
  createMemoryStore,
  emptySnapshot,
  getTableDef,
  migrateSnapshot,
  repairRecord,
  requiredWriterVersion,
  SWATCH_SHADER_DEFAULTS,
  serializeSnapshot,
  validateRecord,
} from '../src';
import { makeTestPalette, makeTestSwatch } from '../src/testing';

/** A schema 3 document whose swatches table is at version 1 (written by v0.3.0: no shader fields). */
function v1Document(): Record<string, unknown> {
  const snapshot = emptySnapshot('Shading') as unknown as {
    tableVersions: Record<string, number>;
    tables: Record<string, Record<string, unknown>>;
  };
  const palette = makeTestPalette('pal_aaaaaaaaaaaaaaaa');
  const { shader: _s, glossiness: _g, specular: _p, ...old } = makeTestSwatch('sw_aaaaaaaaaaaaaaaa', palette.id, 0);
  return {
    ...snapshot,
    tableVersions: { ...snapshot.tableVersions, swatches: 1 },
    tables: { ...snapshot.tables, palettes: { [palette.id]: palette }, swatches: { [old.id]: old } },
  };
}

describe('swatches table version 2 (SHADING-SPEC §2)', () => {
  it('registers version 2 with one migration', () => {
    const def = getTableDef('swatches');
    expect(def?.version).toBe(2);
    expect(def?.migrations).toHaveLength(1);
    expect(emptySnapshot().tableVersions['swatches']).toBe(2);
  });

  it('migrates v1 swatches to Lambert with the defaults, idempotently', () => {
    const { snapshot, readOnly } = migrateSnapshot(v1Document());
    expect(readOnly).toBe(false);
    expect(snapshot.tableVersions['swatches']).toBe(2);
    const swatch = snapshot.tables.swatches['sw_aaaaaaaaaaaaaaaa' as never];
    expect(swatch).toMatchObject({
      shader: 'lambert',
      glossiness: 0.5,
      specular: [255, 255, 255],
      srgb: [128, 128, 128],
    });
    expect(validateRecord('swatches', swatch)).toEqual([]);
    const twice = migrateSnapshot(JSON.parse(serializeSnapshot(snapshot)));
    expect(serializeSnapshot(twice.snapshot)).toBe(serializeSnapshot(snapshot));
    // The migration is pure: the input document is not modified.
    const raw = v1Document();
    migrateSnapshot(raw);
    expect(
      'shader' in (raw['tables'] as Record<string, Record<string, object>>)['swatches']!['sw_aaaaaaaaaaaaaaaa']!,
    ).toBe(false);
  });

  it('keeps Blinn swatches as they are and stores them through a memory store', () => {
    const doc = v1Document() as { tables: Record<string, Record<string, unknown>> };
    const blinn = makeTestSwatch('sw_bbbbbbbbbbbbbbbb', 'pal_aaaaaaaaaaaaaaaa', 1, {
      shader: 'blinn',
      glossiness: 0.8,
      specular: [200, 180, 160],
    });
    doc.tables['swatches'] = { ...doc.tables['swatches'], [blinn.id]: blinn };
    const { snapshot } = migrateSnapshot(doc);
    expect(snapshot.tables.swatches[blinn.id]).toEqual(blinn);
    const store = createMemoryStore();
    store.load(snapshot);
    expect(store.readOnly).toBe(false);
    expect(store.get('swatches', blinn.id)).toEqual(blinn);
    expect(store.snapshot().tableVersions['swatches']).toBe(2);
    // Shaders alone do not raise the writer version (older apps keep unknown fields; the table version guards them).
    expect(requiredWriterVersion(store.snapshot().tables)).toBe(1);
  });

  it('opens a document with a newer swatches table read-only', () => {
    const doc = { ...emptySnapshot(), tableVersions: { ...emptySnapshot().tableVersions, swatches: 3 } };
    expect(migrateSnapshot(doc).readOnly).toBe(true);
    const store = createMemoryStore();
    store.load(doc);
    expect(store.readOnly).toBe(true);
  });

  it('validates the shader fields', () => {
    const ok = makeTestSwatch('sw_cccccccccccccccc', 'pal_aaaaaaaaaaaaaaaa', 2, { shader: 'blinn', glossiness: 1 });
    expect(validateRecord('swatches', ok)).toEqual([]);
    expect(validateRecord('swatches', { ...ok, shader: 'phong' })).toEqual([expect.stringMatching(/^shader:/)]);
    expect(validateRecord('swatches', { ...ok, glossiness: 1.5 })).toEqual([expect.stringMatching(/^glossiness:/)]);
    expect(validateRecord('swatches', { ...ok, glossiness: Number.NaN })).toHaveLength(1);
    expect(validateRecord('swatches', { ...ok, specular: [0, 0] })).toHaveLength(1);
    expect(validateRecord('swatches', { ...ok, specular: [0, 0, 256] })).toHaveLength(1);
  });

  it('repairs damaged shader fields and leaves good records untouched', () => {
    const good = makeTestSwatch('sw_dddddddddddddddd', 'pal_aaaaaaaaaaaaaaaa', 3);
    expect(repairRecord('swatches', good).record).toBe(good);
    const fixed = repairRecord('swatches', { ...good, shader: 'phong', glossiness: 3, specular: [300, -1, 2.6] });
    expect(fixed.record).toMatchObject({ shader: 'lambert', glossiness: 1, specular: [255, 0, 3] });
    expect(fixed.problems).toHaveLength(3);
    const missing = repairRecord('swatches', { ...good, glossiness: 'x', specular: null });
    expect(missing.record).toMatchObject({ glossiness: SWATCH_SHADER_DEFAULTS.glossiness, specular: [255, 255, 255] });
    expect(validateRecord('swatches', fixed.record)).toEqual([]);
    expect(repairRecord('swatches', fixed.record).record).toBe(fixed.record);
  });
});
