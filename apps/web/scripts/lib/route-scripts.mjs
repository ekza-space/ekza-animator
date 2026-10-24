// A route's script set, read from a Next.js (Turbopack) production build (M2A-SPEC §5.21.2, M-2; route-group-proof
// since AUTORIG-SPEC §7.2, D0). One definition for `check:size`, the chunk attribution report and their tests:
//
// - **initial** — what the route requests until its empty state shows: every `<script src>` and
//   `<link rel="preload" as="script">` of the prerendered route HTML except `noModule` scripts (modern browsers never
//   fetch them; Next's polyfill chunk is one), plus the files of the `next/dynamic` components of the route's page
//   **and of every layout above it** (the islands are `ssr: false`, so they load on mount), plus every chunk a
//   Turbopack chunk-list loader of those entries names, plus — for a shared-layout route — the lazy groups that carry
//   the route's **initial markers** (`ROUTE_INITIAL_MARKERS`: the `StudioHost` entry and the route's shell entry,
//   counted as initial even when the host loads the shell with `React.lazy`). The budget bench's `editor route JS`
//   test records the same set from the network (`e2e/bench/budgets.bench.ts`), and the two totals were cross-checked
//   once (wp-notes).
// - **lazy groups** — every other Turbopack chunk-list loader the route can reach (`import()` / `React.lazy`
//   boundaries defined in an initial chunk or in a reachable lazy group's chunk): the loader's module id, its target
//   module and the files it fetches that are not initial; and every web-worker loader (`new Worker(new URL(…))`: the
//   skin worker, M6B-SPEC §2.1), whose chunks load only when the worker starts (target −1).
//
// Route groups (`app/(studio)/editor/page.tsx`) keep the URL and the prerendered HTML path (`server/app/editor.html`)
// but move the server-side build manifests (`server/app/(studio)/editor/page/react-loadable-manifest.json`). The
// route's segment is therefore resolved from `server/app-paths-manifest.json` (route groups included), never guessed,
// and a missing page manifest throws: a silent `{}` would drop the whole editor island from the measure. Turbopack
// (Next 16.3) writes a layout's `next/dynamic` files into the page entry's manifest (measured by D0,
// docs/wp-notes/ar-contracts.md); a separate `…/layout/react-loadable-manifest.json` is read too when a build has one.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** gzip -9 size of a buffer or string (the budget's measure; decimal kB in reports). */
export function gzip9(data) {
  return gzipSync(typeof data === 'string' ? Buffer.from(data) : data, { level: 9 }).byteLength;
}

export const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/** `/_next/static/chunks/x.js?dpl=…` → `static/chunks/x.js` (the build manifests' spelling). */
export function chunkPath(url) {
  return url
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/?_next\//, '')
    .split(/[?#]/)[0];
}

function attr(tag, name) {
  const match = new RegExp(`\\s${name}(?:=("[^"]*"|'[^']*'|[^\\s>]+))?`, 'i').exec(tag);
  if (match === null) return null;
  const value = match[1] ?? '';
  return value.replace(/^["']|["']$/g, '');
}

/**
 * Scripts a modern browser fetches for a page's HTML: `<script src>` without `nomodule`, and `<link rel=preload
 * as=script>` (and `modulepreload`). Paths in manifest spelling, in document order, deduplicated.
 */
export function htmlScripts(html) {
  const out = [];
  const add = (url) => {
    if (url === null || url === '') return;
    const path = chunkPath(url);
    if (path.endsWith('.js') && !out.includes(path)) out.push(path);
  };
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, 'nomodule') !== null) continue;
    add(attr(tag, 'src'));
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const as = (attr(tag, 'as') ?? '').toLowerCase();
    if ((rel.includes('preload') && as === 'script') || rel.includes('modulepreload')) add(attr(tag, 'href'));
  }
  return out;
}

const LOADER =
  /,(\d+),\s*\(?(\w+)\)?\s*=>\s*\{\s*\2\.v\(\s*\(?(\w+)\)?\s*=>\s*Promise\.all\(\s*\[([^\]]*)\][^{}]*?\.then\(\s*\(\)\s*=>\s*\3\((\d+)\)\s*\)\s*\)\s*\}/g;

/** A web-worker loader: `,<id>,e=>{e.v(e.r(<n>).default("static/chunks/turbopack-worker-….js",["static/chunks/a.js",…]))}`. */
const WORKER_LOADER =
  /,(\d+),\s*\(?(\w+)\)?\s*=>\s*\{\s*\2\.v\(\s*\2\.r\(\d+\)\.default\(\s*"[^"]*turbopack-worker[^"]*"\s*,\s*\[([^\]]*)\]\s*\)\s*\)\s*\}/g;

/**
 * Turbopack chunk-list loaders in a chunk's source: `,<id>,e=>{e.v(t=>Promise.all(["static/chunks/a.js",…]
 * .map(t=>e.l(t))).then(()=>t(<target>)))}` — the module a dynamic `import()` resolves through.
 */
