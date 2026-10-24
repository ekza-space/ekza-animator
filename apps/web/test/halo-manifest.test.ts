// Halo T0 (STUDIO-TOUCH-SPEC S12, §17; ST-22): the web manifest for Home Screen mode starts at `/app` with the whole
// site in scope, and its icons exist at their declared sizes. It is linked from the `/app` segment only (T2's layout),
// never from the root layout, so a Pro page added to the Home Screen does not launch `/app`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicFile = (path: string): Buffer => readFileSync(new URL(`../public/${path}`, import.meta.url));

interface Icon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

const manifest = JSON.parse(publicFile('manifest.webmanifest').toString('utf8')) as {
  readonly id: string;
  readonly name: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly icons: readonly Icon[];
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): readonly [number, number] {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe('manifest.webmanifest', () => {
  it('opens Ekza Studio at /app, standalone, with the whole site in scope', () => {
    expect(manifest).toMatchObject({
      id: '/app',
      name: 'Ekza Studio',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      background_color: '#1b1c1f',
      theme_color: '#1b1c1f',
    });
  });

  it('declares icons that exist at their sizes, a maskable one and the apple-touch-icon', () => {
    for (const icon of manifest.icons) {
      const [width, height] = pngSize(publicFile(icon.src.slice(1)));
      expect(`${width}x${height}`).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.map((icon) => icon.purpose)).toContain('maskable');
    expect(pngSize(publicFile('apple-touch-icon.png'))).toEqual([180, 180]);
  });

  it('is not linked from the root layout (the /app segment links it)', () => {
    const root = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
    expect(root).not.toMatch(/manifest/);
  });
});
