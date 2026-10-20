// Deterministic test documents (MVP-SPEC §7 WP-2 `makeTestDocument`): N characters, each with an asset, a rig of M
// controls (a binary tree under 'root'), one clip with a base layer, rx/ry/rz curves per control and K keys per
// curve. The same options always produce the same snapshot (IDs come from a fixed seed, not the default source).
import { EkzaError } from '@ekza-animator/anim-core';
import type { AssetId, CharacterId, ControlId, IdSource, RigId } from '../ids';
import { controlId, newId, seededIdSource } from '../ids/generate';
import { sha256Hex } from '../migrations/sha256';
import type { AssetRecord, CharacterRecord, ControlRecord, RigRecord } from '../records';
import { makeClip, makeCurve, makeKey, makeLayer } from '../records/factories';
import { fractionalIndex } from '../records/order';
import { emptySnapshot } from '../snapshot/serialize';
import type { DocSnapshot, SnapshotTables } from '../store';

const IDENTITY = { t: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] } as const;
const AXES_ON = [true, true, true] as const;
const AXES_OFF = [false, false, false] as const;
/** Seed of the ID stream of every test document. */
export const TEST_DOCUMENT_SEED = 0x5eed;

/** A complete control record for tests (rotate-only FK control, circle shape). */
export function makeTestControl(fields: {
  readonly rig: RigId;
  readonly key: string;
  readonly parent: ControlId | null;
  readonly order: string;
  readonly name?: string;
}): ControlRecord {
  return {
    id: controlId(fields.rig, fields.key),
    rig: fields.rig,
    key: fields.key,
    name: fields.name ?? fields.key,
    side: 'C',
    group: 'body',
    parent: fields.parent,
    order: fields.order,
    restWorld: IDENTITY,
    rotateOrder: 'xyz',
    keyable: { t: AXES_ON, r: AXES_ON, s: AXES_OFF },
    locked: { t: AXES_OFF, r: AXES_OFF, s: AXES_OFF },
    drives: null,
    mirror: null,
    attrs: {},
    shape: { kind: 'circle', size: 0.1, offset: IDENTITY, custom: null, color: 'side', lineWidth: null },
    hiddenByDefault: false,
    deleted: null,
  };
}

/** A model asset record with a deterministic content hash (no bytes behind it). */
export function makeTestAsset(name: string): AssetRecord {
  return {
    id: sha256Hex(`test-asset:${name}`) as AssetId,
    name,
    ext: 'vrm',
    mime: 'model/gltf-binary',
    size: 0,
    role: 'model',
    provenance: null,
  };
}

export function makeTestCharacter(fields: {
  readonly id: CharacterId;
  readonly asset: AssetId;
  readonly rig: RigId;
  readonly name: string;
  readonly order: string;
  readonly x?: number;
}): CharacterRecord {
  return {
    id: fields.id,
    name: fields.name,
    asset: fields.asset,
    source: { kind: 'asset', asset: fields.asset },
    format: 'vrm1',
    rig: fields.rig,
    placement: { t: [fields.x ?? 0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] },
    order: fields.order,
    deleted: null,
  };
}

export function makeTestRig(id: RigId, character: CharacterId): RigRecord {
  return {
    id,
    character,
    format: 'ekza.rig',
    version: 1,
    generator: { name: 'ekza-autorig-humanoid', version: '0.0.0-test' },
    skeleton: { format: 'vrm1', fingerprint: `sha256:${sha256Hex(`test-skeleton:${id}`)}`, facing: [0, 0, 0, 1] },
    deleted: null,
  };
}

export function makeTestDocument(opts?: {
  readonly characters?: number;
  readonly controlsPerRig?: number;
  readonly keysPerCurve?: number;
}): DocSnapshot {
  const characters = count(opts?.characters ?? 1, 'characters');
  const controlsPerRig = count(opts?.controlsPerRig ?? 8, 'controlsPerRig');
  const keysPerCurve = count(opts?.keysPerCurve ?? 4, 'keysPerCurve');
  const ids: IdSource = seededIdSource(TEST_DOCUMENT_SEED);
  const base = emptySnapshot('Test document');
  const tables: Record<string, Record<string, unknown>> = {};
  for (const [name, rows] of Object.entries(base.tables)) tables[name] = { ...rows };
  const put = (table: string, record: { readonly id: string }): void => {
    (tables[table] ??= {})[record.id] = record;
  };

  let characterOrder: string | null = null;
  for (let c = 0; c < characters; c++) {
    characterOrder = fractionalIndex(characterOrder, null);
    const asset = makeTestAsset(`character-${c}.vrm`);
    const character = newId('character', ids);
    const rig = newId('rig', ids);
    put('assets', asset);
    put(
      'characters',
      makeTestCharacter({ id: character, asset: asset.id, rig, name: `Character ${c}`, order: characterOrder, x: c }),
    );
    put('rigs', makeTestRig(rig, character));

    const controls: ControlRecord[] = [];
    let order: string | null = null;
    for (let i = 0; i < controlsPerRig; i++) {
      order = fractionalIndex(order, null);
      const parent = i === 0 ? null : (controls[Math.floor((i - 1) / 2)]?.id ?? null);
      const control = makeTestControl({ rig, key: i === 0 ? 'root' : `ctl.${i}`, parent, order });
      controls.push(control);
      put('controls', control);
    }

    const end = Math.max(1, (keysPerCurve - 1) * 5);
    const clip = makeClip({
      id: newId('clip', ids),
      character,
      name: `clip_${c}`,
      fps: { num: 30, den: 1 },
      range: { start: 0, end },
    });
    const layer = makeLayer({ id: newId('layer', ids), clip: clip.id });
    put('clips', clip);
    put('layers', layer);
    controls.forEach((control, i) => {
      for (const [axis, channel] of (['rx', 'ry', 'rz'] as const).entries()) {
        const curve = makeCurve({
          id: newId('curve', ids),
          clip: clip.id,
          layer: layer.id,
          control: control.id,
          channel,
        });
        put('curves', curve);
        for (let k = 0; k < keysPerCurve; k++) {
          const v = 0.5 * Math.sin((c + 1) * (i + 1) * (axis + 1) * (k + 1));
          put('keys', makeKey({ id: newId('key', ids), clip: clip.id, curve: curve.id, t: k * 5, v }));
        }
      }
    });
  }
  return { ...base, tables: tables as unknown as SnapshotTables };
}

function count(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new EkzaError('unsupported', `makeTestDocument: ${name} must be a non-negative integer`);
  }
  return value;
}
