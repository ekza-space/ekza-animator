// M6B-SPEC §3 rule 9 literal updates (§4.1 schema v4): the build writes schema 4; a live skeleton or model-sourced
// character requires writer version 4 (was 3); schema 4 itself is tested in schema-v4.test.ts.
// M6A-SPEC §4.2 (B0a): schema 3 — the 2 → 3 migration, `requiredWriterVersion`, `minWriterVersion` written by the
// store, an M2a reader opening modeling projects read-only, validation and repairs of every rules-table row, the
// cross-record hierarchy repairs, `referencesOf` for the new tables and `derivedId`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AssetId,
  type CharacterId,
  type CharacterRecord,
  createMemoryStore,
  type DocSnapshot,
  derivedId,
  type GroupId,
  makeProject,
  migrateSnapshot,
  type RigId,
  referencesOf,
  repairHierarchy,
  repairRecord,
  requiredWriterVersion,
  SCHEMA_VERSION,
  type SnapshotTables,
  type SolverRecord,
  serializeSnapshot,
  solverId,
  validateRecord,
} from '../src';
import type * as MigrateModuleNs from '../src/migrations/migrate';
import type * as VersionModuleNs from '../src/snapshot/version';
import {
  makeTestDocument,
  makeTestGroup,
  makeTestImageAsset,
  makeTestImagePlane,
  makeTestJoint,
  makeTestMesh,
  makeTestPalette,
  makeTestSkeleton,
  makeTestSwatch,
  testHash,
  withSchemaV3,
} from '../src/testing';

type MigrateModule = typeof MigrateModuleNs;
type VersionModule = typeof VersionModuleNs;
type Row = Readonly<Record<string, unknown>>;

const DELETED = { by: 'local' as never, at: 1 };

/** A schema 2 document as the M2a app writes it (no `source`, no `provenance`, no M6a tables), optionally with IK. */
function m2aDocument(opts: { readonly ik?: boolean } = {}): DocSnapshot {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 2 });
  const tables: Record<string, Record<string, unknown>> = {};
  for (const [name, rows] of Object.entries(doc.tables as unknown as Record<string, Record<string, Row>>)) {
    tables[name] = {};
    for (const [id, row] of Object.entries(rows)) {
      const { source: _source, provenance: _provenance, ...rest } = row;
      tables[name][id] = rest;
    }
  }
  if (opts.ik === true) {
    const rig = Object.keys(doc.tables.rigs)[0] as RigId;
    const solver: SolverRecord = {
      id: solverId(rig, 'ik2.leg.L'),
      rig,
      type: 'ik2',
      params: {},
      enabled: true,
      deleted: null,
    };
    tables['solvers'] = { [solver.id]: solver };
  }
  const project = { ...(tables['project']?.['project'] as Row), schemaVersion: 2, minWriterVersion: opts.ik ? 2 : 1 };
  tables['project'] = { project };
  return {
    format: 'ekza-animator-doc',
    schemaVersion: 2,
    minWriterVersion: opts.ik === true ? 2 : 1,
    tableVersions: Object.fromEntries(Object.keys(tables).map((name) => [name, 1])),
    tables: tables as unknown as SnapshotTables,
  };
}

function tablesWith(extra: Record<string, Record<string, unknown>>): SnapshotTables {
  const doc = makeTestDocument({ characters: 1, controlsPerRig: 1, keysPerCurve: 1 });
  return { ...doc.tables, ...extra };
}

