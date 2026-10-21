// Schema v4 test records (M6B-SPEC §4.1): VRM meta, thumbnail assets, test clips, and what an older document becomes
// under schema 4. Deterministic: callers pass the ids they need.
import type { AssetId } from '../ids';
import type { AssetRecord, CharacterVrmMeta } from '../records';
import { makeVrmMeta } from '../records/vrm';
import { jointKeyStem } from '../records/repair';
import type { DocSnapshot, SnapshotTables } from '../store';
import { testHash, withSchemaV3 } from './records-v3';

/** A complete VRM meta with the schema defaults (`name` = the given name, no licence chosen): `makeVrmMeta`. */
export function makeTestVrmMeta(name: string, fields: Partial<CharacterVrmMeta> = {}): CharacterVrmMeta {
  return makeVrmMeta(name, fields);
}

/** A square PNG thumbnail asset record (role 'thumbnail'). */
export function makeTestThumbnailAsset(name: string): AssetRecord {
  return {
    id: testHash(`thumbnail:${name}`) as AssetId,
    name,
    ext: 'png',
    mime: 'image/png',
    size: 0,
    role: 'thumbnail',
    provenance: null,
  };
}

/**
 * What a schema 1, 2 or 3 document becomes under schema 4 (M6B-SPEC §4.1; independent of `migrateSnapshot` so tests
 * can compare against it): `withSchemaV3`, then characters with `vrm: null` and joints with `role: 'bone'` and
 * `key` = the sanitized name, de-duplicated per skeleton in id order with `#n` suffixes.
 */
export function withSchemaV4(snapshot: DocSnapshot): DocSnapshot {
  const v3 = withSchemaV3(snapshot);
  const raw = v3.tables as unknown as Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
  >;
  const tables: Record<string, Record<string, unknown>> = { ...raw };
  const characters: Record<string, unknown> = {};
  for (const [id, row] of Object.entries(raw['characters'] ?? {}))
    characters[id] = 'vrm' in row ? row : { ...row, vrm: null };
  tables['characters'] = characters;
  const joints: Record<string, unknown> = {};
  const used = new Map<string, Set<string>>();
  for (const id of Object.keys(raw['joints'] ?? {}).sort()) {
    const row = raw['joints']?.[id] as Readonly<Record<string, unknown>>;
    if ('role' in row && 'key' in row) {
      joints[id] = row;
      continue;
    }
    const skeleton = String(row['skeleton']);
    const keys = used.get(skeleton) ?? new Set<string>();
    used.set(skeleton, keys);
    const stem = typeof row['key'] === 'string' ? row['key'] : jointKeyStem(row['name']);
    let key = stem;
    for (let n = 1; keys.has(key); n++) key = `${stem}#${n}`;
    keys.add(key);
    joints[id] = { ...row, role: row['role'] ?? 'bone', key };
  }
  tables['joints'] = joints;
  return { ...v3, tables: tables as unknown as SnapshotTables };
}
