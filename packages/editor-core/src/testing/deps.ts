// The kernel's dependency bindings for the fake app: naive store, curve engine, rig program and stand-ins (see
// `naive.ts`). Runtimes come from a given SkeletonDesc instead of model files.
import type { AssetId } from '@ekza-animator/doc';
import type { GlbContainer } from '@ekza-animator/io';
import type { SkeletonDesc } from '@ekza-animator/rig';
import type { KernelDeps } from '../app/deps';
import { naiveCycleAwareCurveEngine } from './curves';
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
    // The naive engine with the editor's option (M2A-SPEC §5.23: cycle-aware auto tangents on cyclic curves).
    curves: { engine: naiveCycleAwareCurveEngine, insertKeyPreservingShape: naiveInsertKeyPreservingShape },
    rig: {
      readRigDefinition: naiveReadRigDefinition,
      compileRig: (def, skel) => createNaiveRigProgram(skel, def.rig, def.controls),
      createCurveCache: (store, engine) => createNaiveCurveCache(store, engine),
      createClipSampler: createNaiveClipSampler,
      applyOverrides: naiveApplyOverrides,
    },
    loadModel: (character) =>
      skeleton === null || character.asset === null
        ? null
        : { container: placeholderContainer(character.asset), skeleton },
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