describe('schema 3: migration 2 → 3', () => {
  it('gives characters their source and assets provenance null, and changes nothing else', () => {
    const m2a = m2aDocument();
    const { snapshot, migratedFrom, readOnly } = migrateSnapshot(JSON.parse(serializeSnapshot(m2a)));
    expect(migratedFrom).toBe(2);
    expect(readOnly).toBe(false);
    expect(snapshot.schemaVersion).toBe(SCHEMA_VERSION);
    expect(snapshot.tables).toEqual(withSchemaV3(m2a).tables);
    for (const character of Object.values(snapshot.tables.characters)) {
      expect(character.source).toEqual({ kind: 'asset', asset: character.asset });
    }
    for (const asset of Object.values(snapshot.tables.assets)) expect(asset.provenance).toBeNull();
    expect(Object.keys(snapshot.tables.meshes)).toEqual([]);
    expect(snapshot.tableVersions['meshes']).toBe(1);
  });

  it('is idempotent and keeps existing v3 fields', () => {
    const once = migrateSnapshot(JSON.parse(serializeSnapshot(m2aDocument())));
    const twice = migrateSnapshot(JSON.parse(serializeSnapshot(once.snapshot)));
    expect(serializeSnapshot(twice.snapshot)).toBe(serializeSnapshot(once.snapshot));
    const doc = makeTestDocument();
    const character = Object.values(doc.tables.characters)[0] as CharacterRecord;
    const provenance = { origin: 'generated', derivedFrom: [], redistributable: 'unknown', generator: null } as const;
    const assetId = character.asset as AssetId;
    const raw = {
      ...doc,
      schemaVersion: 2,
      tables: { ...doc.tables, assets: { [assetId]: { ...doc.tables.assets[assetId], provenance } } },
    };
    expect(migrateSnapshot(raw).snapshot.tables.assets[assetId]?.provenance).toEqual(provenance);
  });

  it('a v2 project reopens writable and saves schemaVersion 4 with minWriterVersion 2 (IK, no v3 records) or 3 (a mesh)', () => {
    const { snapshot } = migrateSnapshot(JSON.parse(serializeSnapshot(m2aDocument({ ik: true }))));
    const store = createMemoryStore();
    store.load(snapshot);
    expect(store.readOnly).toBe(false);
    let saved = store.snapshot();
    expect([saved.schemaVersion, saved.minWriterVersion]).toEqual([4, 2]);
    store.transact({ label: 'Create Cube' }, (tx) => tx.put('meshes', makeTestMesh('msh_A')));
    saved = store.snapshot();
    expect([saved.schemaVersion, saved.minWriterVersion]).toEqual([4, 3]);
    store.transact({ label: 'Delete' }, (tx) => tx.softDelete('meshes', 'msh_A' as never));
    expect(store.snapshot().minWriterVersion).toBe(2);
  });

  it('an animation-only project written by M6a stays at minWriterVersion ≤ 2 (palettes alone do not raise it)', () => {
    const store = createMemoryStore();
    store.load(migrateSnapshot(JSON.parse(serializeSnapshot(m2aDocument()))).snapshot);
    store.transact({ label: 'Palette' }, (tx) => {
      tx.put('palettes', makeTestPalette('pal_A'));
      tx.put('swatches', makeTestSwatch('sw_A', 'pal_A', 0));
    });
    expect(store.snapshot().minWriterVersion).toBe(1);
  });
});

describe('an M2a reader (simulated SCHEMA_VERSION 2)', () => {
  afterEach(() => {
    vi.doUnmock('../src/snapshot/version');
    vi.resetModules();
  });

  it('opens a modeling project read-only and an animation-only M6a project writable', async () => {
    vi.resetModules();
    vi.doMock('../src/snapshot/version', async (importOriginal) => {
      const actual = await importOriginal<VersionModule>();
      return { ...actual, SCHEMA_VERSION: 2 };
    });
    const m2a: MigrateModule = await import('../src/migrations/migrate');
    const store = createMemoryStore();
    store.load(makeTestDocument({ characters: 1, controlsPerRig: 3, keysPerCurve: 1 }));
    const animationOnly = JSON.parse(serializeSnapshot(store.snapshot())) as unknown;
    expect(m2a.migrateSnapshot(animationOnly).readOnly).toBe(false);
    store.transact({ label: 'Create Cube' }, (tx) => tx.put('meshes', makeTestMesh('msh_A')));
    const modeling = m2a.migrateSnapshot(JSON.parse(serializeSnapshot(store.snapshot())));
    expect(modeling.readOnly).toBe(true);
    expect(modeling.snapshot.schemaVersion).toBe(4);
    expect(Object.keys(modeling.snapshot.tables.meshes ?? {})).toEqual(['msh_A']);
  });
});

