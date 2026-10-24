// CHARACTER-CONTRACT-SPEC §4.2, §8.14 and decision CC-24 (C2): the OMOBA developer zip of a package (deterministic;
// the VRM staged to rest facing −Z, one VRMA per custom animation, the slot map copied) and the additive clip metadata
// fields `label` and `markers` (written only when set, so files without them keep their bytes).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeClipMeta } from '../../src/bake/meta';
import { packageManifestJson, readContractText } from '../../src/contract';
import { checkCharacterPackage } from '../../src/contract/packageCheck';
import { parseGlbSync } from '../../src/glb/parse';
import { omobaDevZipFileName, packOmobaDevZip, unzipFiles } from '../../src/omoba';
import type { EkzaClipMetaV1 } from '../../src/types';

const DIR = new URL('../../../../fixtures/contracts/omoba/v1/', import.meta.url);
const VRM = new Uint8Array(readFileSync(new URL('packages/ok-vrm1-three-slots.glb', DIR)));
const CONTRACT = readContractText(readFileSync(new URL('contract.json', DIR), 'utf8'));
const report = checkCharacterPackage(VRM, { contract: (r) => (r === CONTRACT.revision ? CONTRACT : undefined) });
const META = { displayName: 'Spark Doll', authors: ['Ada'], license: 'CC0-1.0' };

describe('the OMOBA developer zip', () => {
  const input = {
    vrm: VRM,
    manifest: report.manifest as NonNullable<typeof report.manifest>,
    animations: [
      { slot: 'base.run', bytes: new Uint8Array([1, 2, 3]) },
      { slot: 'basic.wildspark.0', bytes: new Uint8Array([4, 5]) },
    ],
    thumbnail: new Uint8Array([137, 80, 78, 71]),
    meta: META,
  };

  it('is deterministic and holds the staged VRM, the VRMAs, the entry, the slot map and the README', () => {
    const zip = packOmobaDevZip(input);
    expect(packOmobaDevZip(input)).toEqual(zip);
    expect(omobaDevZipFileName(META)).toBe('spark-doll-omoba-dev.zip');
    const files = unzipFiles(zip);
    expect(Object.keys(files)).toEqual([
      'spark-doll.glb',
      'spark-doll.png',
      'animations/base.run.vrma',
      'animations/basic.wildspark.0.vrma',
      'manifest-entry.json',
      'slot-map.json',
      'README.txt',
    ]);
    const staged = parseGlbSync(files['spark-doll.glb'] as Uint8Array).json as unknown as {
      asset: { extras: Record<string, unknown> };
    };
    expect(staged.asset.extras['omoba_rest_yaw180']).toBe(true);
    expect(staged.asset.extras['ekza_package_v1']).toBeDefined();
    const map: unknown = JSON.parse(new TextDecoder().decode(files['slot-map.json']));
    expect(map).toEqual(packageManifestJson(input.manifest));
    const readme = new TextDecoder().decode(files['README.txt']);
    expect(readme).toContain('validate-motion-pack');
    expect(readme).toContain('animations/basic.wildspark.0.vrma');
  });
});

describe('ekza_animation_v1 clip entries: label and markers (§8.14)', () => {
  const base: EkzaClipMetaV1 = {
    index: 0,
    name: 'basic.wildspark.0',
    slot: 'basic.wildspark.0',
    loop: false,
    fps: 30,
    durationSeconds: 0.4,
    rootMotion: 'in-place',
    contactSeconds: 0.1,
    tags: [],
    derivedFrom: [],
    redistributable: 'yes',
  };

  it('writes neither key when unset (M1 bytes unchanged) and both after the v1 keys when set', () => {
    expect(Object.keys(normalizeClipMeta(base))).toEqual(Object.keys(base));
    expect(Object.keys(normalizeClipMeta({ ...base, label: null, markers: {} }))).toEqual(Object.keys(base));
    const full = normalizeClipMeta({ ...base, markers: { release: 0.2, fire: 0.1 }, label: 'Basic attack' });
    expect(Object.keys(full).slice(-2)).toEqual(['label', 'markers']);
    expect(Object.keys(full.markers ?? {})).toEqual(['fire', 'release']);
  });
});
