// M6B-SPEC §4.1 (C0): schema 4 — the 3 → 4 migration (characters `vrm: null`, joints `role`/`key`), the swatches table
// staying at version 2 (§0.4.8), `requiredWriterVersion` 4, a v0.3.x reader (simulated SCHEMA_VERSION 3) opening v4
// documents read-only or writable by their content, validation and repairs of every §4.1 rules-table row, the joint-key
// uniqueness repair and `referencesOf` for the VRM thumbnail.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CharacterRecord,
  type ConstraintRecord,
  createMemoryStore,
  type DocSnapshot,
  emptySnapshot,
  migrateSnapshot,
  referencesOf,
  repairJointKeys,
  repairRecord,
  requiredWriterVersion,
  SCHEMA_VERSION,
  type SnapshotTables,
  serializeSnapshot,
  validateRecord,
} from '../src';
import type * as MemoryModuleNs from '../src/store/memory';
import type * as MigrateModuleNs from '../src/migrations/migrate';
import type * as VersionModuleNs from '../src/snapshot/version';
import {
  makeTestDocument,
  makeTestJoint,
  makeTestMesh,
  makeTestPalette,
  makeTestSkeleton,
  makeTestSwatch,
  makeTestThumbnailAsset,
  makeTestVrmMeta,
  testHash,
  withSchemaV4,
} from '../src/testing';

type Row = Readonly<Record<string, unknown>>;
type Rows = Record<string, Record<string, unknown>>;
const DELETED = { by: 'local' as never, at: 1 };

/** The tables of `doc` as plain rows. */
function rowsOf(doc: DocSnapshot): Rows {
  const out: Rows = {};
  for (const [name, rows] of Object.entries(doc.tables as unknown as Record<string, Record<string, Row>>)) {
    out[name] = { ...rows };
  }
  return out;
}

/** A schema 3 document as an M6a app writes it: characters without `vrm`, joints without `role`/`key`. */
function m6aDocument(opts: { readonly swatchesVersion?: 1 | 2; readonly joints?: boolean } = {}): DocSnapshot {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 2, keysPerCurve: 1 });
  const tables = rowsOf(doc);
  for (const [id, row] of Object.entries(tables['characters'] ?? {})) {
    const { vrm: _vrm, ...rest } = row as Row;
    (tables['characters'] as Rows[string])[id] = rest;
  }
  tables['palettes'] = { pal_A: makeTestPalette('pal_A') };
  const swatch = makeTestSwatch('sw_A', 'pal_A', 0, { shader: 'blinn', glossiness: 0.8 });
  if (opts.swatchesVersion === 1) {
    const { shader: _s, glossiness: _g, specular: _p, ...v1 } = swatch;
    tables['swatches'] = { sw_A: v1 };
  } else tables['swatches'] = { sw_A: swatch };
  tables['meshes'] = { msh_A: makeTestMesh('msh_A', { palette: 'pal_A' as never }) };
  if (opts.joints === true) {
    const character = Object.keys(tables['characters'] ?? {})[0] as string;
    tables['skeletons'] = { skl_A: makeTestSkeleton('skl_A', character) };
    const joints: Record<string, unknown> = {};
    // Two joints named 'Arm L' (sanitized 'Arm_L') in one skeleton, one 'Hips', one in a second skeleton.
    for (const [id, name, skeleton] of [
      ['jnt_B', 'Arm L', 'skl_A'],
      ['jnt_A', 'Arm L', 'skl_A'],
      ['jnt_C', 'Hips', 'skl_A'],
      ['jnt_D', 'Arm L', 'skl_B'],
    ] as const) {
      const { role: _role, key: _key, ...v3 } = makeTestJoint(id, skeleton, { name });
      joints[id] = v3;
    }
    tables['joints'] = joints;
  }
  const versions = { ...doc.tableVersions, swatches: opts.swatchesVersion ?? 2 };
  return {
    format: 'ekza-animator-doc',
    schemaVersion: 3,
    minWriterVersion: 3,
    tableVersions: versions,
    tables: {
      ...tables,
      project: { project: { ...(tables['project']?.['project'] as Row), schemaVersion: 3 } },
    } as never,
  };
}

function tablesWith(extra: Record<string, Record<string, unknown>>): SnapshotTables {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 1, keysPerCurve: 1 });
  return { ...doc.tables, ...extra };
}
const live = <T extends { readonly id: string }>(row: T) => ({ [row.id]: row });