describe('requiredWriterVersion (schema 3)', () => {
  const live = <T extends { readonly id: string }>(row: T) => ({ [row.id]: row });
  it.each([
    ['meshes', makeTestMesh('msh_A')],
    ['groups', makeTestGroup('grp_A')],
    ['imagePlanes', makeTestImagePlane('img_A', testHash('a'))],
    ['skeletons', makeTestSkeleton('skl_A', 'chr_A')],
    ['joints', makeTestJoint('jnt_A', 'skl_A')],
  ] as const)(
    'is 3 (4 for skeletons, M6B-SPEC §4.1) with a live %s record and ≤ 2 when it is soft-deleted',
    (table, record) => {
      expect(requiredWriterVersion(tablesWith({ [table]: live(record) }))).toBe(table === 'skeletons' ? 4 : 3);
      expect(requiredWriterVersion(tablesWith({ [table]: live({ ...record, deleted: DELETED }) }))).toBe(1);
    },
  );

  it('is 3 with a png or jpg asset and 4 (M6B-SPEC §4.1) with a live model-sourced character', () => {
    const png = makeTestImageAsset('front.png');
    expect(requiredWriterVersion(tablesWith({ assets: live(png) }))).toBe(3);
    expect(requiredWriterVersion(tablesWith({ assets: live({ ...png, ext: 'jpg', mime: 'image/jpeg' }) }))).toBe(3);
    const model = { id: 'chr_M', source: { kind: 'model', skeleton: 'skl_A' }, asset: null, deleted: null };
    expect(requiredWriterVersion(tablesWith({ characters: live(model) }))).toBe(4);
    expect(requiredWriterVersion(tablesWith({ characters: live({ ...model, deleted: DELETED }) }))).toBe(1);
  });

  it('palettes, swatches and asset provenance alone do not raise it; damaged rows are ignored', () => {
    const provenanced = {
      ...makeTestImageAsset('x.vrm'),
      ext: 'vrm',
      mime: 'model/gltf-binary',
      provenance: { origin: 'generated', derivedFrom: [], redistributable: 'no', generator: null },
    };
    expect(
      requiredWriterVersion(
        tablesWith({
          palettes: live(makeTestPalette('pal_A')),
          swatches: live(makeTestSwatch('sw_A', 'pal_A', 0)),
          assets: live(provenanced),
        }),
      ),
    ).toBe(1);
    expect(requiredWriterVersion(tablesWith({ meshes: { a: null, b: 'junk' } }))).toBe(1);
  });
});

