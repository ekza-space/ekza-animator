// Bundles the server (MCP-SPEC §5.22.1): entry src/cli.ts → dist/cli.mjs (ESM, `#!/usr/bin/env node`, Node 22 target,
// source map) with the workspace packages and every third-party runtime dependency inlined; only the optional
// `gltf-validator` stays external (and `ws`'s optional native add-ons are left out). Copies the bundled Polybot (CC0)
// from fixtures/ (never duplicated in git, ADR 0012). D0 inlines dynamic imports into one file; P6 splits the
// `--http` chunk into dist/http.mjs and generates THIRD_PARTY_NOTICES.md from the module graph.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

mkdirSync(`${root}samples`, { recursive: true });
copyFileSync(`${root}../../fixtures/models/polybot.vrm`, `${root}samples/polybot.vrm`);