describe('schema 4: migration 3 → 4', () => {
  it('gives characters vrm: null and joints role and a unique key, and changes nothing else', () => {
    const m6a = m6aDocument({ joints: true });
    const { snapshot, migratedFrom, readOnly } = migrateSnapshot(JSON.parse(serializeSnapshot(m6a)));
    expect([migratedFrom, readOnly, snapshot.schemaVersion]).toEqual([3, false, SCHEMA_VERSION]);
    expect(SCHEMA_VERSION).toBe(4);
    for (const character of Object.values(snapshot.tables.characters)) expect(character.vrm).toBeNull();
    const joints = snapshot.tables.joints;
    expect(Object.values(joints).map((joint) => joint.role)).toEqual(['bone', 'bone', 'bone', 'bone']);
    // De-duplicated per skeleton in id order: jnt_A keeps 'Arm_L', jnt_B gets 'Arm_L#1'; skl_B is independent.
    expect([joints['jnt_A']?.key, joints['jnt_B']?.key, joints['jnt_C']?.key, joints['jnt_D']?.key]).toEqual([
      'Arm_L',
      'Arm_L#1',
      'Hips',
      'Arm_L',
    ]);
    expect(snapshot.tables).toEqual(withSchemaV4(m6a).tables);
    expect(snapshot.tables.swatches).toEqual(m6a.tables.swatches);
    expect(snapshot.tableVersions['swatches']).toBe(2);
  });

  it('is idempotent and keeps existing v4 fields', () => {
    const once = migrateSnapshot(JSON.parse(serializeSnapshot(m6aDocument({ joints: true }))));
    const twice = migrateSnapshot(JSON.parse(serializeSnapshot(once.snapshot)));
    expect(serializeSnapshot(twice.snapshot)).toBe(serializeSnapshot(once.snapshot));
    const doc = rowsOf(m6aDocument({ joints: true }));
    const character = Object.keys(doc['characters'] ?? {})[0] as string;
    (doc['characters'] as Rows[string])[character] = {
      ...(doc['characters']?.[character] as Row),
      vrm: makeTestVrmMeta('Kept', { authors: ['A'] }),
    };
    (doc['joints'] as Rows[string])['jnt_A'] = { ...(doc['joints']?.['jnt_A'] as Row), role: 'helper', key: 'root' };
    const raw = { ...m6aDocument(), tables: doc };
    const migrated = migrateSnapshot(raw).snapshot;
    expect(migrated.tables.characters[character]?.vrm?.name).toBe('Kept');
    expect([migrated.tables.joints['jnt_A']?.role, migrated.tables.joints['jnt_A']?.key]).toEqual(['helper', 'root']);
    expect(migrated.tables.joints['jnt_B']?.key).toBe('Arm_L');
  });

  it.each([1, 2] as const)(
    'a v3 project with swatches version %i opens writable and saves as schema 4 with swatches 2',
    (swatchesVersion) => {
      const { snapshot, readOnly } = migrateSnapshot(JSON.parse(serializeSnapshot(m6aDocument({ swatchesVersion }))));
      expect(readOnly).toBe(false);
      const store = createMemoryStore();
      store.load(snapshot);
      expect(store.readOnly).toBe(false);
      store.transact({ label: 'Rename' }, (tx) => tx.patch('meshes', 'msh_A' as never, { name: 'Box' }));
      const saved = store.snapshot();
      expect([saved.schemaVersion, saved.minWriterVersion, saved.tableVersions['swatches']]).toEqual([4, 3, 2]);
      expect(saved.tables.swatches['sw_A']).toMatchObject({
        shader: swatchesVersion === 1 ? 'lambert' : 'blinn',
        glossiness: swatchesVersion === 1 ? 0.5 : 0.8,
        specular: [255, 255, 255],
      });
    },
  );

  it('emptySnapshot writes schema 4 with swatches table version 2', () => {
    const empty = emptySnapshot();
    expect([empty.schemaVersion, empty.tableVersions['swatches']]).toEqual([4, 2]);
  });
});

