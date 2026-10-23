// Bundles the server (MCP-SPEC §5.22.1): entry src/cli.ts → dist/cli.mjs (ESM, `#!/usr/bin/env node`, Node 22 target,
// source map) with the workspace packages and every third-party runtime dependency inlined; only the optional
// `gltf-validator` stays external (and `ws`'s optional native add-ons are left out). Copies the bundled samples (CC0:
// Polybot and its two unskinned GLBs; MIT: the Cube Lad, 11 kB; MCP-SPEC §0.4.4) from fixtures/ (never duplicated in git, ADR 0012) and the clip
// library's starter pack (CC0, apps/web/public/library/animations) into library/animations/. The build
// fails when dist/ holds anything but the bin and its map (M-AI-MVP-13: a stray chunk would be published unreferenced,
// or referenced and missing from `files`) or when the bin imports a package at run time.
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const source = readFileSync(`${root}src/version.ts`, 'utf8');
if (!source.includes(`SERVER_VERSION = '${pkg.version}'`)) {
  throw new Error(`src/version.ts must state the package version ${pkg.version}`);
}

rmSync(dist, { recursive: true, force: true });
await build({
  input: { cli: `${root}src/cli.ts` },
  platform: 'node',
  external: ['gltf-validator', 'bufferutil', 'utf-8-validate', /^node:/],
  logLevel: 'warn',
  transform: { target: 'node22' },
  output: {
    dir: dist,
    format: 'esm',
    entryFileNames: '[name].mjs',
    sourcemap: true,
    banner: '#!/usr/bin/env node',
    codeSplitting: false,
  },
});
chmodSync(`${dist}/cli.mjs`, 0o755);

const emitted = readdirSync(dist).sort();
const expected = ['cli.mjs', 'cli.mjs.map'];
if (JSON.stringify(emitted) !== JSON.stringify(expected)) {
  throw new Error(`dist/ must hold only ${expected.join(', ')}; found ${emitted.join(', ')}`);
}
const bin = readFileSync(`${dist}/cli.mjs`, 'utf8');
const builtins = new Set(['module', 'fs', 'path', 'url', 'os', 'crypto', 'events', 'stream', 'util', 'worker_threads']);
for (const match of bin.matchAll(/^import\s[^;]*?from\s"([^"]+)";/gm)) {
  const specifier = match[1];
  if (!specifier.startsWith('node:') && !builtins.has(specifier)) {
    throw new Error(`dist/cli.mjs imports ${specifier} at run time: every runtime dependency must be bundled`);
  }
}

// the clip library's starter pack (library_list, library_use: served by the server's own fetch, src/files/library.ts)
rmSync(`${root}library`, { recursive: true, force: true });
mkdirSync(`${root}library/animations`, { recursive: true });
const library = `${root}../../apps/web/public/library/animations`;
for (const file of readdirSync(library)) copyFileSync(`${library}/${file}`, `${root}library/animations/${file}`);

mkdirSync(`${root}samples`, { recursive: true });
for (const file of ['polybot.vrm', 'polybot-unskinned.glb', 'polybot-unskinned-tpose.glb', 'cube-lad.glb']) {
  copyFileSync(`${root}../../fixtures/models/${file}`, `${root}samples/${file}`);
}
