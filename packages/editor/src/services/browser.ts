// WP-8 stub: final signature (MVP-SPEC §7 WP-8); throws until the browser services land.
import { EkzaError } from '@ekza-animator/anim-core';
import type { EditorServices } from '@ekza-animator/editor-core';

export function createBrowserServices(_opts: {
  readonly decoderPath: string;
  readonly createValidatorWorker?: () => Worker;
}): EditorServices {
  throw new EkzaError('not-implemented', 'editor.createBrowserServices');
}
