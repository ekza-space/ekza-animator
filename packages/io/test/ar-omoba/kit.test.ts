// AUTORIG-SPEC §5.6.4 (D6, io): the OMOBA local test kit — the slug rule (`[a-z0-9-]`), the licence text of the VRM
// presets, `manifest-entry.json` in OMOBA's field names (`AvatarDefinition`: author, collection, display_name, license,
// slug, source_url, thumbnail; `source_url` a string, `author`/`thumbnail` nullable), the README (validator command,
// local flow, "not approval"), the zip (the VRM bytes unchanged as `<slug>.glb`, the PNG stored, deterministic bytes)
// and `zipFiles` for the VRMA bundle.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  OMOBA_MANIFEST_FIELDS,
  OMOBA_PROTECTED_PREFIX,
  OMOBA_SLUG_MAX,
  omobaKitFileName,
  omobaKitFiles,
  omobaKitSlug,
  omobaKitReadme,
  omobaLicense,
  omobaManifestEntry,
  omobaManifestJson,
  omobaSlug,
  packOmobaKit,
  unzipFiles,
  vrmThumbnail,
  zipFiles,
} from '../../src';

const VRM = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const META = { displayName: 'Cube Lad', authors: ['Tester'], license: 'CC0' } as const;
const text = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

describe('omobaSlug (§5.6.4)', () => {
  it('lower-case [a-z0-9-], accents folded, runs collapsed, trimmed, capped; a fallback when empty', () => {
    expect(omobaSlug('Cube Lad')).toBe('cube-lad');
    expect(omobaSlug('  Polybot  ')).toBe('polybot');
    expect(omobaSlug('MeganTheFox')).toBe('meganthefox');
    expect(omobaSlug('Zoë — the Ränger!!')).toBe('zoe-the-ranger');
    expect(omobaSlug('a__b..c')).toBe('a-b-c');
    expect(omobaSlug('')).toBe('avatar');
    expect(omobaSlug('   ')).toBe('avatar');
    const long = omobaSlug(`${'x'.repeat(63)} yz`);
    expect(long).toBe('x'.repeat(63));
    expect(long).toMatch(/^[a-z0-9-]+$/);
    for (const name of ['Cube Lad', 'Zoë', 'A-B', '9 lives'])
      expect(omobaSlug(name)).toMatch(/^[a-z0-9](-?[a-z0-9])*$/);
  });

  it('never OMOBA’s protected ekza- prefix (its roster skips such an entry without a passport boundary)', () => {
    expect(omobaSlug('Ekza Bot')).toBe('studio-ekza-bot');
    expect(omobaSlug('ekza-bot')).toBe('studio-ekza-bot');
    expect(omobaSlug('  EKZA — Ranger')).toBe('studio-ekza-ranger');
    expect(omobaSlug('Ekzä_Bot')).toBe('studio-ekza-bot');
    // `ekza` alone and other ekza… words are not protected (OMOBA checks the `ekza-` prefix)
    expect(omobaSlug('ekza')).toBe('ekza');
    expect(omobaSlug('Ekza')).toBe('ekza');
    expect(omobaSlug('Ekzabot')).toBe('ekzabot');
    expect(omobaSlug('my ekza bot')).toBe('my-ekza-bot');
    // still capped at 64 with no trailing hyphen
    const long = omobaSlug(`ekza ${'y'.repeat(70)}`);
    expect(long).toBe(`studio-ekza-${'y'.repeat(52)}`);
    expect(long).toHaveLength(OMOBA_SLUG_MAX);
    for (const name of ['Ekza Bot', 'ekza', `ekza ${'y'.repeat(70)}`, 'EKZA-'])
      expect(omobaSlug(name).startsWith(OMOBA_PROTECTED_PREFIX)).toBe(false);
    // the kit's own names follow it
    const meta = { displayName: 'Ekza Bot', authors: ['Tester'], license: 'CC0' };
    expect(omobaManifestEntry(meta, true)).toMatchObject({
      display_name: 'Ekza Bot',
      slug: 'studio-ekza-bot',
      thumbnail: 'studio-ekza-bot.png',
    });
    expect(omobaKitFileName(meta)).toBe('studio-ekza-bot-omoba-kit.zip');
    expect(omobaKitFiles(meta, false)).toEqual(['studio-ekza-bot.glb', 'manifest-entry.json', 'README.txt']);
    expect(omobaKitSlug({ ...meta, slug: 'ekza-bot' })).toBe('studio-ekza-bot');
    const files = unzipFiles(packOmobaKit({ vrm: VRM, thumbnail: null, meta }));
    expect(Object.keys(files)).toEqual(['studio-ekza-bot.glb', 'manifest-entry.json', 'README.txt']);
    expect(text(files['README.txt'])).toContain('Copy studio-ekza-bot.glb into');
  });

  it('a name without Latin letters or digits gets a stable hash, so two such avatars do not collide', () => {
    expect(omobaSlug('Аватар')).toBe('avatar-9f935759');
    expect(omobaSlug('Кубик')).toBe('avatar-08ea8a06');
    expect(omobaSlug('  Кубик ')).toBe('avatar-08ea8a06');
    expect(omobaSlug('---')).toBe('avatar-c4e4dc86');
    expect(omobaSlug('Кубик')).not.toBe(omobaSlug('Робот'));
    // composed and decomposed spellings of one name are one slug
    expect(omobaSlug('\u0419')).toBe(omobaSlug('\u0418\u0306'));
  });

  it('is idempotent (the kit slugs a slug again)', () => {
    for (const name of ['Cube Lad', 'Ekza Bot', 'Кубик', '', `ekza ${'y'.repeat(70)}`, 'x'.repeat(80)])
      expect(omobaSlug(omobaSlug(name))).toBe(omobaSlug(name));
  });
});