describe('validation and repairs of the M6a rules table (repair, never reject)', () => {
  const problems = (table: string, record: unknown): readonly string[] => validateRecord(table as never, record);

  it('accepts complete records of every new table', () => {
    for (const [table, record] of [
      ['meshes', makeTestMesh('msh_A')],
      ['groups', makeTestGroup('grp_A')],
      ['palettes', makeTestPalette('pal_A')],
      ['swatches', makeTestSwatch('sw_A', 'pal_A', 65_534)],
      ['imagePlanes', makeTestImagePlane('img_A', testHash('a'))],
      ['skeletons', makeTestSkeleton('skl_A', 'chr_A')],
      ['joints', makeTestJoint('jnt_A', 'skl_A', { humanBone: 'leftHand', side: 'L' })],
      ['assets', makeTestImageAsset('front.png')],
    ] as const) {
      expect({ table, problems: problems(table, record) }).toEqual({ table, problems: [] });
      expect(repairRecord(table, record).record).toBe(record);
    }
  });

  it('meshes: name, parent, data, generator, palette, material, budget, handheld, colourOutput', () => {
    const mesh = makeTestMesh('msh_A');
    expect(problems('meshes', { ...mesh, name: '' })).toEqual([expect.stringContaining('name')]);
    expect(problems('meshes', { ...mesh, name: 'x'.repeat(65) })).toEqual([expect.stringContaining('name')]);
    expect(problems('meshes', { ...mesh, parent: 'msh_A' })).toEqual([expect.stringContaining('own parent')]);
    expect(problems('meshes', { ...mesh, data: { manifest: 'nope', rev: 0, base: 'x', joints: [1] } })).toHaveLength(4);
    expect(problems('meshes', { ...mesh, generator: { kind: 'blob', params: {}, version: 1 } })).toHaveLength(1);
    expect(
      problems('meshes', { ...mesh, material: { assetSlots: [{ asset: testHash('a'), material: -1 }] } }),
    ).toHaveLength(1);
    expect(problems('meshes', { ...mesh, budget: { tris: 0 } })).toHaveLength(1);
    expect(problems('meshes', { ...mesh, budget: { preset: 'hero' } })).toEqual([]);
    expect(problems('meshes', { ...mesh, colourOutput: 'paint' })).toHaveLength(1);
    const grip = { bone: 'rightHand', offset: [0.5, 0, 0], rotationDegrees: [0, 400, 0], scale: 3 };
    expect(problems('meshes', { ...mesh, handheld: grip })).toHaveLength(3);
    expect(problems('meshes', { ...mesh, owner: { character: 'chr_A' } })).toEqual([]);
    expect(problems('meshes', { ...mesh, owner: {} })).toHaveLength(1);

    const broken = {
      ...mesh,
      name: '',
      parent: 'msh_A',
      generator: { kind: 'blob' },
      colourOutput: 'x',
      handheld: grip,
    };
    const { record, problems: repaired } = repairRecord('meshes', broken);
    expect(record).toMatchObject({
      name: 'Mesh',
      parent: null,
      generator: null,
      colourOutput: 'palette-texture',
      handheld: { offset: [0.3, 0, 0], rotationDegrees: [0, 360, 0], scale: 2 },
    });
    expect(repaired).toHaveLength(5);
    expect(problems('meshes', record)).toEqual([]);
    expect(repairRecord('meshes', record).record).toBe(record);
  });

  it('groups: template kind repaired to null; palettes: name; swatches: slot and srgb', () => {
    const group = { ...makeTestGroup('grp_A'), template: { kind: 'castle', params: {} } };
    expect(problems('groups', group)).toHaveLength(1);
    expect(repairRecord('groups', group).record).toMatchObject({ template: null });
    expect(repairRecord('palettes', { ...makeTestPalette('pal_A'), name: '' }).record).toMatchObject({
      name: 'Palette',
    });
    const swatch = makeTestSwatch('sw_A', 'pal_A', 0);
    expect(problems('swatches', { ...swatch, slot: 65_535 })).toHaveLength(1);
    expect(problems('swatches', { ...swatch, slot: 1.5 })).toHaveLength(1);
    expect(problems('swatches', { ...swatch, srgb: [300, -1, 2.5] })).toHaveLength(3);
    expect(repairRecord('swatches', { ...swatch, srgb: [300, -1, 2.5] }).record).toMatchObject({ srgb: [255, 0, 3] });
    expect(
      problems('swatches', {
        ...swatch,
        kind: 'ramp',
        ramp: [
          [0, 0, 0],
          [255, 255, 255],
        ],
      }),
    ).toEqual([]);
  });

  it('image planes: size repaired to 2, opacity clamped; skeletons: preset repaired to custom; joints', () => {
    const plane = makeTestImagePlane('img_A', testHash('a'));
    expect(problems('imagePlanes', { ...plane, size: 0, opacity: 2, camera: 'back' })).toHaveLength(3);
    expect(repairRecord('imagePlanes', { ...plane, size: -1, opacity: 2 }).record).toMatchObject({
      size: 2,
      opacity: 1,
    });
    const skeleton = makeTestSkeleton('skl_A', 'chr_A');
    expect(problems('skeletons', { ...skeleton, preset: 'huge' })).toHaveLength(1);
    expect(repairRecord('skeletons', { ...skeleton, preset: 'huge' }).record).toMatchObject({ preset: 'custom' });
    const joint = makeTestJoint('jnt_A', 'skl_A');
    expect(problems('joints', { ...joint, humanBone: 'tail' })).toHaveLength(1);
    expect(problems('joints', { ...joint, restPosition: [0, Number.NaN, 0] })).toHaveLength(1);
    expect(problems('joints', { ...joint, parent: 'jnt_A', mirror: 'jnt_A' })).toHaveLength(2);
  });

  it('characters: source present and consistent; repaired from asset', () => {
    const doc = makeTestDocument();
    const character = Object.values(doc.tables.characters)[0] as CharacterRecord;
    expect(problems('characters', character)).toEqual([]);
    const { source: _source, ...withoutSource } = character;
    expect(problems('characters', withoutSource)).toHaveLength(1);
    expect(repairRecord('characters', withoutSource).record).toEqual(character);
    expect(problems('characters', { ...character, asset: testHash('other') })).toEqual([
      'asset: expected asset === source.asset for an asset-sourced character',
    ]);
    const model = { ...character, asset: null, source: { kind: 'model', skeleton: 'skl_A' } };
    expect(problems('characters', model)).toEqual([]);
    expect(problems('characters', { ...model, asset: character.asset })).toEqual([
      'asset: expected null for a model-sourced character',
    ]);
  });

  it('assets: png/jpg reference images with matching mime; provenance validated', () => {
    const png = makeTestImageAsset('front.png');
    expect(problems('assets', { ...png, mime: 'model/gltf-binary' })).toEqual([
      "mime: expected 'image/png' for ext 'png'",
    ]);
    expect(problems('assets', { ...png, provenance: { origin: 'scanned' } })).not.toEqual([]);
    const { provenance: _provenance, ...without } = png;
    expect(repairRecord('assets', without).record).toEqual(png);
  });

  it('migrateSnapshot applies the per-record repairs on load', () => {
    const doc = makeTestDocument();
    const raw = {
      ...doc,
      tables: {
        ...doc.tables,
        meshes: { msh_A: { ...makeTestMesh('msh_A'), name: '' } },
        imagePlanes: { img_A: { ...makeTestImagePlane('img_A', testHash('a')), opacity: -3 } },
      },
    };
    const { snapshot } = migrateSnapshot(raw);
    expect(snapshot.tables.meshes['msh_A' as never]?.name).toBe('Mesh');
    expect(snapshot.tables.imagePlanes['img_A' as never]?.opacity).toBe(0);
  });
});

