import { readFixture } from '@ekza-studio/doc/testing';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../src/glb/parse';
import { readEmbeddedAvatarHeightScale } from '../src/gltf/ekzaMeta';
import { detectModelFormat, readVrmLicense } from '../src/gltf/format';
import { importProvenance, NON_REDISTRIBUTABLE_NAME } from '../src/gltf/provenance';
import { makeGlb } from '../src/testing/glb';
import { CC_BY_DEED_URL, CC0_DEED_URL, VRM_LICENSE_URL } from '../src/vrm/meta';
import type { GltfJson } from '../src/types';

const asJson = (value: object): GltfJson => ({ asset: { version: '2.0' }, ...value });

describe('detectModelFormat', () => {
  it('classifies the fixtures', async () => {
    expect(detectModelFormat((await parseGlb(readFixture('polybot.vrm'))).json)).toBe('vrm0');
    expect(detectModelFormat((await parseGlb(readFixture('seed-san.vrm'))).json)).toBe('vrm1');
    expect(detectModelFormat((await parseGlb(readFixture('quaternius-ual.glb'))).json)).toBe('gltf');
  });

  it('rejects files that declare both VRM versions', () => {
    expect(() => detectModelFormat(asJson({ extensions: { VRM: {}, VRMC_vrm: {} } }))).toThrow(
      expect.objectContaining({ code: 'vrm-both' }),
    );
  });

  it('needs the extension object, not only extensionsUsed', () => {
    expect(detectModelFormat(asJson({ extensionsUsed: ['VRMC_vrm'] }))).toBe('gltf');
    expect(detectModelFormat(asJson({ extensions: { VRMC_vrm: { specVersion: '1.0' } } }))).toBe('vrm1');
  });
});

describe('readVrmLicense', () => {
  it('maps Polybot (VRM 0.x CC0)', async () => {
    expect(readVrmLicense(await parseGlb(readFixture('polybot.vrm')))).toEqual({
      title: 'Polybot',
      authors: ['Polygonal Mind'],
      licenseUrl: null,
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
      commercialUsage: 'Allow',
      creditNotation: 'unnecessary',
      licenseName: 'CC0-1.0',
    });
  });

  it('maps Seed-san (VRM 1.0, VRM Public License)', async () => {
    expect(readVrmLicense(await parseGlb(readFixture('seed-san.vrm')))).toEqual({
      title: 'Seed-san',
      authors: ['VirtualCast, Inc.'],
      licenseUrl: 'https://vrm.dev/licenses/1.0/',
      allowRedistribution: true,
      modification: 'allowModificationRedistribution',
      commercialUsage: 'corporation',
      creditNotation: 'required',
      licenseName: 'LicenseRef-VRM-PL-1.0',
    });
  });

  it('reads the CC deed of a VRM 1.0 otherLicenseUrl (our CC0 / CC BY presets) over the VRM-PL licenseUrl', async () => {
    const vrm1 = (otherLicenseUrl: string | undefined) =>
      parseGlb(
        makeGlb(
          {
            asset: { version: '2.0' },
            extensions: {
              VRMC_vrm: {
                specVersion: '1.0',
                meta: {
                  name: 'Bruno',
                  authors: ['Tester'],
                  licenseUrl: VRM_LICENSE_URL,
                  ...(otherLicenseUrl === undefined ? {} : { otherLicenseUrl }),
                },
              },
            },
          },
          null,
        ),
      );
    expect(readVrmLicense(await vrm1(CC0_DEED_URL))).toMatchObject({
      licenseUrl: CC0_DEED_URL,
      licenseName: 'CC0-1.0',
    });
    expect(readVrmLicense(await vrm1(CC_BY_DEED_URL))).toMatchObject({ licenseName: 'CC-BY-4.0' });
    // Any other deed (or none) keeps the VRM Public License reading.
    expect(readVrmLicense(await vrm1('https://example.com/my-licence'))).toMatchObject({
      licenseUrl: VRM_LICENSE_URL,
      licenseName: 'LicenseRef-VRM-PL-1.0',
    });
    expect(readVrmLicense(await vrm1(undefined))).toMatchObject({ licenseName: 'LicenseRef-VRM-PL-1.0' });
  });

  it('returns null for plain glTF and maps restrictive VRM 0.x licences', async () => {
    expect(readVrmLicense(await parseGlb(readFixture('quaternius-ual.glb')))).toBeNull();
    const vrm0 = (licenseName: string) =>
      parseGlb(
        makeGlb({ asset: { version: '2.0' }, extensions: { VRM: { meta: { title: 'x', licenseName } } } }, null),
      );
    const prohibited = readVrmLicense(await vrm0('Redistribution_Prohibited'));
    expect(prohibited).toMatchObject({ allowRedistribution: false, modification: null, licenseName: 'proprietary' });
    const nd = readVrmLicense(await vrm0('CC_BY_ND'));
    expect(nd).toMatchObject({
      allowRedistribution: true,
      modification: 'prohibited',
      creditNotation: 'required',
      licenseName: 'CC-BY-ND-4.0',
    });
    expect(readVrmLicense(await vrm0('Other'))).toMatchObject({ allowRedistribution: null, licenseName: 'unknown' });
  });
});

