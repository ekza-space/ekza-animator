import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TABLES,
  type CharacterId,
  type ClipId,
  type ControlId,
  type DocSnapshot,
  EkzaError,
  getTableDef,
  isSoftDeletable,
  type KeyRecord,
  type LayerId,
  makeCamera,
  makeClip,
  makeCurve,
  makeKey,
  makeLayer,
  makeProject,
  MERGE_UNIT,
  mergeUnitOf,
  type PartitionLookup,
  partitionOf,
  type RecordOf,
  type RigId,
  registerTable,
  type TableDef,
  type TableName,
  toAnimCurve,
  validateRecord,
} from '../src';
import { makeTestDocument, readSyntheticFixture } from '../src/testing';

const lookup: PartitionLookup = { rigCharacter: (rig) => (rig === 'rig_A' ? ('chr_A' as CharacterId) : undefined) };

function firstRecord<T extends TableName>(snapshot: DocSnapshot, table: T): RecordOf<T> {
  const rows: Readonly<Record<string, unknown>> = snapshot.tables[table];
  const record = Object.values(rows)[0];
  if (record === undefined) throw new Error(`no ${table} record`);
  return record as RecordOf<T>;
}

describe('validateRecord', () => {
  it('accepts every record of the synthetic fixture and of makeTestDocument', () => {
    for (const snapshot of [
      readSyntheticFixture('wave-doc.json') as DocSnapshot,
      makeTestDocument({ characters: 2 }),
    ]) {
      for (const table of BUILTIN_TABLES) {
        for (const record of Object.values(snapshot.tables[table])) {
          expect(validateRecord(table, record), `${table}/${(record as { id: string }).id}`).toEqual([]);
        }
      }
    }
  });

  it('reports precise problems', () => {
    const doc = makeTestDocument();
    const key = firstRecord(doc, 'keys');
    expect(validateRecord('keys', { ...key, t: Number.NaN })).toEqual(['t: expected a finite number']);
    expect(validateRecord('keys', { ...key, inHandle: { dt: 1, dv: 0 } })).toEqual(['inHandle.dt: expected ≤ 0']);
    expect(validateRecord('keys', { ...key, outType: 'bouncy' })).toEqual(['outType: expected a tangent type']);
    const clip = firstRecord(doc, 'clips');
    expect(validateRecord('clips', { ...clip, name: 'bad|name' })).toEqual([
      'name: expected 1–64 characters of [A-Za-z0-9 _.-]',
    ]);
    expect(validateRecord('clips', { ...clip, range: { start: 3, end: 3 } })).toEqual(['range: expected start < end']);
    expect(validateRecord('clips', { ...clip, tags: ['UPPER'] })).toEqual([
      'tags[0]: expected a lowercase tag of [a-z0-9_-]',
    ]);
    expect(validateRecord('clips', { ...clip, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) })).toEqual([
      'tags: expected at most 8 items',
    ]);
    expect(validateRecord('clips', { ...clip, fps: { num: 29.97, den: 1 } })).toEqual([
      'fps.num: expected an integer ≥ 1',
    ]);
    const control = firstRecord(doc, 'controls');
    expect(validateRecord('controls', { ...control, parent: control.id })).toEqual([
      'parent: a control cannot be its own parent',
    ]);
    expect(validateRecord('controls', { ...control, shape: { ...control.shape, color: 'red' } })).toEqual([
      "shape.color: expected 'side' or a #hex colour",
    ]);
    const curve = firstRecord(doc, 'curves');
    expect(validateRecord('curves', { ...curve, channel: 'tw' })).toEqual([
      "channel: expected a TRS channel or '@<attribute>'",
    ]);
    expect(validateRecord('curves', { ...curve, channel: '@blink' })).toEqual([]);
    expect(validateRecord('assets', { ...firstRecord(doc, 'assets'), id: 'ABC' })).toEqual([
      'id: expected a lowercase SHA-256 hex string',
    ]);
    expect(
      validateRecord('cameras', {
        ...makeCamera({ name: 'c', transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
        near: 2,
        far: 1,
      }),
    ).toEqual(['far: expected far > near']);
    expect(validateRecord('keys', 'nope')).toEqual(['expected a record object']);
  });

  it('allows unknown extra fields (newer apps, extensions)', () => {
    const key = firstRecord(makeTestDocument(), 'keys');
    expect(validateRecord('keys', { ...key, futureFlag: true })).toEqual([]);
  });

  it('opaque tables only need an object with a string id', () => {
    expect(validateRecord('vendor.thing' as TableName, { id: 'x', anything: 1 })).toEqual([]);
    expect(validateRecord('vendor.thing' as TableName, { anything: 1 })).toEqual(['id: expected a non-empty string']);
  });
});

describe('table definitions and partitions', () => {
  it('describes every built-in table', () => {
    for (const table of BUILTIN_TABLES) {
      const def = getTableDef(table);
      expect(def?.name).toBe(table);
      expect(def?.version).toBe(1);
      expect(def?.mergeUnit).toBe(MERGE_UNIT[table]);
      expect(def?.migrations).toEqual([]);
      expect(isSoftDeletable(table)).toBe(!['project', 'assets', 'keys'].includes(table));
    }
    expect(getTableDef('vendor.unknown')).toBeUndefined();
    expect(mergeUnitOf('vendor.unknown')).toBe('field');
    expect(isSoftDeletable('vendor.unknown')).toBe(false);
  });

  it('partitionOf covers every table (§4.11.21)', () => {
    const doc = makeTestDocument();
    const expected: Record<TableName, string> = {
      project: 'scene',
      assets: 'scene',
      characters: 'scene',
      cameras: 'scene',
      rigs: 'char:chr_A',
      clips: 'char:chr_A',
      controls: 'char:chr_A',
      constraints: 'char:chr_A',
      solvers: 'char:chr_A',
      layers: 'clip:clp_A',
      curves: 'clip:clp_A',
      keys: 'clip:clp_A',
    };
    const samples: { [T in TableName]: RecordOf<T> } = {
      project: makeProject(),
      assets: firstRecord(doc, 'assets'),
      characters: firstRecord(doc, 'characters'),
      cameras: makeCamera({ name: 'shot', transform: { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } }),
      rigs: { ...firstRecord(doc, 'rigs'), character: 'chr_A' as CharacterId },
      clips: makeClip({ character: 'chr_A' as CharacterId, name: 'c', fps: { num: 30, den: 1 } }),
      controls: { ...firstRecord(doc, 'controls'), rig: 'rig_A' as RigId },
      constraints: {
        id: 'cns_A' as never,
        rig: 'rig_A' as RigId,
        type: 'parent',
        driven: { control: 'rig_A:root' as ControlId },
        targets: {},
        maintainOffset: false,
        params: {},
        enabled: false,
        deleted: null,
      },
      solvers: { id: 'slv_A' as never, rig: 'rig_A' as RigId, type: 'ik2', params: {}, enabled: false, deleted: null },
      layers: makeLayer({ clip: 'clp_A' as ClipId }),
      curves: makeCurve({
        clip: 'clp_A' as ClipId,
        layer: 'lay_A' as LayerId,
        control: 'rig_A:root' as ControlId,
        channel: 'rx',
      }),
      keys: makeKey({ clip: 'clp_A' as ClipId, curve: 'crv_A' as never, t: 0, v: 0 }),
    };
    const partitions = Object.fromEntries(
      BUILTIN_TABLES.map((table) => [table, partitionOf(table, samples[table] as never, lookup)]),
    );
    expect(partitions).toEqual(expected);
    const problems = Object.fromEntries(BUILTIN_TABLES.map((table) => [table, validateRecord(table, samples[table])]));
    expect(problems).toEqual(Object.fromEntries(BUILTIN_TABLES.map((table) => [table, []])));
    expect(partitionOf('controls', { ...samples.controls, rig: 'rig_unknown' as RigId }, lookup)).toBe('scene');
    expect(() => partitionOf('controls', samples.controls)).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(partitionOf('vendor.notes' as TableName, { id: 'n' } as never)).toBe('scene');
  });

  it('registerTable adds extension tables and refuses clashes', () => {
    const def: TableDef = {
      name: 'acme.markers',
      version: 2,
      mergeUnit: 'record',
      softDelete: true,
      partition: (record) => `clip:${String((record as unknown as { clip: string }).clip)}`,
      validate: (record) =>
        typeof (record as { label?: unknown }).label === 'string' ? [] : ['label: expected a string'],
      migrations: [(record) => ({ ...(record as object), label: 'migrated' })],
    };
    const dispose = registerTable(def);
    try {
      expect(getTableDef('acme.markers')).toBe(def);
      expect(mergeUnitOf('acme.markers')).toBe('record');
      expect(partitionOf('acme.markers' as TableName, { id: 'm', clip: 'clp_X' } as never)).toBe('clip:clp_X');
      expect(validateRecord('acme.markers' as TableName, { id: 'm' })).toEqual(['label: expected a string']);
      expect(() => registerTable(def)).toThrow(EkzaError);
      expect(() => registerTable({ ...def, name: 'keys' })).toThrow(EkzaError);
      expect(() => registerTable({ ...def, name: 'acme.bad', version: 0 })).toThrow(EkzaError);
      expect(() => registerTable({ ...def, name: 'acme.bad', version: 1 })).toThrow(EkzaError);
    } finally {
      dispose();
    }
    expect(getTableDef('acme.markers')).toBeUndefined();
    dispose();
  });
});

describe('factories', () => {
  it('fill the documented defaults and produce valid records', () => {
    const project = makeProject();
    expect(project).toMatchObject({
      id: 'project',
      sceneFps: { num: 30, den: 1 },
      sceneRange: { start: 0, end: 60 },
      units: 'm',
      upAxis: 'Y',
    });
    const clip = makeClip({ character: 'chr_A' as CharacterId, name: 'wave', fps: { num: 24, den: 1 } });
    expect(clip.id).toMatch(/^clp_[0-9A-Za-z]{16}$/);
    expect(clip).toMatchObject({
      range: { start: 0, end: 60 },
      sceneStart: 0,
      loop: false,
      rootMotion: 'hips',
      provenance: { derivedFrom: [], redistributable: 'yes' },
      source: { kind: 'new' },
      deleted: null,
    });
    const layer = makeLayer({ clip: clip.id });
    expect(layer).toMatchObject({ name: 'Base', mode: 'override', weight: 1, owner: null });
    const curve = makeCurve({ clip: clip.id, layer: layer.id, control: 'rig_A:root' as ControlId, channel: 'rz' });
    expect(curve).toMatchObject({ weighted: false, pre: 'constant', post: 'constant', staticValue: null });
    const key = makeKey({ clip: clip.id, curve: curve.id, t: 3, v: 0.5 });
    expect(key.id).toMatch(/^k_[0-9A-Za-z]{12}$/);
    expect(key).toMatchObject({
      inType: 'auto',
      outType: 'auto',
      inHandle: { dt: 0, dv: 0 },
      broken: false,
      weightLocked: true,
    });
    const camera = makeCamera({ name: 'shotCam', transform: { t: [0, 1, 3], q: [0, 0, 0, 1], s: [1, 1, 1] } });
    expect(camera.fovY).toBeCloseTo(2 * Math.atan(12 / 50), 12);
    expect(camera.locked).toBe(false);
    for (const [table, record] of [
      ['project', project],
      ['clips', clip],
      ['layers', layer],
      ['curves', curve],
      ['keys', key],
      ['cameras', camera],
    ] as const) {
      expect(validateRecord(table, record)).toEqual([]);
    }
  });

  it('throw invalid-record for invalid input', () => {
    expect(() => makeClip({ character: 'chr_A' as CharacterId, name: 'no/slash', fps: { num: 30, den: 1 } })).toThrow(
      expect.objectContaining({ code: 'invalid-record' }),
    );
    expect(() => makeKey({ clip: 'c' as ClipId, curve: 'k' as never, t: Number.POSITIVE_INFINITY, v: 0 })).toThrow(
      EkzaError,
    );
  });
});

describe('toAnimCurve', () => {
  const curve = makeCurve({
    clip: 'clp_A' as ClipId,
    layer: 'lay_A' as LayerId,
    control: 'rig_A:root' as ControlId,
    channel: 'rx',
    post: 'cycle',
    weighted: true,
  });
  const key = (id: string, t: number, v: number): KeyRecord =>
    makeKey({ id: id as never, clip: curve.clip, curve: curve.id, t, v });

  it('keeps projected keys as they are and copies curve settings', () => {
    const keys = [key('k_a', 0, 1), key('k_b', 5, 2)];
    const anim = toAnimCurve(curve, keys);
    expect(anim.keys).toBe(keys);
    expect(anim).toMatchObject({ weighted: true, pre: 'constant', post: 'cycle' });
    expect((anim as unknown as { curve: unknown }).curve).toBe(curve);
  });

  it('sorts and resolves duplicate times like the store projection', () => {
    const anim = toAnimCurve(curve, [key('k_b', 5, 2), key('k_a', 0, 1), key('k_z', 5, 3)]);
    expect(anim.keys.map((k) => (k as KeyRecord).id)).toEqual(['k_a', 'k_z']);
  });
});