describe('hierarchy repairs (cross-record)', () => {
  const owner = { character: 'chr_A' as CharacterId };

  it('nulls dangling, cross-owner and mesh-of-group parents and breaks cycles at the smallest id', () => {
    const meshes = {
      msh_A: makeTestMesh('msh_A', { parent: 'grp_missing' as GroupId, name: 'A' }),
      msh_B: makeTestMesh('msh_B', { parent: 'grp_C' as GroupId, name: 'B' }),
      msh_C: makeTestMesh('msh_C', { parent: 'grp_A' as GroupId, name: 'C' }),
    };
    const groups = {
      grp_A: makeTestGroup('grp_A', { parent: 'grp_B' as GroupId }),
      grp_B: makeTestGroup('grp_B', { parent: 'grp_A' as GroupId }),
      grp_C: makeTestGroup('grp_C', { owner }),
      grp_D: makeTestGroup('grp_D', { parent: 'msh_C' as never }),
    };
    const out = repairHierarchy(meshes, groups);
    expect((out.meshes['msh_A'] as Row)['parent']).toBeNull();
    expect((out.meshes['msh_B'] as Row)['parent']).toBeNull();
    expect((out.meshes['msh_C'] as Row)['parent']).toBe('grp_A');
    expect((out.groups['grp_A'] as Row)['parent']).toBeNull();
    expect((out.groups['grp_B'] as Row)['parent']).toBe('grp_A');
    expect((out.groups['grp_D'] as Row)['parent']).toBeNull();
    expect(out.problems).toHaveLength(4);
    const again = repairHierarchy(out.meshes, out.groups);
    expect(again.problems).toEqual([]);
    expect(again.meshes).toBe(out.meshes);
  });

  it('makes live mesh names unique per owner (id order; the first keeps its name)', () => {
    const meshes = {
      msh_C: makeTestMesh('msh_C', { name: 'Cube' }),
      msh_A: makeTestMesh('msh_A', { name: 'Cube' }),
      msh_B: makeTestMesh('msh_B', { name: 'Cube 2' }),
      msh_D: makeTestMesh('msh_D', { name: 'Cube', owner }),
      msh_E: makeTestMesh('msh_E', { name: 'Cube', deleted: DELETED }),
    };
    const out = repairHierarchy(meshes, {});
    expect((out.meshes['msh_A'] as Row)['name']).toBe('Cube');
    expect((out.meshes['msh_B'] as Row)['name']).toBe('Cube 2');
    expect((out.meshes['msh_C'] as Row)['name']).toBe('Cube 3');
    expect((out.meshes['msh_D'] as Row)['name']).toBe('Cube');
    expect((out.meshes['msh_E'] as Row)['name']).toBe('Cube');
  });

  // §4.2 (M6A-B0A-6): write validation checks one record (a self-parent is rejected); cross-record rules (parent of
  // the same owner and table kind, acyclic, existing; unique live names per owner) are kept by the operators that
  // write parents and names. The store writes such records as given, queries read their parents as roots, and the
  // next load repairs them.
  it('local writes check one record: cross-record problems are written, read as roots and repaired by a reload', async () => {
    const store = createMemoryStore();
    await store.open('scene');
    store.transact({ label: 'Seed' }, (tx) => {
      tx.put('project', makeProject());
      tx.put('meshes', makeTestMesh('msh_A', { name: 'Same' }));
      tx.put('meshes', makeTestMesh('msh_B', { name: 'Same', order: 'a1' }));
      tx.put('meshes', makeTestMesh('msh_C', { name: 'Orphan', parent: 'grp_missing' as GroupId, order: 'a2' }));
      tx.put('groups', makeTestGroup('grp_A', { parent: 'grp_B' as GroupId, order: 'a3' }));
      tx.put('groups', makeTestGroup('grp_B', { parent: 'grp_A' as GroupId, order: 'a4' }));
      tx.put('groups', makeTestGroup('grp_C', { parent: 'msh_A' as never, order: 'a5' }));
    });
    expect(store.get('meshes', 'msh_B' as never)?.name).toBe('Same');
    expect(store.get('meshes', 'msh_C' as never)?.parent).toBe('grp_missing');
    expect(store.get('groups', 'grp_C' as never)?.parent).toBe('msh_A');
    const ids = (rows: readonly { readonly id: string }[]): string[] => rows.map((row) => row.id);
    expect(ids(store.query.childrenOf(null, 'scene'))).toEqual(['msh_A', 'msh_B', 'msh_C', 'grp_A', 'grp_C']);
    expect(ids(store.query.childrenOf('grp_A' as GroupId, 'scene'))).toEqual(['grp_B']);
    expect(() =>
      store.transact({ label: 'Self' }, (tx) =>
        tx.put('groups', makeTestGroup('grp_S', { parent: 'grp_S' as GroupId })),
      ),
    ).toThrow(/cannot be its own parent/);

    const { snapshot } = migrateSnapshot(JSON.parse(serializeSnapshot(store.snapshot())));
    const reloaded = createMemoryStore();
    reloaded.load(snapshot);
    expect(reloaded.get('meshes', 'msh_A' as never)?.name).toBe('Same');
    expect(reloaded.get('meshes', 'msh_B' as never)?.name).toBe('Same 2');
    expect(reloaded.get('meshes', 'msh_C' as never)?.parent).toBeNull();
    expect(reloaded.get('groups', 'grp_A' as never)?.parent).toBeNull();
    expect(reloaded.get('groups', 'grp_B' as never)?.parent).toBe('grp_A');
    expect(reloaded.get('groups', 'grp_C' as never)?.parent).toBeNull();
    expect(ids(reloaded.query.childrenOf(null, 'scene'))).toEqual(ids(store.query.childrenOf(null, 'scene')));
  });
});

