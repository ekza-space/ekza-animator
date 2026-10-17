// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3, §4.11.6–7); bodies throw until clip import lands.
import { EkzaError, type Fps } from '@ekza-animator/anim-core';
import type {
  HumanoidClipData,
  ImportedClipKeys,
  ImportHumanoidOptions,
  ImportRawOptions,
  RawClip,
  RigProgram,
  SkeletonDesc,
} from '../types';

export function detectClipFps(_clip: RawClip | HumanoidClipData): Fps | null {
  throw new EkzaError('not-implemented', 'rig.detectClipFps');
}

export function importRawClip(_raw: RawClip, _program: RigProgram, _opts: ImportRawOptions): ImportedClipKeys {
  throw new EkzaError('not-implemented', 'rig.importRawClip');
}

export function importHumanoidClip(
  _data: HumanoidClipData,
  _program: RigProgram,
  _opts: ImportHumanoidOptions,
): ImportedClipKeys {
  throw new EkzaError('not-implemented', 'rig.importHumanoidClip');
}

export function remapRawClipByName(
  _raw: RawClip,
  _from: SkeletonDesc,
  _to: SkeletonDesc,
): { readonly clip: RawClip; readonly unmatched: readonly string[] } {
  throw new EkzaError('not-implemented', 'rig.remapRawClipByName');
}
