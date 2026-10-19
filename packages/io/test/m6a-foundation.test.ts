// M6A-SPEC §4.5 (B0a): io's M6a surface — the static-glb export kind, the handheld profile as data (not registered
// before B8), the archive's `blobs` (writer parameter accepted, reader map present), and the lazy `io/mesh` and
// `io/write` stubs that refuse `not-implemented` until B8 lands them.
import { describe, expect, it } from 'vitest';
import { BUILTIN_EXPORT_KINDS, BUILTIN_EXPORT_PROFILES, PROFILE_OMOBA_HANDHELD } from '../src';
import { editLicence, meshFromGltf, meshToPrimitives, writePaletteTexture } from '../src/mesh';
import { readProjectArchive, writeProjectArchive } from '../src/project/archive';
import { rebuildContainer, replacePrimitives, writeStaticGlb } from '../src/write';
import { emptySnapshot } from '@ekza-animator/doc';

const code = async (fn: () => unknown): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'other';
  }
};

describe('io M6a foundation', () => {
  it('adds the static-glb export kind and the OMOBA handheld profile (unregistered until B8)', () => {
    expect(BUILTIN_EXPORT_KINDS).toEqual(['bake-into-model', 'animation-glb', 'vrma', 'static-glb']);
    expect(PROFILE_OMOBA_HANDHELD).toMatchObject({
      id: 'ekza/omoba-handheld-v1',
      kind: 'static-glb',
      platform: 'desktop',
      profile: 'handheld-glb-v1',
      maxBytes: 8 * 1_048_576,
      ekza: true,
    });
    expect(BUILTIN_EXPORT_PROFILES.map((profile) => profile.id)).not.toContain('ekza/omoba-handheld-v1');
  });

  it('writeProjectArchive accepts the blob closure and readProjectArchive returns a blobs map', async () => {
    const bytes = writeProjectArchive(emptySnapshot('Blobs'), new Map(), { version: '0.3.0' }, new Map());
    const archive = await readProjectArchive(bytes);
    expect(archive.blobs).toBeInstanceOf(Map);
    expect(archive.blobs.size).toBe(0);
  });

  it('the lazy mesh entries are stubs until B8', async () => {
    const container = {
      bytes: new Uint8Array(0),
      json: { asset: { version: '2.0' } },
      jsonByteLength: 0,
      bin: null,
      sha256: '',
    };
    expect(await code(() => meshFromGltf(container, 0))).toBe('not-implemented');
    expect(await code(() => editLicence(container))).toBe('not-implemented');
    expect(await code(() => writePaletteTexture([]))).toBe('not-implemented');
    expect(await code(() => replacePrimitives(new Uint8Array(0), [], { marker: true }))).toBe('not-implemented');
    expect(await code(() => rebuildContainer(container, []))).toBe('not-implemented');
    expect(
      await code(() =>
        writeStaticGlb(
          {
            roots: [],
            palettes: new Map(),
            handheld: null,
            model: {
              schema: 1,
              rig: 'none',
              skeletonTemplate: null,
              provenance: {
                tool: 'ekza-animator',
                toolVersion: '0.3.0',
                projectSha256: null,
                derivedFrom: [],
                generator: { kind: 'manual' },
              },
            },
          },
          { generator: 'test' },
        ),
      ),
    ).toBe('not-implemented');
    expect(typeof meshToPrimitives).toBe('function');
  });
});
