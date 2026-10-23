// `readSample` for Node (MCP-SPEC §4.6, §5.17.2): the bundled Polybot, `--samples-dir` for the others. D0 stub; P6
// implements.
import { EkzaError } from '@ekza-studio/anim-core';
import type { SampleDef } from '@ekza-studio/editor-core';

export function createSampleReader(_opts: {
  readonly samplesDir: string | null;
}): (sample: SampleDef) => Promise<Uint8Array> {
  throw new EkzaError('not-implemented', 'ekza-studio-mcp.createSampleReader');
}