describe('manifest-entry.json (§5.6.4)', () => {
  it('has exactly OMOBA’s field names in its order; collection "Ekza Studio"; source_url a string', () => {
    const entry = omobaManifestEntry(META, true);
    expect(entry).toEqual({
      author: 'Tester',
      collection: 'Ekza Studio',
      display_name: 'Cube Lad',
      license: 'CC0',
      slug: 'cube-lad',
      source_url: '',
      thumbnail: 'cube-lad.png',
    });
    const parsed = JSON.parse(omobaManifestJson(entry)) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...OMOBA_MANIFEST_FIELDS]);
    expect(Object.keys(parsed)).toEqual([
      'author',
      'collection',
      'display_name',
      'license',
      'slug',
      'source_url',
      'thumbnail',
    ]);
    expect(typeof parsed['source_url']).toBe('string');
    expect(omobaManifestJson(entry).endsWith('}\n')).toBe(true);
  });

  it('no author → null, no thumbnail → null, several authors joined, an explicit slug sanitized', () => {
    expect(omobaManifestEntry({ ...META, authors: [' ', ''] }, false)).toMatchObject({
      author: null,
      thumbnail: null,
    });
    expect(omobaManifestEntry({ ...META, authors: ['A', 'B'] }, false).author).toBe('A, B');
    expect(omobaManifestEntry({ ...META, slug: 'My Kit!' }, true)).toMatchObject({
      slug: 'my-kit',
      thumbnail: 'my-kit.png',
    });
    expect(omobaManifestEntry({ ...META, displayName: '  ' }, false).display_name).toBe('avatar');
    expect(omobaManifestEntry({ ...META, sourceUrl: 'https://hub.ekza.io/a/1' }, false).source_url).toBe(
      'https://hub.ekza.io/a/1',
    );
  });

  it('licence text per VRM preset (the roster writes "CC0")', () => {
    expect(omobaLicense('cc0')).toBe('CC0');
    expect(omobaLicense('cc-by-4.0')).toBe('CC-BY-4.0');
    expect(omobaLicense('personal')).toMatch(/Personal/);
    expect(omobaLicense('custom')).toMatch(/Custom/);
    expect(omobaLicense(null)).toBe('Not chosen');
  });
});

describe('README.txt (§5.6.4)', () => {
  it('names the files, the validate-runtime-vrm command, OMOBA_AVATAR_MANIFEST and that compatibility is not approval', () => {
    const readme = omobaKitReadme(omobaManifestEntry(META, true));
    expect(readme).toContain('cube-lad.glb');
    expect(readme).toContain('cube-lad.png');
    expect(readme).toContain('manifest-entry.json');
    expect(readme).toContain('cargo run --offline -p omoba-passport --bin validate-runtime-vrm -- ');
    expect(readme).toContain('OMOBA_AVATAR_MANIFEST=');
    expect(readme).toContain('Runtime compatibility is not approval');
    expect(readme.endsWith('\n')).toBe(true);
    expect(omobaKitReadme(omobaManifestEntry(META, false))).not.toContain('.png');
  });
});

