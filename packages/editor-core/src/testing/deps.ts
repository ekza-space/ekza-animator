// The kernel's dependency bindings for the fake app: naive store, curve engine, rig program and stand-ins (see
// `naive.ts`). Runtimes come from a given SkeletonDesc instead of model files.
import type { AssetId } from '@ekza-animator/doc';
import type { GlbContainer } from '@ekza-animator/io';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { KernelDeps } from '../app/deps';
import { naiveCurveEngine } from './curves';
import {
  createNaiveClipSampler,
  createNaiveCurveCache,
  naiveApplyOverrides,
  naiveClipToSceneFrame,
  naiveInsertKeyPreservingShape,
  naiveReadRigDefinition,
  naiveSceneToClipFrame,
  naiveWrapClipFrame,
} from './naive';
import { createNaiveRigProgram } from './rig';
import { createNaiveStore } from './store/naiveStore';

/** Naive bindings; every character gets a runtime over `skeleton` (none when null), available synchronously. */
export function naiveKernelDeps(skeleton: SkeletonDesc | null): KernelDeps {
  return {
    createStore: () => createNaiveStore(),
    time: {
      sceneToClipFrame: naiveSceneToClipFrame,
      clipToSceneFrame: naiveClipToSceneFrame,
      wrapClipFrame: naiveWrapClipFrame,
    },
    curves: { engine: naiveCurveEngine, insertKeyPreservingShape: naiveInsertKeyPreservingShape },
    rig: {
      readRigDefinition: naiveReadRigDefinition,
      compileRig: (def, skel) => createNaiveRigProgram(skel, def.rig, def.controls),
      createCurveCache: (store) => createNaiveCurveCache(store),
      createClipSampler: createNaiveClipSampler,
      applyOverrides: naiveApplyOverrides,
    },
    loadModel: (character) =>
      skeleton === null ? null : { container: placeholderContainer(character.asset), skeleton },
  };
}

/** The fake app has no model bytes: an empty container that names the asset. */
export function placeholderContainer(asset: AssetId): GlbContainer {
  return {
    bytes: new Uint8Array(0),
    json: { asset: { version: '2.0', generator: 'ekza-animator test kit (no model)' } },
    jsonByteLength: 0,
    bin: null,
    sha256: asset,
  };
}
