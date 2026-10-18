// The kernel's seam to its sibling packages. `createEditorApp` binds the real implementations (doc, anim-core,
// rig, io); the shared test kit binds naive stand-ins (`@ekza-animator/editor-core/testing`), so panels and kernel
// tests run against the same kernel code whatever state the sibling packages are in. Nothing here is public API.
import {
  type AnimCurve,
  compileAnimCurve,
  type CurveEngine,
  curveEngine,
  type Disposer,
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
  registerBuiltinRigOps,
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
  readonly createStore: () => DocumentStore;
  /** Scene clock mapping (§4.11.8). */
  readonly time: {
    readonly sceneToClipFrame: (
      sceneFps: Fps,
      clip: Pick<ClipRecord, 'fps' | 'sceneStart'>,
      sceneFrame: Frame,
    ) => Frame;
    readonly clipToSceneFrame: (sceneFps: Fps, clip: Pick<ClipRecord, 'fps' | 'sceneStart'>, clipFrame: Frame) => Frame;
    readonly wrapClipFrame: (clip: Pick<ClipRecord, 'range' | 'loop'>, clipFrame: Frame) => Frame;
  };
  readonly curves: {
    /** Compiles and evaluates curves for the evaluation service and the edit kernel. */
    readonly engine: CurveEngine;
    /** §4.11.4 shape-preserving insert. */
    readonly insertKeyPreservingShape: (
      curve: AnimCurve,
      frame: Frame,
    ) => { readonly keys: KeyData[]; readonly index: number; readonly frozen: readonly number[] };
  };
  readonly rig: {
    /** Registers the built-in rig ops (M2a `solver:ik2`) for the app's lifetime; absent for the naive kit. */
    readonly registerBuiltinRigOps?: () => Disposer;
    readonly readRigDefinition: (view: ReadView, rig: RigId) => RigDefinition | undefined;
    readonly compileRig: (def: RigDefinition, skeleton: SkeletonDesc) => RigProgram;
    readonly createCurveCache: (store: DocumentStore, engine: CurveEngine) => CurveCache;
    readonly createClipSampler: (
      store: DocumentStore,
      cache: CurveCache,
      clip: ClipId,
      program: RigProgram,
    ) => ClipSampler;
    readonly applyOverrides: (
      program: RigProgram,
      ch: ChannelBuffer,
      overrides: ReadonlyMap<ControlId, ChannelValues>,
    ) => void;
  };
  /**
   * Parses the model a character was imported from. A promise for real files (the asset store is async); a value
   * when the source is known synchronously (tests); `null` when the character gets no runtime.
   */
  readonly loadModel: (character: CharacterRecord, assets: AssetStore) => Promise<ModelSource> | ModelSource | null;
}

/**
 * The anim-core curve options of every editor-side computation on curves (M2A-SPEC §5.23): compile, the
 * shape-preserving insert and Simplify's reduction (`reduceKeys`), so drawn, evaluated, inserted and simplified shapes
 * are the same shape.
 */
export const EDITOR_CURVE_OPTIONS = { cycleAwareAuto: true } as const;

/**
 * The editor's curve engine (M2A-SPEC §5.23, FR-GE-17): anim-core's AnimX engine with cycle-aware auto tangents.
 * The engine applies the option only to curves whose pre and post infinities both cycle (`cycle`/`cycleOffset`), so
 * curves with a constant infinity — every curve M1 created — compile exactly as with `curveEngine`. The kernel hands
 * this engine to the rig's curve cache, which evaluation, the Graph Editor painters, handle resolution, Plant Feet
 * and the export bake share, so drawn, evaluated and exported curves agree. anim-core's `curveEngine` and the rig's
 * default cache engine stay non-cycle-aware.
 */
export const EDITOR_CURVE_ENGINE: CurveEngine = {
  compile: (curve) => compileAnimCurve(curve, EDITOR_CURVE_OPTIONS),
  evaluate: (curve, frame) => curveEngine.evaluate(curve, frame),
};

/** The production bindings: every function comes from its owning package. */
export const DEFAULT_DEPS: KernelDeps = {
  createStore: () => createMemoryStore(),
  time: { sceneToClipFrame, clipToSceneFrame, wrapClipFrame },
  curves: {
    engine: EDITOR_CURVE_ENGINE,
    // The insert preserves the shape the editor's engine evaluates (cycle-aware tangents on cyclic curves).
    insertKeyPreservingShape: (curve, frame) => insertKeyPreservingShape(curve, frame, EDITOR_CURVE_OPTIONS),
  },
  rig: {
    registerBuiltinRigOps,
    readRigDefinition,
    compileRig,
    createCurveCache,
    createClipSampler,
    applyOverrides,
  },
  loadModel: async (character: CharacterRecord, assets: AssetStore): Promise<ModelSource> => {
    const bytes = await assets.get(character.asset);
    const container = await parseGlb(bytes);
    return { container, skeleton: skeletonFromGltf(container) };
  },
};
