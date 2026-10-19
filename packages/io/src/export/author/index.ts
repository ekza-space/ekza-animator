// The author GLB writer for static models (M6A-SPEC §4.5, §5.19, §5.22): B0a stub in the lazy `io/write` entry;
// B8 owns this directory.
import { EkzaError } from '@ekza-animator/anim-core';
import type { StaticScene } from '../../types';

export function writeStaticGlb(_scene: StaticScene, _opts: { readonly generator: string }): Promise<Uint8Array> {
  return Promise.reject(new EkzaError('not-implemented', 'io.writeStaticGlb'));
}
