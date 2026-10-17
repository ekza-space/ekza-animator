// WP-3 stubs: final signatures (MVP-SPEC §7 WP-3); bodies throw until the curve cache and sampler land.
import { type CompiledAnimCurve, type CurveEngine, EkzaError } from '@ekza-animator/anim-core';
import type { ClipId, CurveId, DocumentStore } from '@ekza-animator/doc';
import type { ClipSampler, RigProgram } from '../types';

export interface CurveCache {
  get(curve: CurveId): CompiledAnimCurve;
  readonly version: number;
  dispose(): void;
}

/** Invalidates on batches incl. preview. */
export function createCurveCache(_store: DocumentStore, _engine?: CurveEngine): CurveCache {
  throw new EkzaError('not-implemented', 'rig.createCurveCache');
}

export function createClipSampler(
  _store: DocumentStore,
  _cache: CurveCache,
  _clip: ClipId,
  _program: RigProgram,
): ClipSampler {
  throw new EkzaError('not-implemented', 'rig.createClipSampler');
}
