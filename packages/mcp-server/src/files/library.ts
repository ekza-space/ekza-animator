// The clip library for headless projects (MCP-SPEC §0.4.4 `library_list` / `library_use`, §5.17.2, §5.19 T15): the
// editor's clip library fetches `<libraryPath>animations/starter-pack.json` and its `.vrma` files (default base
// `/library/`). The server bundles the starter pack (apps/web/public/library/animations, copied by the build into the
// package's `library/animations/`) and installs a `globalThis.fetch` that serves exactly those files from disk and
// refuses every other request: the server makes no network requests.
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The library's URL prefix (editor-core's DEFAULT_LIBRARY_PATH + `animations/`). */
export const LIBRARY_PREFIX = '/library/animations/';
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Where the starter pack is: `<package>/library/animations` (built) or the web app's public folder (sources). */
export function libraryDirs(): string[] {
  const here = import.meta.url;
  return [
    fileURLToPath(new URL('../library/animations/', here)), // dist/cli.mjs → library/animations
    fileURLToPath(new URL('../../library/animations/', here)), // src/files → library/animations
    fileURLToPath(new URL('../../../../apps/web/public/library/animations/', here)), // the repository
  ];
}

function mime(file: string): string {
  return file.endsWith('.json') ? 'application/json' : 'model/gltf-binary';
}

/** A fetch that serves the starter pack and refuses everything else (no network, §5.19 T15). */
export function createLibraryFetch(dirs: readonly string[] = libraryDirs()): typeof globalThis.fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // only the library's own relative URLs: anything with a scheme or a host would leave this computer
    if (!url.startsWith('/') || url.startsWith('//')) {
      throw new TypeError('ekza-studio-mcp makes no network requests');
    }
    const path = url.split(/[?#]/)[0] ?? '';
    const file = path.startsWith(LIBRARY_PREFIX) ? path.slice(LIBRARY_PREFIX.length) : '';
    if (!FILE.test(file)) return new Response(null, { status: 404 });
    for (const dir of dirs) {
      try {
        const bytes = await fsp.readFile(join(dir, file));
        return new Response(bytes, { status: 200, headers: { 'content-type': mime(file) } });
      } catch {
        // next folder
      }
    }
    return new Response(null, { status: 404 });
  };
}

let installed = 0;
let original: typeof globalThis.fetch | null = null;

/** Installs the library fetch for as long as a hub lives (reference counted); returns the uninstall. */
export function installLibraryFetch(): () => void {
  if (installed === 0) {
    original = globalThis.fetch;
    globalThis.fetch = createLibraryFetch();
  }
  installed++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    installed--;
    if (installed === 0 && original !== null) {
      globalThis.fetch = original;
      original = null;
    }
  };
}
