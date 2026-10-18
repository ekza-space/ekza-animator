// The editor route's script set, read from a Next.js (Turbopack) production build (M2A-SPEC §5.21.2, M-2). One
// definition for `check:size`, the chunk attribution report and their tests:
//
// - **initial** — what `/editor` requests until the empty state shows: every `<script src>` and
//   `<link rel="preload" as="script">` of the prerendered route HTML except `noModule` scripts (modern browsers never
//   fetch them; Next's polyfill chunk is one), plus the files of the route's `next/dynamic` components from its
//   `react-loadable-manifest.json` (the editor island is `ssr: false`, so it loads on mount), plus every chunk a
//   Turbopack chunk-list loader of those entries names. The budget bench's `editor route JS` test records the same
//   set from the network (`e2e/bench/budgets.bench.ts`), and the two totals were cross-checked once (wp-notes).
// - **lazy groups** — every other Turbopack chunk-list loader (`import()` / `React.lazy` boundaries): the loader's
//   module id, its target module and the files it fetches that are not initial.
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

/** Whether `.next` holds an e2e build (`NEXT_PUBLIC_EKZA_E2E=1`: the `/e2e/vrma-check` route exists). */
export function isE2eBuild(nextDir) {
  return existsSync(join(nextDir, 'server', 'app', 'e2e', 'vrma-check.html'));
}

/**
 * The route's initial script set and lazy chunk groups (see the file comment). `route` is the app route without the
 * leading slash ('editor'). Throws when the build lacks the route's prerendered HTML.
 */
export function readRouteScripts(nextDir, route = 'editor') {
  const htmlPath = join(nextDir, 'server', 'app', `${route}.html`);
  if (!existsSync(htmlPath)) throw new Error(`${htmlPath} not found: no prerendered /${route} in this build`);
  const html = htmlScripts(readFileSync(htmlPath, 'utf8'));
  const loadablePath = join(nextDir, 'server', 'app', route, 'page', 'react-loadable-manifest.json');
  const loadable = existsSync(loadablePath) ? JSON.parse(readFileSync(loadablePath, 'utf8')) : {};
  const dynamicFiles = [];
  for (const entry of Object.values(loadable)) {
    for (const file of entry.files ?? []) {
      if (file.endsWith('.js') && !dynamicFiles.includes(file)) dynamicFiles.push(file);
    }
  }

  const chunks = listChunks(nextDir);
  const sources = new Map(chunks.map((chunk) => [chunk, readFileSync(join(nextDir, chunk), 'utf8')]));
  const loaders = new Map();
  const loadersIn = new Map();
  for (const [chunk, source] of sources) {
    const found = chunkLoaders(source);
    loadersIn.set(chunk, found);
    for (const loader of found) loaders.set(loader.id, { ...loader, definedIn: chunk });
  }

  // The loader of a `next/dynamic` entry lives in an initial chunk and fetches exactly the manifest's files; those
  // files are initial. Every other loader is a lazy boundary.
  const initial = [...html];
  for (const file of dynamicFiles) if (!initial.includes(file)) initial.push(file);
  const initialSet = new Set(initial);
  const missing = initial.filter((file) => !sources.has(file));
  const lazy = [];
  for (const loader of [...loaders.values()].sort((a, b) => a.id - b.id)) {
    const sameAsDynamic =
      loader.files.length === dynamicFiles.length && loader.files.every((file) => dynamicFiles.includes(file));
    if (sameAsDynamic) continue;
    const files = loader.files.filter((file) => file.endsWith('.js') && !initialSet.has(file));
    if (files.length === 0) continue;
    lazy.push({ id: loader.id, target: loader.target, definedIn: loader.definedIn, files });
  }
  const size = (file) => (sources.has(file) ? gzip9(sources.get(file)) : 0);
  const sizes = new Map([...sources.keys()].map((file) => [file, size(file)]));
  return {
    html,
    dynamic: dynamicFiles,
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