describe('readEmbeddedAvatarHeightScale', () => {
  it('reads root extras first, then asset.extras, and accepts numeric strings', () => {
    expect(readEmbeddedAvatarHeightScale(asJson({}))).toBeNull();
    expect(readEmbeddedAvatarHeightScale(asJson({ extras: { ekza: { avatar: { heightScale: 1.2 } } } }))).toBe(1.2);
    expect(
      readEmbeddedAvatarHeightScale({
        asset: { version: '2.0', extras: { ekza: { avatar: { heightScale: '0.75' } } } },
      }),
    ).toBe(0.75);
    expect(readEmbeddedAvatarHeightScale(asJson({ extras: { ekza: { avatar: { heightScale: 'tall' } } } }))).toBeNull();
    expect(readEmbeddedAvatarHeightScale(asJson({ extras: { ekza: { avatar: { heightScale: 3 } } } }))).toBe(3);
  });
});

describe('importProvenance', () => {
  const vrm: Parameters<typeof importProvenance>[0] = {
    title: 'Seed-san',
    authors: ['VirtualCast, Inc.'],
    licenseUrl: 'https://vrm.dev/licenses/1.0/',
    allowRedistribution: true,
    modification: 'allowModificationRedistribution',
    commercialUsage: 'corporation',
    creditNotation: 'required',
    licenseName: 'LicenseRef-VRM-PL-1.0',
  };

  it('inherits the VRM meta for embedded clips', () => {
    expect(importProvenance(vrm, { sourceSha256: 'ABC', names: ['wave'] })).toEqual({
      derivedFrom: [
        { title: 'Seed-san', author: 'VirtualCast, Inc.', license: 'LicenseRef-VRM-PL-1.0', sourceSha256: 'abc' },
      ],
      redistributable: 'yes',
    });
    expect(
      importProvenance({ ...vrm, allowRedistribution: false }, { sourceSha256: null, names: [] }).redistributable,
    ).toBe('no');
    expect(
      importProvenance({ ...vrm, allowRedistribution: null }, { sourceSha256: null, names: [] }).redistributable,
    ).toBe('unknown');
  });

  it("marks the auto-rigging service's material as not redistributable and unknown sources as unknown", () => {
    const mark = NON_REDISTRIBUTABLE_NAME.source;
    expect(importProvenance(vrm, { sourceSha256: null, names: [`${mark}.com`] }).redistributable).toBe('no');
    expect(importProvenance(null, { sourceSha256: null, names: ['Idle'] })).toEqual({
      derivedFrom: [],
      redistributable: 'unknown',
    });
    expect(importProvenance(null, { sourceSha256: null, names: [`${mark}rig:Hips`] }).redistributable).toBe('no');
  });

  it('passes the known licence of bundled samples', () => {
    const known = { title: 'Universal Animation Library', author: 'Quaternius', license: 'CC0-1.0' };
    expect(importProvenance(null, { sourceSha256: 'ff', names: ['Idle_Loop'], known })).toEqual({
      derivedFrom: [{ ...known, sourceSha256: 'ff' }],
      redistributable: 'yes',
    });
  });
});
