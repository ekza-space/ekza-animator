// The loop flag of a clip the editor wrote (M6b acceptance fix M6B-AF-10), read by the lazy import pipelines only.
import type { GlbContainer } from '@ekza-studio/io';
import { ekzaClipEntry } from './provenance';
import { isRecord } from './util';

/**
 * The loop flag the editor recorded for glTF animation `index` in a file it wrote, or null: the exported animation is
 * named by its slot ("walk"), so the `/loop/i` name rule alone loses a looping clip's flag on a round trip.
 */
export function embeddedEkzaLoop(container: GlbContainer, index: number): boolean | null {
  const clip = ekzaClipEntry(container, index);
  return isRecord(clip) && typeof clip['loop'] === 'boolean' ? clip['loop'] : null;
}
