#!/usr/bin/env node
// Generates fixtures/animations/quaternius-idle-meshopt.glb from fixtures/animations/quaternius-ual.glb (MVP-SPEC §7
// WP-4): the Universal Animation Library reduced to its `Idle_Loop` clip, then compressed with glTF Transform's
// `meshopt()` (reorder + quantize + EXT_meshopt_compression, level "medium") using meshoptimizer. Every bufferView,
// including the mesh attributes and the animation data, ends up meshopt-compressed, so the file exercises the
// three.js loader's decoder path and the headless reader's `compressed-animation` rejection. The source is CC0 1.0;
// so is this derived file (fixtures/LICENSES.md).
//
// The output is byte-for-byte deterministic for the pinned glTF Transform and meshoptimizer versions.
//
// Usage: node tooling/make-compressed-fixture.mjs [--out <file>] [--check]
//   --out <file>  write somewhere else (default: fixtures/animations/quaternius-idle-meshopt.glb)
//   --check       write nothing; exit 1 when the file on disk differs from what this script generates

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const SOURCE = join(ROOT, 'fixtures', 'animations', 'quaternius-ual.glb');
export const TARGET = join(ROOT, 'fixtures', 'animations', 'quaternius-idle-meshopt.glb');
export const KEEP_ANIMATION = 'Idle_Loop';

/** Builds the compressed fixture bytes from the source GLB bytes. */
export async function buildCompressedFixture(sourceBytes) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(sourceBytes);
  doc.setLogger({ debug() {}, info() {}, warn() {}, error: console.error });
  const animations = doc.getRoot().listAnimations();
  if (!animations.some((animation) => animation.getName() === KEEP_ANIMATION)) {
    throw new Error(`make-compressed-fixture: the source has no animation named ${KEEP_ANIMATION}`);
  }
  // Disposing an animation leaves its channels and samplers (and so their accessors) in the graph: dispose them too.
  for (const animation of animations) {
    if (animation.getName() === KEEP_ANIMATION) continue;
    for (const channel of animation.listChannels()) channel.dispose();
    for (const sampler of animation.listSamplers()) sampler.dispose();
    animation.dispose();
  }
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return io.writeBinary(doc);
}

async function main(argv) {
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? TARGET : resolve(argv[outIndex + 1] ?? '');
  const bytes = await buildCompressedFixture(readFileSync(SOURCE));
  if (argv.includes('--check')) {
    const same = existsSync(out) && Buffer.compare(readFileSync(out), Buffer.from(bytes)) === 0;
    if (!same) console.error(`make-compressed-fixture: ${out} is stale; run node tooling/make-compressed-fixture.mjs`);
    return same ? 0 : 1;
  }
  writeFileSync(out, bytes);
  console.log(`make-compressed-fixture: wrote ${out} (${bytes.byteLength} bytes)`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