describe('referencesOf (M6a tables)', () => {
  const pairs = (table: string, row: unknown): string[] =>
    referencesOf(table, row as never).map(([t, id]) => `${t}/${id}`);

  it('lists every reference of the rules table', () => {
    const asset = testHash('asset');
    const mesh = makeTestMesh('msh_A', {
      owner: { character: 'chr_A' as CharacterId },
      parent: 'grp_A' as GroupId,
      source: { asset: asset as AssetId, mesh: 0 },
      material: { assetSlots: [{ asset: asset as AssetId, material: 1 }] },
      skin: { skeleton: 'skl_A' as never, bind: null },
      palette: 'pal_A' as never,
      data: { manifest: testHash('m'), rev: 1, base: null, joints: ['skl_A:hips' as never] },
    });
    expect(pairs('meshes', mesh)).toEqual([
      'characters/chr_A',
      'groups/grp_A',
      `assets/${asset}`,
      `assets/${asset}`,
      'skeletons/skl_A',
      'palettes/pal_A',
      'joints/skl_A:hips',
    ]);
    expect(
      pairs('meshes', makeTestMesh('msh_B', { parent: 'msh_A' as never, skin: { asset: asset as AssetId, skin: 0 } })),
    ).toEqual(['meshes/msh_A', `assets/${asset}`]);
    expect(
      pairs(
        'groups',
        makeTestGroup('grp_A', { owner: { character: 'chr_A' as CharacterId }, parent: 'grp_B' as GroupId }),
      ),
    ).toEqual(['characters/chr_A', 'groups/grp_B']);
    expect(pairs('swatches', makeTestSwatch('sw_A', 'pal_A', 0))).toEqual(['palettes/pal_A']);
    expect(pairs('imagePlanes', makeTestImagePlane('img_A', asset))).toEqual([`assets/${asset}`]);
    expect(pairs('skeletons', makeTestSkeleton('skl_A', 'chr_A'))).toEqual(['characters/chr_A']);
    expect(
      pairs('joints', makeTestJoint('jnt_B', 'skl_A', { parent: 'jnt_A' as never, mirror: 'jnt_C' as never })),
    ).toEqual(['skeletons/skl_A', 'joints/jnt_A', 'joints/jnt_C']);
    expect(
      pairs('characters', { id: 'chr_M', asset: null, rig: 'rig_A', source: { kind: 'model', skeleton: 'skl_A' } }),
    ).toEqual(['rigs/rig_A', 'skeletons/skl_A']);
  });

  it('a referenced palette cannot be hard-deleted while a swatch uses it (store)', async () => {
    const store = createMemoryStore();
    await store.open('scene');
    store.transact({ label: 'Palette' }, (tx) => {
      tx.put('project', makeProject());
      tx.put('palettes', makeTestPalette('pal_A'));
      tx.put('swatches', makeTestSwatch('sw_A', 'pal_A', 0));
    });
    expect(() => store.transact({ label: 'Remove' }, (tx) => tx.remove('palettes', 'pal_A' as never))).toThrow(
      /swatches\/sw_A/,
    );
  });
});

