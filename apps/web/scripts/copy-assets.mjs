#!/usr/bin/env node
// Copies the bundled sample models from fixtures/ into public/samples/ and three.js's self-hosted decoders into
// public/decoders/ (ADR 0012, ARCHITECTURE §16: no third-party CDN). Both outputs are git-ignored.
//
// Layout of public/decoders/ mirrors three's examples/jsm/libs/:
//   draco/gltf/        DRACOLoader.setDecoderPath(`${decoderPath}draco/gltf/`)
//   basis/             KTX2Loader.setTranscoderPath(`${decoderPath}basis/`)
//   meshopt_decoder.module.js

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(appDir, '../..');
const publicDir = join(appDir, 'public');

/** SampleId (editor-core OperatorMap `file.loadSample`) and Auto-Rig's static samples (`autorig.sample`, AUTORIG-SPEC
 *  §4.5, §5.2: the M6b C0 fixtures, fetched from `/samples/`) → fixture path. */
const SAMPLES = {
  'seed-san.vrm': 'fixtures/models/seed-san.vrm',
  'polybot.vrm': 'fixtures/models/polybot.vrm',
  'quaternius-ual.glb': 'fixtures/animations/quaternius-ual.glb',
  'cube-lad.glb': 'fixtures/models/cube-lad.glb',
  'polybot-unskinned-tpose.glb': 'fixtures/models/polybot-unskinned-tpose.glb',
  'polybot-unskinned.glb': 'fixtures/models/polybot-unskinned.glb',
};

const DECODERS = ['draco/gltf', 'basis', 'meshopt_decoder.module.js'];

function copySamples() {
  const target = join(publicDir, 'samples');
  mkdirSync(target, { recursive: true });
  for (const [name, source] of Object.entries(SAMPLES)) {
    const from = join(repoDir, source);
    if (!existsSync(from)) throw new Error(`copy-assets: missing fixture ${source}`);
    const to = join(target, name);
    // Skip unchanged files: Seed-san alone is 10.9 MB.
    if (existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs) {
      continue;
    }
    cpSync(from, to);
  }
}

function copyDecoders() {
  const require = createRequire(join(appDir, 'package.json'));
  const libsDir = dirname(require.resolve('three/examples/jsm/libs/meshopt_decoder.module.js'));
  const target = join(publicDir, 'decoders');
  rmSync(target, { recursive: true, force: true });
  for (const entry of DECODERS) {
    const from = join(libsDir, entry);
    if (!existsSync(from)) throw new Error(`copy-assets: three.js decoder not found: ${from}`);
    cpSync(from, join(target, entry), { recursive: true });
  }
}

copySamples();
copyDecoders();
console.log(`copy-assets: ${Object.keys(SAMPLES).length} samples and ${DECODERS.length} decoder entries in public/`);
