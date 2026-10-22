// OMOBA local test kit e2e helpers (AUTORIG-SPEC §5.6.4; D6): read a downloaded kit back and check it against OMOBA's
// avatar manifest contract — `omoba-bevy` `passport/src/avatars.rs` `AvatarDefinition`: `slug`, `display_name`,
// `collection`, `license` and `source_url` strings, `author` and `thumbnail` optional — and the local flow's file
// names (`<slug>.glb` next to `<slug>.png`).
import { unzipFiles } from '@ekza-studio/io';
import { expect } from '@playwright/test';

/** OMOBA's manifest field names, in the order the kit writes them. */
export const OMOBA_FIELDS = ['author', 'collection', 'display_name', 'license', 'slug', 'source_url', 'thumbnail'];

export interface KitContents {
  readonly files: readonly string[];
  readonly bytes: Readonly<Record<string, Uint8Array>>;
  readonly entry: Record<string, unknown>;
  readonly readme: string;
}

/** Unzips a kit and parses its `manifest-entry.json` and `README.txt`. */
export function readKit(zip: Uint8Array): KitContents {
  const bytes = unzipFiles(zip);
  const text = (name: string): string => new TextDecoder().decode(bytes[name] ?? new Uint8Array());
  return {
    files: Object.keys(bytes),
    bytes,
    entry: JSON.parse(text('manifest-entry.json')) as Record<string, unknown>,
    readme: text('README.txt'),
  };
}

/** The entry parses as OMOBA's `AvatarDefinition` would read it (field names, types) and names the kit's files. */
export function expectOmobaEntry(kit: KitContents, slug: string): void {
  const { entry } = kit;
  expect(Object.keys(entry)).toEqual(OMOBA_FIELDS);
  for (const field of ['slug', 'display_name', 'collection', 'license', 'source_url']) {
    expect([field, typeof entry[field]]).toEqual([field, 'string']);
  }
  for (const field of ['author', 'thumbnail']) {
    expect([field, entry[field] === null || typeof entry[field] === 'string']).toEqual([field, true]);
  }
  expect(entry['slug']).toBe(slug);
  expect(entry['slug']).toMatch(/^[a-z0-9-]+$/);
  expect(entry['collection']).toBe('Ekza Studio');
  expect(kit.files).toContain(`${slug}.glb`);
  if (entry['thumbnail'] !== null) expect(kit.files).toContain(entry['thumbnail']);
  expect(kit.readme).toContain('validate-runtime-vrm');
  expect(kit.readme).toContain('OMOBA_AVATAR_MANIFEST');
  expect(kit.readme).toContain('Runtime compatibility is not approval');
}