describe('derivedId (M6A-SPEC §3 rule 3)', () => {
  it('is prefix + 16 base62 of sha256(opId:inputs:seed:n), deterministic and input-sensitive', () => {
    const a = derivedId('mesh', 'mesh.create.cube', [], 'tx_seed', 0);
    expect(a).toMatch(/^msh_[0-9A-Za-z]{16}$/);
    expect(derivedId('mesh', 'mesh.create.cube', [], 'tx_seed', 0)).toBe(a);
    expect(derivedId('mesh', 'mesh.create.cube', [], 'tx_seed', 1)).not.toBe(a);
    expect(derivedId('mesh', 'mesh.create.cube', [], 'tx_other', 0)).not.toBe(a);
    expect(derivedId('mesh', 'mesh.combine', ['msh_A', 'msh_B'], 's', 0)).not.toBe(
      derivedId('mesh', 'mesh.combine', ['msh_B', 'msh_A'], 's', 0),
    );
    expect(derivedId('palette', 'palette.default', [], '', 0)).toMatch(/^pal_[0-9A-Za-z]{16}$/);
    expect(derivedId('swatch', 'palette.default', ['pal_X'], '', 3)).toMatch(/^sw_[0-9A-Za-z]{16}$/);
    expect(derivedId('key', 'op', [], '', 0)).toMatch(/^k_[0-9A-Za-z]{12}$/);
    expect(() => derivedId('mesh', '', [], '', 0)).toThrow(expect.objectContaining({ code: 'invalid-record' }));
    expect(() => derivedId('mesh', 'op', [], '', -1)).toThrow(expect.objectContaining({ code: 'invalid-record' }));
  });

  it('the made-editable mesh id derives from the character and the glTF mesh index', () => {
    const id = derivedId('mesh', 'asset', ['chr_A'], '', 2);
    expect(id).toBe(derivedId('mesh', 'asset', ['chr_A'], '', 2));
    expect(id).toMatchInlineSnapshot(`"msh_fDhY7lR3HyUjByZD"`);
  });
});