export function chunkLoaders(source) {
  const out = [];
  for (const match of source.matchAll(LOADER)) {
    const files = [...match[4].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    out.push({ id: Number(match[1]), target: Number(match[5]), files });
  }
  for (const match of source.matchAll(WORKER_LOADER)) {
    const files = [...match[3].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    out.push({ id: Number(match[1]), target: -1, files });
  }
  return out;
}

function listChunks(nextDir) {
  const dir = join(nextDir, 'static', 'chunks');
  const out = [];
  const walk = (current, prefix) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
      else if (entry.endsWith('.js')) out.push(`static/chunks/${prefix}${entry}`);
    }
  };
  walk(dir, '');
  return out;
}

/**
 * Whether `.next` holds an e2e build (`NEXT_PUBLIC_EKZA_E2E=1`: the `/e2e/vrma-check` route exists). Throws when the
 * tree mixes two builds — the e2e route's prerendered HTML is there but the build's own app-paths manifest does not
 * list it: a production build (or a turbo cache restore of one) written over a previous e2e build's `.next`, whose
 * stale files would make the measure skip the eager-delta gate and read stale chunks (D0 fix round 1; `pnpm run ci`
 * runs `clean:next` before the build).
 */
export function isE2eBuild(nextDir) {
  if (!existsSync(join(nextDir, 'server', 'app', 'e2e', 'vrma-check.html'))) return false;
  const manifestPath = join(nextDir, 'server', 'app-paths-manifest.json');
  if (existsSync(manifestPath)) {
    const entries = Object.keys(JSON.parse(readFileSync(manifestPath, 'utf8'))).map(stripRouteGroups);
    if (!entries.includes('/e2e/vrma-check/page')) {
      throw new Error(
        `${nextDir} mixes two builds: server/app/e2e/vrma-check.html is a stale e2e file the build's ` +
          'app-paths-manifest.json does not list; run `pnpm --filter web clean:next` and build again',
      );
    }
  }
  return true;
}

/**
 * Markers of the lazy groups a shared-layout route counts as initial (AUTORIG-SPEC §7.2 rule 4): the `StudioHost`
 * entry (`ekza-studio-host`, D1) and the route's own shell entry (`ekza-studio-shell` for `/editor`, the Auto-Rig
 * shell's `ekza-autorig-shell` for `/autorig`, the Halo shell's `ekza-halo-shell` for `/app`, STUDIO-TOUCH-SPEC
 * §20.6). Another route's shell marker stays a lazy boundary.
 */
export const ROUTE_INITIAL_MARKERS = {
  editor: ['ekza-studio-host', 'ekza-studio-shell'],
  autorig: ['ekza-studio-host', 'ekza-autorig-shell'],
  app: ['ekza-studio-host', 'ekza-halo-shell'],
};

/** `/(studio)/editor/page` → `/editor/page`: route groups (`(name)` segments) do not change the URL. */
export function stripRouteGroups(entry) {
  return entry
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join('/');
}

/**
 * The app-paths-manifest entry of a route's page (`/(studio)/editor/page`), route groups included. Throws when the
 * manifest is missing or names no page (or more than one) for the route.
 */
