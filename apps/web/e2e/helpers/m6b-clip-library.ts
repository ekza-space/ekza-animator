// Clip Library helpers (M6B-SPEC §0.4.7, E2E-LIB-01…03; C12): open the panel from Windows, the library's requests,
// the test API's `library()`, the PREVIEW badge, the committed starter-pack files and a VRMA import of the same bytes.
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { call, run } from './test-api';

/** The committed starter pack (what studio.ekza.io serves under /library/animations/). */
const LIBRARY_DIR = new URL('../../public/library/animations/', import.meta.url);

/** Bytes of a committed starter-pack file. */
export function starterPackFile(file: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(file, LIBRARY_DIR)));
}

/** Records every request of a /library/ URL (path only) from now on. */
export function libraryRequests(page: Page): { readonly paths: string[] } {
  const paths: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/library/')) paths.push(url.pathname);
  });
  return { paths };
}

/** Windows › Clip Library (Animate's right dock tab); waits for the cards. */
export async function openClipLibrary(page: Page): Promise<void> {
  await page.getByTestId('menu-windows').click();
  await page.getByTestId('menu-item-shell.windows.panel.clipLibrary').click();
  await expect(page.getByTestId('clip-library-panel')).toBeVisible();
  await expect(page.getByTestId('clip-card-walk')).toBeVisible({ timeout: 15_000 });
}

export type LibraryState = NonNullable<Awaited<ReturnType<typeof readLibrary>>>;

/** `library()` of the test API (null until the chunk and the manifest are in). */
export function readLibrary(page: Page) {
  return call(page, 'library');
}

/** The previewed clip id (null when nothing plays), polled until the library reports. */
export async function previewClip(page: Page): Promise<string | null> {
  const library = await readLibrary(page);
  return library?.preview?.clip ?? null;
}

/** The first viewport pane's id (the badge's suffix). */
export async function firstPane(page: Page): Promise<string> {
  const pane = (await call(page, 'panes'))[0];
  if (pane === undefined) throw new Error('no viewport pane');
  return pane.id;
}

/** Moves the pointer over the first viewport pane (keys follow the hovered panel). */
export async function hoverViewport(page: Page): Promise<void> {
  const pane = (await call(page, 'panes'))[0];
  if (pane === undefined) throw new Error('no viewport pane');
  await page.mouse.move(pane.rect.x + pane.rect.w / 2, pane.rect.y + pane.rect.h / 2);
}

/** The document-side marks a preview must leave unchanged: history, keys hash, record counts, dirty flag. */
export async function documentMarks(page: Page) {
  const state = await call(page, 'state');
  return {
    history: await call(page, 'history'),
    keys: await call(page, 'keysHash'),
    counts: await call(page, 'counts'),
    dirty: state.dirty,
  };
}

/** `file.importAnimation` of bytes from Node (base64 into the page), like a drop of the file on the character. */
export async function importAnimationBytes(
  page: Page,
  name: string,
  bytes: Uint8Array,
  character: string,
): Promise<readonly string[]> {
  const base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  const result = await page.evaluate(
    async ([fileName, data, target]) => {
      const binary = atob(data);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
      const api = window.__EKZA_STUDIO_TEST__;
      if (api === undefined) throw new Error('no test API');
      return api.run('file.importAnimation', { name: fileName, bytes: array, character: target });
    },
    [name, base64, character] as const,
  );
  expect(result.status, JSON.stringify(result)).toBe('finished');
  return (result.value as { clips: string[] }).clips;
}

/** A comparable view of a clip's curves (no ids): control, channel, flags and keys. */
export async function curvesShape(page: Page, clip: string) {
  const curves = await call(page, 'curves', clip);
  return curves
    .map(({ id: _id, keys, ...curve }) => ({
      ...curve,
      keys: keys.map(({ id: _key, ...key }) => key),
    }))
    .sort((a, b) => (`${a.control}|${a.channel}` < `${b.control}|${b.channel}` ? -1 : 1));
}

/** The `ekza_animation_v1` clip entry of a GLB/VRMA (JSON chunk). */
export function ekzaClipMeta(bytes: Uint8Array): {
  readonly name: string;
  readonly slot: string | null;
  readonly loop: boolean;
  readonly derivedFrom: readonly { title: string; author: string; license: string }[];
  readonly redistributable: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as {
    asset: { extras?: { ekza_animation_v1?: { clips: unknown[] } } };
  };
  const clip = json.asset.extras?.ekza_animation_v1?.clips[0];
  if (clip === undefined) throw new Error('no ekza_animation_v1 clip');
  return clip as ReturnType<typeof ekzaClipMeta>;
}

/** Exports one clip as VRMA through the shipped exporter and returns its bytes (`lastExport`). */
export async function exportClipVrma(page: Page, character: string, clip: string): Promise<Uint8Array> {
  const result = await run(page, 'file.export', {
    kind: 'vrma',
    character,
    clips: [clip],
    fileNamePattern: '{clip}',
    closeLoop: false,
    includeConstantTracks: true,
    acknowledgeLicense: false,
    profile: null,
  });
  expect(result.status, JSON.stringify(result)).toBe('finished');
  const bytes = await page.evaluate(() => {
    const last = window.__EKZA_STUDIO_TEST__?.lastExport();
    if (last === null || last === undefined) return null;
    let binary = '';
    for (const byte of last.bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  if (bytes === null) throw new Error('no export');
  return new Uint8Array(Buffer.from(bytes, 'base64'));
}

/** Polybot's display nodes of two humanoid bones (VRM 0 node names as three.js sanitizes them). */
export const POLYBOT_NODE = { hips: 'mixamorigHips', leftHand: 'mixamorigLeftHand' } as const;

/** World position of a node of the character's displayed (rendered) model: what the viewport shows, preview included. */
export async function displayed(page: Page, character: string, node: string): Promise<[number, number, number]> {
  let at: [number, number, number] | null = null;
  await expect
    .poll(async () => {
      at = await call(page, 'displayNodeWorld', character, node);
      return at !== null;
    })
    .toBe(true);
  return at as unknown as [number, number, number];
}

/** True when two positions agree within `eps` metres. */
export function samePosition(a: readonly number[], b: readonly number[], eps = 1e-5): boolean {
  return a.every((value, i) => Math.abs(value - (b[i] as number)) <= eps);
}