describe('packOmobaKit (§5.6.4)', () => {
  it('zips <slug>.glb (the VRM bytes unchanged), <slug>.png, manifest-entry.json and README.txt', () => {
    const zip = packOmobaKit({ vrm: VRM, thumbnail: PNG, meta: META });
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['cube-lad.glb', 'cube-lad.png', 'manifest-entry.json', 'README.txt']);
    expect(Object.keys(files)).toEqual([...omobaKitFiles(META, true)]);
    expect(files['cube-lad.glb']).toEqual(VRM);
    expect(files['cube-lad.png']).toEqual(PNG);
    expect(JSON.parse(text(files['manifest-entry.json']))).toEqual(omobaManifestEntry(META, true));
    expect(text(files['README.txt'])).toBe(omobaKitReadme(omobaManifestEntry(META, true)));
    expect(omobaKitFileName(META)).toBe('cube-lad-omoba-kit.zip');
  });

  it('without a thumbnail: no PNG and thumbnail null', () => {
    const files = unzipSync(packOmobaKit({ vrm: VRM, thumbnail: null, meta: META }));
    expect(Object.keys(files)).toEqual(['cube-lad.glb', 'manifest-entry.json', 'README.txt']);
    expect((JSON.parse(text(files['manifest-entry.json'])) as Record<string, unknown>)['thumbnail']).toBeNull();
  });

  it('is deterministic: the same input gives the same bytes', () => {
    const a = packOmobaKit({ vrm: VRM, thumbnail: PNG, meta: META });
    const b = packOmobaKit({ vrm: VRM.slice(), thumbnail: PNG.slice(), meta: { ...META } });
    expect(b).toEqual(a);
  });
});

describe('zipFiles (the VRMA bundle)', () => {
  it('keeps order and bytes, refuses duplicate paths, is deterministic', () => {
    const entries = [
      { path: 'cube-lad-walk.vrma', bytes: VRM },
      { path: 'cube-lad-idle.vrma', bytes: PNG },
    ];
    const zip = zipFiles(entries);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(['cube-lad-walk.vrma', 'cube-lad-idle.vrma']);
    expect(files['cube-lad-idle.vrma']).toEqual(PNG);
    expect(zipFiles(entries)).toEqual(zip);
    expect(() => zipFiles([...entries, { path: 'cube-lad-walk.vrma', bytes: VRM }])).toThrow(/Duplicate/);
  });
});

describe('vrmThumbnail (§5.6.4, AR-D6-18)', () => {
  const fixture = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(new URL(`../../../../fixtures/models/${name}`, import.meta.url)));

  it('reads the image a VRM 1.0 meta names (Seed-san: image 14, a PNG)', () => {
    const thumb = vrmThumbnail(fixture('seed-san.vrm'));
    expect(thumb?.extension).toBe('png');
    expect(Array.from(thumb?.bytes.subarray(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(thumb?.bytes.byteLength).toBeGreaterThan(1000);
  });

  it('null when the VRM names none, or the bytes are not a GLB', () => {
    expect(vrmThumbnail(fixture('polybot.vrm'))).toBeNull(); // VRM 0.x without meta.texture
    expect(vrmThumbnail(fixture('cube-lad.glb'))).toBeNull(); // not a VRM
    expect(vrmThumbnail(VRM)).toBeNull();
    expect(vrmThumbnail(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('a JPEG thumbnail is written as <slug>.jpg', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const meta = { ...META, thumbnailExtension: 'jpg' as const };
    expect(omobaManifestEntry(meta, true).thumbnail).toBe('cube-lad.jpg');
    const files = unzipFiles(packOmobaKit({ vrm: VRM, thumbnail: jpeg, meta }));
    expect(Object.keys(files)).toEqual(['cube-lad.glb', 'cube-lad.jpg', 'manifest-entry.json', 'README.txt']);
    expect(text(files['README.txt'])).toContain('cube-lad.jpg');
  });
});
