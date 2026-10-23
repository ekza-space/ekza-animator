// `readSample` for Node (MCP-SPEC §4.6, §5.17.2, §0.4.4): the bundled samples (Polybot and the two unskinned Polybot
// GLBs, CC0, and the Cube Lad, MIT, in the package's `samples/`), answered by `SampleDef.file`; the others from
// `--samples-dir` (either `<dir>/<file>` or the repository layout `<dir>/models/<file>`, `<dir>/animations/<file>`).
// No network: a sample that is neither bundled nor in the samples folder is `asset-missing` with a hint.
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EkzaError } from '@ekza-studio/anim-core';

/** Files the package bundles (scripts/build.mjs copies them from fixtures/models). */
export const BUNDLED_SAMPLES = [
  'polybot.vrm',
  'polybot-unskinned.glb',
  'polybot-unskinned-tpose.glb',
  'cube-lad.glb',
] as const;

/** Where the bundled samples are: `<package>/samples` next to `dist/` (built) or `src/` (sources), then fixtures/. */
function bundledDirs(): string[] {
  const here = import.meta.url;
  return [
    fileURLToPath(new URL('../samples/', here)), // dist/cli.mjs → samples/
    fileURLToPath(new URL('../../samples/', here)), // src/files/samples.ts → samples/
    fileURLToPath(new URL('../../../../fixtures/models/', here)), // the repository (tests before a build)
  ];
}

async function firstReadable(paths: readonly string[]): Promise<Uint8Array | null> {
  for (const path of paths) {
    try {
      return new Uint8Array(await fsp.readFile(path));
    } catch {
      // next candidate
    }
  }
  return null;
}

/** A reader of sample files by name (`{file}` of a `SampleDef`, or an Auto-Rig static sample's file). */
export function createSampleReader(opts: {
  readonly samplesDir: string | null;
}): (sample: { readonly file: string }) => Promise<Uint8Array> {
  return async (sample) => {
    const file = sample.file;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(file) || file.startsWith('.')) {
      throw new EkzaError('asset-missing', 'Unknown sample file');
    }
    const candidates: string[] = [];
    if ((BUNDLED_SAMPLES as readonly string[]).includes(file)) {
      for (const dir of bundledDirs()) candidates.push(join(dir, file));
    }
    if (opts.samplesDir !== null) {
      for (const sub of ['', 'models', 'animations']) candidates.push(join(opts.samplesDir, sub, file));
    }
    const bytes = await firstReadable(candidates);
    if (bytes !== null) return bytes;
    throw new EkzaError(
      'asset-missing',
      `The sample ${file} is not bundled with ekza-studio-mcp; pass --samples-dir or open a file`,
    );
  };
}