describe('requiredWriterVersion (schema 4)', () => {
  const constraint = (fields: Partial<ConstraintRecord> = {}): ConstraintRecord => ({
    id: 'cns_A' as never,
    rig: 'rig_A' as never,
    type: 'parent',
    driven: { control: 'rig_A:hand.R' as never },
    targets: {},
    maintainOffset: true,
    params: {},
    enabled: true,
    deleted: null,
    ...fields,
  });

  it('is 4 with a live skeleton, a model character, an enabled built-in constraint, a test clip or a thumbnail', () => {
    expect(requiredWriterVersion(tablesWith({ skeletons: live(makeTestSkeleton('skl_A', 'chr_A')) }))).toBe(4);
    const model = { id: 'chr_M', source: { kind: 'model', skeleton: 'skl_A' }, asset: null, deleted: null };
    expect(requiredWriterVersion(tablesWith({ characters: live(model) }))).toBe(4);
    for (const type of ['parent', 'point', 'orient', 'aim'] as const) {
      expect(requiredWriterVersion(tablesWith({ constraints: live(constraint({ type })) }))).toBe(4);
    }
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 1, keysPerCurve: 1 });
    const clip = Object.values(doc.tables.clips)[0];
    expect(clip).toBeDefined();
    const test = { ...clip, source: { kind: 'test', generator: 'rom', version: 1 } };
    expect(requiredWriterVersion(tablesWith({ clips: live(test as never) }))).toBe(4);
    expect(requiredWriterVersion(tablesWith({ assets: live(makeTestThumbnailAsset('t.png')) }))).toBe(4);
  });

  it('soft-deleted or disabled content does not raise it; edited shapes alone do not either', () => {
    const deletedSkeleton = { ...makeTestSkeleton('skl_A', 'chr_A'), deleted: DELETED };
    expect(requiredWriterVersion(tablesWith({ skeletons: live(deletedSkeleton) }))).toBe(1);
    expect(requiredWriterVersion(tablesWith({ constraints: live(constraint({ enabled: false })) }))).toBe(1);
    expect(requiredWriterVersion(tablesWith({ constraints: live(constraint({ deleted: DELETED })) }))).toBe(1);
    const doc = makeTestDocument({ characters: 1, controlsPerRig: 1, keysPerCurve: 1 });
    const controls: Record<string, unknown> = {};
    for (const control of Object.values(doc.tables.controls)) {
      controls[control.id] = { ...control, shape: { ...control.shape, edited: ['size'], kind: 'gear' } };
    }
    expect(requiredWriterVersion(tablesWith({ controls }))).toBe(1);
  });

  it('an M6a modeling project stays 3 and an animation-only project ≤ 2', () => {
    expect(requiredWriterVersion(tablesWith({ meshes: live(makeTestMesh('msh_A')) }))).toBe(3);
    expect(requiredWriterVersion(tablesWith({ joints: live(makeTestJoint('jnt_A', 'skl_A')) }))).toBe(3);
    expect(requiredWriterVersion(makeTestDocument({ characters: 2, controlsPerRig: 2, keysPerCurve: 2 }).tables)).toBe(
      1,
    );
  });
});

describe('a v0.3.x reader (simulated SCHEMA_VERSION 3), §0.4.8', () => {
  afterEach(() => {
    vi.doUnmock('../src/snapshot/version');
    vi.resetModules();
  });

  async function v3Build(): Promise<{
    migrate: (typeof MigrateModuleNs)['migrateSnapshot'];
    store: () => DocumentStoreLike;
  }> {
    vi.resetModules();
    vi.doMock('../src/snapshot/version', async (importOriginal) => {
      const actual = await importOriginal<typeof VersionModuleNs>();
      return { ...actual, SCHEMA_VERSION: 3 };
    });
    const migrate: typeof MigrateModuleNs = await import('../src/migrations/migrate');
    const memory: typeof MemoryModuleNs = await import('../src/store/memory');
    return { migrate: migrate.migrateSnapshot, store: () => memory.createMemoryStore() };
  }
  type DocumentStoreLike = ReturnType<typeof MemoryModuleNs.createMemoryStore>;

  it('opens a v4 document with a skeleton read-only', async () => {
    const store = createMemoryStore();
    store.load(migrateSnapshot(JSON.parse(serializeSnapshot(m6aDocument()))).snapshot);
    const character = store.list('characters')[0] as CharacterRecord;
    store.transact({ label: 'Rig' }, (tx) => tx.put('skeletons', makeTestSkeleton('skl_A', character.id)));
    const v4 = JSON.parse(serializeSnapshot(store.snapshot())) as Row;
    expect([v4['schemaVersion'], v4['minWriterVersion']]).toEqual([4, 4]);
    const old = await v3Build();
    const opened = old.migrate(v4);
    expect(opened.readOnly).toBe(true);
    expect(opened.snapshot.schemaVersion).toBe(4);
  });

  it('opens a v4 document with meshes and swatches only writable, saves it as 3, and v4 reloads it equal', async () => {
    const store = createMemoryStore();
    store.load(migrateSnapshot(JSON.parse(serializeSnapshot(m6aDocument()))).snapshot);
    const original = store.snapshot();
    expect([original.schemaVersion, original.minWriterVersion, original.tableVersions['swatches']]).toEqual([4, 3, 2]);
    const old = await v3Build();
    const opened = old.migrate(JSON.parse(serializeSnapshot(original)));
    expect(opened.readOnly).toBe(false);
    const oldStore = old.store();
    oldStore.load(opened.snapshot);
    expect(oldStore.readOnly).toBe(false);
    const savedByOld = oldStore.snapshot();
    expect(savedByOld.schemaVersion).toBe(3);
    vi.doUnmock('../src/snapshot/version');
    vi.resetModules();
    const reloaded = migrateSnapshot(JSON.parse(serializeSnapshot(savedByOld)));
    expect(reloaded.migratedFrom).toBe(3);
    expect(reloaded.snapshot.schemaVersion).toBe(4);
    expect(serializeSnapshot(reloaded.snapshot)).toBe(serializeSnapshot(original));
  });
});

