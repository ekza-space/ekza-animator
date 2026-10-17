// The kernel's seam to its sibling packages. `createEditorApp` binds the real implementations (doc, anim-core,
// rig, io); the shared test kit binds naive stand-ins (`@ekza-animator/editor-core/testing`), so panels and kernel
// tests run against the same kernel code whatever state the sibling packages are in. Nothing here is public API.
import {
  type AnimCurve,
  type CurveEngine,
  curveEngine,
  type Fps,
  type Frame,
  insertKeyPreservingShape,
  type KeyData,
} from '@ekza-animator/anim-core';
import {
  type CharacterRecord,
  type ChannelValues,
  type ClipId,
  type ClipRecord,
  type ControlId,
  clipToSceneFrame,
  createMemoryStore,
  type DocumentStore,
  type ReadView,
  type RigId,
  sceneToClipFrame,
  wrapClipFrame,
} from '@ekza-animator/doc';
import { type GlbContainer, parseGlb, skeletonFromGltf } from '@ekza-animator/io';
import {
  applyOverrides,
  type ChannelBuffer,
  type ClipSampler,
  type CurveCache,
  compileRig,
  createClipSampler,
  createCurveCache,
  type RigDefinition,
  type RigProgram,
  readRigDefinition,
  type SkeletonDesc,
} from '@ekza-animator/rig';
import type { AssetStore } from '../types';

/** What a character runtime is built from: the parsed model container and its skeleton. */
export interface ModelSource {
  readonly container: GlbContainer;
  readonly skeleton: SkeletonDesc;
}

export interface KernelDeps {
  /** The store used when the host passes none. */
  createStore(): DocumentStore;
  /** Scene clock mapping (§4.11.8). */
  readonly time: {
    sceneToClipFrame(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, sceneFrame: Frame): Frame;
    clipToSceneFrame(sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, clipFrame: Frame): Frame;
    wrapClipFrame(clip: Pick<ClipRecord, 'range' | 'loop'>, clipFrame: Frame): Frame;
  };
  readonly curves: {
    /** Compiles and evaluates curves for the evaluation service and the edit kernel. */
    readonly engine: CurveEngine;
    /** §4.11.4 shape-preserving insert. */
    insertKeyPreservingShape(
      curve: AnimCurve,
      frame: Frame,
    ): { readonly keys: KeyData[]; readonly index: number; readonly frozen: readonly number[] };
  };
  readonly rig: {
    readRigDefinition(view: ReadView, rig: RigId): RigDefinition | undefined;
    compileRig(def: RigDefinition, skeleton: SkeletonDesc): RigProgram;
    createCurveCache(store: DocumentStore, engine: CurveEngine): CurveCache;
    createClipSampler(store: DocumentStore, cache: CurveCache, clip: ClipId, program: RigProgram): ClipSampler;
    applyOverrides(program: RigProgram, ch: ChannelBuffer, overrides: ReadonlyMap<ControlId, ChannelValues>): void;
  };
  /**
   * Parses the model a character was imported from. A promise for real files (the asset store is async); a value
   * when the source is known synchronously (tests); `null` when the character gets no runtime.
   */
  loadModel(character: CharacterRecord, assets: AssetStore): Promise<ModelSource> | ModelSource | null;
}

/** The production bindings: every function comes from its owning package. */
export const DEFAULT_DEPS: KernelDeps = {
  createStore: () => createMemoryStore(),
  time: { sceneToClipFrame, clipToSceneFrame, wrapClipFrame },
  curves: { engine: curveEngine, insertKeyPreservingShape },
  rig: { readRigDefinition, compileRig, createCurveCache, createClipSampler, applyOverrides },
  async loadModel(character: CharacterRecord, assets: AssetStore): Promise<ModelSource> {
    const bytes = await assets.get(character.asset);
    const container = await parseGlb(bytes);
    return { container, skeleton: skeletonFromGltf(container) };
  },
};
