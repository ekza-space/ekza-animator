// Complete, valid records of the seven M6a tables (M6A-SPEC §4.2) for tests: every field filled with the documented
// default, overridable per field. Deterministic: no random IDs (callers pass the ids they need).
import type {
  AssetId,
  CharacterId,
  GroupId,
  ImagePlaneId,
  JointId,
  MeshId,
  PaletteId,
  SkeletonId,
  SwatchId,
} from '../ids';
import {
  type AssetRecord,
  type GroupRecord,
  type ImagePlaneRecord,
  type JointRecord,
  type MeshRecord,
  type PaletteRecord,
  type SkeletonRecord,
  type SwatchRecord,
  BUILTIN_TABLES,
} from '../records';
import { sha256Hex } from '../migrations/sha256';
import { SCHEMA_VERSION } from '../snapshot/version';
import type { DocSnapshot, SnapshotTables } from '../store';
import { compareStrings } from '../store/diff';

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;

/** A 64-hex id derived from a label (manifest and asset ids in tests). */
export function testHash(label: string): string {
  return sha256Hex(`test-hash:${label}`);
}

/** An authored scene mesh (faceted, palette-texture output, no revision unless `data` is given). */
export function makeTestMesh(id: string, fields: Partial<Omit<MeshRecord, 'id'>> = {}): MeshRecord {
  return {
    id: id as MeshId,
    name: 'Mesh',
    owner: { scene: true },
    parent: null,
    order: 'a0',
    placement: IDENTITY,
    pivot: [0, 0, 0],
    source: null,
    data: null,
    faceted: true,
    generator: null,
    palette: null,
    material: { preset: 'unlit' },
    colourOutput: 'palette-texture',
    skin: null,
    budget: null,
    handheld: null,
    deleted: null,
    ...fields,
  };
}

export function makeTestGroup(id: string, fields: Partial<Omit<GroupRecord, 'id'>> = {}): GroupRecord {
  return {
    id: id as GroupId,
    name: 'Group',
    owner: { scene: true },
    parent: null,
    order: 'a0',
    placement: IDENTITY,
    pivot: [0, 0, 0],
    template: null,
    budget: null,
    handheld: null,
    deleted: null,
    ...fields,
  };
}

export function makeTestPalette(id: string, fields: Partial<Omit<PaletteRecord, 'id'>> = {}): PaletteRecord {
  return { id: id as PaletteId, name: 'Palette', order: 'a0', deleted: null, ...fields };
}

export function makeTestSwatch(
  id: string,
  palette: string,
  slot: number,
  fields: Partial<Omit<SwatchRecord, 'id' | 'palette' | 'slot'>> = {},
): SwatchRecord {
  return {
    id: id as SwatchId,
    palette: palette as PaletteId,
    slot,
    order: `a${slot}`,
    name: `Swatch ${slot}`,
    srgb: [128, 128, 128],
    kind: 'flat',
    ramp: null,
    deleted: null,
    ...fields,
  };
}

/** A reference-image asset record (PNG). */
export function makeTestImageAsset(name: string): AssetRecord {
  return {
    id: testHash(`image:${name}`) as AssetId,
    name,
    ext: 'png',
    mime: 'image/png',
    size: 0,
    role: 'reference-image',
    provenance: null,
  };
}

export function makeTestImagePlane(
  id: string,
  asset: string,
  fields: Partial<Omit<ImagePlaneRecord, 'id' | 'asset'>> = {},
): ImagePlaneRecord {
  return {
    id: id as ImagePlaneId,
    name: 'Reference',
    camera: 'front',
    asset: asset as AssetId,
    offset: [0, 0],
    size: 2,
    opacity: 0.5,
    depth: 'behind',
    locked: false,
    visible: true,
    order: 'a0',
    deleted: null,
    ...fields,
  };
}

export function makeTestSkeleton(
  id: string,
  character: string,
  fields: Partial<Omit<SkeletonRecord, 'id' | 'character'>> = {},
): SkeletonRecord {
  return {
    id: id as SkeletonId,
    character: character as CharacterId,
    template: 'vrm-humanoid',
    templateVersion: '1',
    preset: 'core21',
    symmetry: true,
    deleted: null,
    ...fields,
  };
}

export function makeTestJoint(
  id: string,
  skeleton: string,
  fields: Partial<Omit<JointRecord, 'id' | 'skeleton'>> = {},
): JointRecord {
  return {
    id: id as JointId,
    skeleton: skeleton as SkeletonId,
    parent: null,
    order: 'a0',
    name: 'Joint',
    humanBone: null,
    restPosition: [0, 0, 0],
    restRotation: [0, 0, 0, 1],
    tail: null,
    side: 'C',
    mirror: null,
    deleted: null,
    ...fields,
  };
}

/**
 * What a schema 1 or 2 document becomes under schema 3 (M6A-SPEC §4.2, independent of `migrateSnapshot` so tests can
 * compare against it): `schemaVersion` = SCHEMA_VERSION, every built-in table present (the seven M6a tables empty) with
 * its table version, characters with `source: {kind: 'asset', asset}` and assets with `provenance: null`. Tables and
 * table versions are sorted by name, as snapshots write them.
 */
export function withSchemaV3(snapshot: DocSnapshot): DocSnapshot {
  const tables: Record<string, Record<string, unknown>> = {};
  const raw = snapshot.tables as unknown as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  for (const name of [...new Set([...Object.keys(raw), ...BUILTIN_TABLES])].sort(compareStrings)) {
    const rows: Record<string, unknown> = {};
    for (const [id, record] of Object.entries(raw[name] ?? {})) {
      const row = record as Readonly<Record<string, unknown>>;
      if (name === 'characters' && row['source'] === undefined) {
        rows[id] = { ...row, source: { kind: 'asset', asset: row['asset'] } };
      } else if (name === 'assets' && !('provenance' in row)) rows[id] = { ...row, provenance: null };
      else rows[id] = record;
    }
    tables[name] = rows;
  }
  const tableVersions: Record<string, number> = {};
  for (const name of [...new Set([...Object.keys(snapshot.tableVersions), ...BUILTIN_TABLES])].sort(compareStrings)) {
    tableVersions[name] = snapshot.tableVersions[name] ?? 1;
  }
  return {
    ...snapshot,
    schemaVersion: SCHEMA_VERSION,
    tableVersions,
    tables: tables as unknown as SnapshotTables,
  };
}
