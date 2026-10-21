// C12 (M6B-SPEC §0.4.7 "Serving", §0.5): the ClipLibraryService on the naive kit — the manifest is fetched once (a
// failed load is retried), from `libraryPath`; a clip's bytes are fetched on first use, verified against the manifest's
// size and SHA-256 and cached; a checksum failure is sticky for the session; the preview state is null without a
// preview; the app's `library` shell forwards to the chunk's service.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { attachClipLibrary, type ClipLibrary } from '../../src/library';
import { opsApp } from '../builtin/support';

const CLIP = new TextEncoder().encode('vrma bytes');
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function manifest(bytes = CLIP) {
  return {
    version: 1,
    id: 'ekza/starter-pack',
    title: 'Starter pack — Universal Animation Library',
    license: 'CC0-1.0',
    credit: 'Universal Animation Library by Quaternius (CC0)',
    sourceUrl: 'https://quaternius.com/packs/universalanimationlibrary.html',
    source: { file: 'fixtures/animations/quaternius-ual.glb', sha256: 'a'.repeat(64) },
    generator: 'tooling/make-starter-pack.mjs v1',
    clips: [
      {
        id: 'walk',
        source: 'Walk_Loop',
        label: 'Walk',
        slot: 'walk',
        loop: true,
        file: 'walk.vrma',
        bytes: bytes.length,
        sha256: sha(bytes),
        duration: 1,
        fps: 30,
        license: 'CC0-1.0',
        credit: 'Quaternius',
      },
    ],
  };
}

function server(files: Record<string, unknown>) {
  const requests: string[] = [];
  let failNext = false;
  const fetch = (url: string) => {
    requests.push(url);
    const body = files[url];
    if (failNext || body === undefined) {
      failNext = false;
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('404')),
        arrayBuffer: () => Promise.reject(new Error('404')),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve((body as Uint8Array).slice().buffer),
    });
  };
  return {
    fetch,
    requests,
    failOnce: () => {
      failNext = true;
    },
  };
}

describe('ClipLibraryService (§0.4.7)', () => {
  it('fetches the manifest once from libraryPath, retries a failed load, caches verified bytes', async () => {
    const app = opsApp();
    const files = { '/lib/x/animations/starter-pack.json': manifest(), '/lib/x/animations/walk.vrma': CLIP };
    const host = server(files);
    Object.assign(app.services, { libraryPath: '/lib/x' });
    const library = attachClipLibrary(app, { fetch: host.fetch, frames: null }).service as ClipLibrary;
    expect(library.preview).toBeNull();
    host.failOnce();
    await expect(library.manifest()).rejects.toMatchObject({ code: 'unavailable' });
    const parsed = await library.manifest();
    expect(parsed.clips[0]?.label).toBe('Walk');
    expect(await library.manifest()).toBe(parsed);
    expect(library.labelOf('walk')).toBe('Walk');
    expect(await library.bytes('walk')).toEqual(CLIP);
    expect(await library.bytes('walk')).toEqual(CLIP);
    expect(host.requests).toEqual([
      '/lib/x/animations/starter-pack.json',
      '/lib/x/animations/starter-pack.json',
      '/lib/x/animations/walk.vrma',
    ]);
    await expect(library.bytes('nope')).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('a size or SHA-256 mismatch fails with "The file failed its checksum", sticky for the session', async () => {
    const app = opsApp();
    const tampered = new TextEncoder().encode('vrma bytez');
    const host = server({
      '/library/animations/starter-pack.json': manifest(),
      '/library/animations/walk.vrma': tampered,
    });
    const library = attachClipLibrary(app, { fetch: host.fetch, frames: null }).service as ClipLibrary;
    let notified = 0;
    library.subscribe(() => notified++);
    await expect(library.bytes('walk')).rejects.toMatchObject({
      code: 'checksum',
      message: 'The file failed its checksum',
    });
    expect(library.failed('walk')).toBe(true);
    expect(notified).toBeGreaterThan(0);
    await expect(library.bytes('walk')).rejects.toMatchObject({ code: 'checksum' });
    expect(host.requests.filter((url) => url.endsWith('walk.vrma')).length).toBe(1);
  });

  it("the app's library shell loads the chunk and forwards to its service", async () => {
    const app = opsApp();
    expect(app.library.loaded).toBe(false);
    expect(app.library.service.preview).toBeNull();
    await app.library.load();
    expect(app.library.loaded).toBe(true);
    expect(app.operators.get('library.useClip')?.flags?.undo).toBe(true);
  });
});