describe('validation and repairs of the §4.1 rules table (repair, never reject)', () => {
  const character = (): CharacterRecord => Object.values(makeTestDocument().tables.characters)[0] as CharacterRecord;

  it('accepts complete v4 records', () => {
    expect(validateRecord('characters', { ...character(), vrm: makeTestVrmMeta('Lad') })).toEqual([]);
    expect(validateRecord('characters', character())).toEqual([]);
    expect(validateRecord('joints', makeTestJoint('jnt_A', 'skl_A', { role: 'prop', key: 'prop.sword' }))).toEqual([]);
    expect(validateRecord('assets', makeTestThumbnailAsset('t.png'))).toEqual([]);
  });

  it('assets: a thumbnail is png or jpg with the matching mime', () => {
    const thumbnail = makeTestThumbnailAsset('t.png');
    expect(validateRecord('assets', { ...thumbnail, ext: 'jpg', mime: 'image/jpeg' })).toEqual([]);
    expect(validateRecord('assets', { ...thumbnail, ext: 'vrm', mime: 'model/gltf-binary' })).toContain(
      "ext: expected 'png' or 'jpg' for a thumbnail",
    );
    expect(validateRecord('assets', { ...thumbnail, mime: 'image/jpeg' }).length).toBe(1);
  });

  it("clips: a test source is {generator: 'rom', version: 1}, repaired to {kind: 'new'}", () => {
    const clip = Object.values(makeTestDocument().tables.clips)[0];
    const ok = { ...clip, source: { kind: 'test', generator: 'rom', version: 1 } };
    expect(validateRecord('clips', ok)).toEqual([]);
    const bad = { ...clip, source: { kind: 'test', generator: 'walk', version: 2 } };
    expect(validateRecord('clips', bad).length).toBe(2);
    expect(repairRecord('clips', bad).record).toMatchObject({ source: { kind: 'new' } });
    expect(repairRecord('clips', ok).record).toBe(ok);
  });

  it('characters: vrm is null or complete; fields repair to the schema defaults, arrays drop non-strings', () => {
    const base = character();
    expect(validateRecord('characters', { ...base, vrm: undefined })).toContain(
      'vrm: expected null or a VRM meta object',
    );
    const { vrm: _vrm, ...missing } = base;
    expect(repairRecord('characters', missing).record).toMatchObject({ vrm: null });
    expect(repairRecord('characters', { ...base, vrm: 'cc0' }).record).toMatchObject({ vrm: null });
    const broken = {
      ...makeTestVrmMeta('Lad'),
      name: 5,
      authors: ['A', 3, 'B'],
      references: 'x',
      licensePreset: 'gpl',
      avatarPermission: 'anyone',
      allowRedistribution: 'yes',
      modification: 'maybe',
      thumbnail: 7,
    };
    const invalid = { ...base, name: 'Lowpoly Lad', vrm: broken };
    expect(validateRecord('characters', invalid).length).toBeGreaterThanOrEqual(8);
    const repaired = repairRecord('characters', invalid);
    expect(repaired.record).toMatchObject({
      vrm: makeTestVrmMeta('Lowpoly Lad', { authors: ['A', 'B'] }),
    });
    expect(validateRecord('characters', repaired.record)).toEqual([]);
    const fine = { ...base, vrm: makeTestVrmMeta('Lad') };
    expect(repairRecord('characters', fine).record).toBe(fine);
  });

  it("joints: role is bone/helper/prop (repair 'bone'); key a non-empty string (repair: the sanitized name)", () => {
    const joint = makeTestJoint('jnt_A', 'skl_A', { name: 'Tail 01' });
    expect(validateRecord('joints', { ...joint, role: 'deform' })).toContain(
      'role: expected one of "bone", "helper", "prop"',
    );
    expect(validateRecord('joints', { ...joint, key: '' })).toContain('key: expected a non-empty string');
    const { role: _r, key: _k, ...bare } = joint;
    expect(repairRecord('joints', bare).record).toMatchObject({ role: 'bone', key: 'Tail_01' });
    expect(repairRecord('joints', { ...joint, role: 'x' }).record).toMatchObject({ role: 'bone' });
  });

  it('joint keys are unique per skeleton among live joints: duplicates get #n in id order', () => {
    const rows = {
      jnt_C: makeTestJoint('jnt_C', 'skl_A', { key: 'tail' }),
      jnt_A: makeTestJoint('jnt_A', 'skl_A', { key: 'tail' }),
      jnt_B: makeTestJoint('jnt_B', 'skl_A', { key: 'tail#1' }),
      jnt_D: makeTestJoint('jnt_D', 'skl_A', { key: 'tail', deleted: DELETED }),
      jnt_E: makeTestJoint('jnt_E', 'skl_B', { key: 'tail' }),
    };
    const { joints, problems } = repairJointKeys(rows);
    const key = (id: keyof typeof rows) => (joints[id] as Row)['key'];
    expect([key('jnt_A'), key('jnt_B'), key('jnt_C'), key('jnt_D'), key('jnt_E')]).toEqual([
      'tail',
      'tail#1',
      'tail#2',
      'tail',
      'tail',
    ]);
    expect(problems).toHaveLength(1);
    expect(repairJointKeys(joints).joints).toBe(joints);
  });

  it('controls: shape.edited is absent or known fields without duplicates (repair: drop the others)', () => {
    const control = Object.values(makeTestDocument().tables.controls)[0];
    expect(control).toBeDefined();
    const edited = (value: unknown) => ({ ...control, shape: { ...control?.shape, edited: value } });
    expect(validateRecord('controls', edited(['kind', 'size']))).toEqual([]);
    expect(validateRecord('controls', edited(['size', 'size', 'hue'])).length).toBe(2);
    expect(repairRecord('controls', edited(['size', 'size', 'hue', 'color'])).record).toMatchObject({
      shape: { edited: ['size', 'color'] },
    });
    expect((repairRecord('controls', edited('size')).record as { shape: Row }).shape).not.toHaveProperty('edited');
    expect(repairRecord('controls', control).record).toBe(control);
  });

  it('migrateSnapshot applies the v4 repairs on load', () => {
    const doc = rowsOf(migrateSnapshot(JSON.parse(serializeSnapshot(m6aDocument({ joints: true })))).snapshot);
    (doc['joints'] as Rows[string])['jnt_B'] = { ...(doc['joints']?.['jnt_B'] as Row), key: 'Arm_L', role: 'x' };
    const raw = { ...emptySnapshot(), minWriterVersion: 4, tables: doc };
    const loaded = migrateSnapshot(raw).snapshot;
    expect([loaded.tables.joints['jnt_B']?.key, loaded.tables.joints['jnt_B']?.role]).toEqual(['Arm_L#1', 'bone']);
  });
});

describe('referencesOf (schema 4)', () => {
  it('a character references the thumbnail asset of its VRM meta', () => {
    const character = Object.values(makeTestDocument().tables.characters)[0] as CharacterRecord;
    const thumbnail = testHash('thumbnail:t.png');
    const withThumbnail = { ...character, vrm: makeTestVrmMeta('Lad', { thumbnail: thumbnail as never }) };
    expect(referencesOf('characters', withThumbnail as never)).toContainEqual(['assets', thumbnail]);
    expect(referencesOf('characters', character as never).some(([, id]) => id === thumbnail)).toBe(false);
  });
});