export function routeSegment(nextDir, route) {
  const manifestPath = join(nextDir, 'server', 'app-paths-manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} not found: cannot resolve the /${route} segment`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const want = route === '' ? '/page' : `/${route}/page`;
  const found = Object.keys(manifest).filter((entry) => stripRouteGroups(entry) === want);
  if (found.length !== 1) {
    throw new Error(
      `${manifestPath}: ${found.length === 0 ? 'no page' : `${found.length} pages (${found.join(', ')})`} for /${route}`,
    );
  }
  return found[0];
}

function loadableFiles(manifest) {
  const out = [];
  for (const entry of Object.values(manifest)) {
    for (const file of entry.files ?? []) if (file.endsWith('.js') && !out.includes(file)) out.push(file);
  }
  return out;
}

/**
 * The `react-loadable-manifest.json` paths of a page segment and of every layout above it, page first. Only the page's
 * is required (Next writes one per page entry, `{}` when it has no dynamic imports); layouts' are read when present.
 */
export function loadableManifests(nextDir, segment) {
  const parts = segment.replace(/^\//, '').split('/');
  if (parts.at(-1) === 'page') parts.pop();
  const app = join(nextDir, 'server', 'app');
  const page = join(app, ...parts, 'page', 'react-loadable-manifest.json');
  const layouts = [];
  for (let depth = parts.length; depth >= 0; depth -= 1) {
    layouts.push(join(app, ...parts.slice(0, depth), 'layout', 'react-loadable-manifest.json'));
  }
  return { page, layouts };
}

/**
 * The route's initial script set and lazy chunk groups (see the file comment). `route` is the app route without the
 * leading slash ('editor', 'autorig'). Throws when the build lacks the route's prerendered HTML, its app-paths entry or
 * its page's loadable manifest. `opts.initialMarkers` overrides `ROUTE_INITIAL_MARKERS[route]`.
 */
export function readRouteScripts(nextDir, route = 'editor', opts = {}) {
  const htmlPath = join(nextDir, 'server', 'app', `${route}.html`);
  if (!existsSync(htmlPath)) throw new Error(`${htmlPath} not found: no prerendered /${route} in this build`);
  const html = htmlScripts(readFileSync(htmlPath, 'utf8'));
  const segment = routeSegment(nextDir, route);
  const manifests = loadableManifests(nextDir, segment);
  if (!existsSync(manifests.page)) {
    throw new Error(`${manifests.page} not found: the /${route} page (${segment}) has no react-loadable-manifest.json`);
  }
  const loadablePaths = [manifests.page, ...manifests.layouts.filter((path) => existsSync(path))];
  const dynamicFiles = [];
  for (const path of loadablePaths) {
    for (const file of loadableFiles(JSON.parse(readFileSync(path, 'utf8')))) {
      if (!dynamicFiles.includes(file)) dynamicFiles.push(file);
    }
  }

  const chunks = listChunks(nextDir);
  const sources = new Map(chunks.map((chunk) => [chunk, readFileSync(join(nextDir, chunk), 'utf8')]));
  // Every definition of every loader: Turbopack copies a module shared by several chunk groups into each group's
  // merged chunk, so one loader id can be defined in many chunks (one per route, or a test route's copy). A loader is
  // reachable or promotable when ANY of its defining chunks is (a single "last chunk wins" definition silently drops
  // a group whenever the copy sorting last belongs to another route; D0 fix round 1).
  const definitions = [];
  const loadersIn = new Map();
  for (const [chunk, source] of sources) {
    const found = chunkLoaders(source);
    loadersIn.set(chunk, found);
    for (const loader of found) definitions.push({ ...loader, definedIn: chunk });
  }
  definitions.sort((a, b) => a.id - b.id || (a.definedIn < b.definedIn ? -1 : a.definedIn > b.definedIn ? 1 : 0));

  // The loader of a `next/dynamic` entry lives in an initial chunk and fetches exactly the manifest's files; those
  // files are initial. A lazy group whose files carry one of the route's initial markers (the shared layout's host and
  // the route's shell, AUTORIG-SPEC §7.2 rule 4) is initial too — repeatedly, since the shell's loader lives in the
  // host's chunk. Every other loader is a lazy boundary.
  const initial = [...html];
  for (const file of dynamicFiles) if (!initial.includes(file)) initial.push(file);
  const markers = opts.initialMarkers ?? ROUTE_INITIAL_MARKERS[route] ?? [];
  const promoted = [];
  for (let changed = markers.length > 0; changed; ) {
    changed = false;
    for (const loader of definitions) {
      // only a loader reachable from the initial set: one of its defining chunks is initial
      if (!initial.includes(loader.definedIn)) continue;
      const files = loader.files.filter((file) => file.endsWith('.js') && !initial.includes(file));
      if (files.length === 0) continue;
      const source = files.map((file) => sources.get(file) ?? '').join('\n');
      if (!markers.some((marker) => source.includes(marker))) continue;
      for (const file of files) initial.push(file);
      promoted.push({ id: loader.id, files });
      changed = true;
    }
  }
  const initialSet = new Set(initial);
  const missing = initial.filter((file) => !sources.has(file));
  // Lazy groups are the loaders the route can reach: defined (any copy) in an initial chunk, or in a chunk of a
  // reachable lazy group (AUTORIG-SPEC §7.2: one build holds both routes, and a group only another route reaches is not this
  // route's).
  const reachable = new Set(initial);
  const lazy = [];
  const visited = new Set();
  for (let grown = true; grown; ) {
    grown = false;
    for (const loader of definitions) {
      // the first reachable definition of an id stands for it (copies of one module fetch the same files)
      if (visited.has(loader.id) || !reachable.has(loader.definedIn)) continue;
      visited.add(loader.id);
      const files = loader.files.filter((file) => file.endsWith('.js') && !initialSet.has(file));
      if (files.length === 0) continue;
      lazy.push({ id: loader.id, target: loader.target, definedIn: loader.definedIn, files });
      for (const file of files) reachable.add(file);
      grown = true;
    }
  }
  lazy.sort((x, y) => x.id - y.id);
  const size = (file) => (sources.has(file) ? gzip9(sources.get(file)) : 0);
  const sizes = new Map([...sources.keys()].map((file) => [file, size(file)]));
  return {
    html,
    segment,
    loadableManifests: loadablePaths,
    dynamic: dynamicFiles,
    promoted,
    initial,
    missing,
    lazy,
    chunks,
    sizes,
    sources,
    loadersIn,
    e2eBuild: isE2eBuild(nextDir),
  };
}
