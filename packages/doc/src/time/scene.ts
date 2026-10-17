// WP-2 stubs: final signatures (MVP-SPEC §7 WP-2, §4.11.8); bodies throw until scene time lands.
import { EkzaError, type Fps, type Frame } from '@ekza-animator/anim-core';
import type { ClipRecord } from '../records';

export function sceneToClipFrame(
  _sceneFps: Fps,
  _clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  _sceneFrame: Frame,
): Frame {
  throw new EkzaError('not-implemented', 'doc.sceneToClipFrame');
}

export function clipToSceneFrame(
  _sceneFps: Fps,
  _clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
  _clipFrame: Frame,
): Frame {
  throw new EkzaError('not-implemented', 'doc.clipToSceneFrame');
}

export function wrapClipFrame(_clip: Pick<ClipRecord, 'range' | 'loop'>, _clipFrame: Frame): Frame {
  throw new EkzaError('not-implemented', 'doc.wrapClipFrame');
}
