// `@ekza-studio/mesh-wasm` (MODELING-PLAN §3.1, §7.2 G-a; ADR 0014, ADR 0017 decision 5): the lazy WASM adapters of
// the mesh kernel — today the meshoptimizer Decimator and the AI intake chain built on it (normalize, reduce,
// quadrangulate, palette bake) plus the texture downsample. A LAZY package: the editor runs it in the intake worker
// (`@ekza-studio/mesh-wasm/worker`) or, in hosts without workers (Node tests), through a dynamic import; no route's
// initial scripts may contain it (`check:size`, boundary `mesh-wasm`).
export { quadrangulateMesh, runIntakeJob, transferablesOf } from './chain';
export { linearToOklab, linearToSrgb8, oklabToLinear, SRGB_TO_LINEAR } from './colour';
export {
  ALPHA_MIN,
  downsample,
  fittedSize,
  sampleLinear,
  sampleNearest,
  WRAP_CLAMP,
  WRAP_MIRROR,
  WRAP_REPEAT,
} from './image';
export { buildTriangleMesh, cloneMeshData, cornerFaces, smoothPointNormals, triangleCount } from './meshdata';
export { axesProblem, frameRotation, normalizeMeshes, transformMesh } from './normalize';
export { kmeans, MAX_KMEANS_ITERATIONS, paletteBake, samplePattern } from './palette';
export { MAX_SEARCH_RUNS, reduceMesh, splitBudget } from './reduce';
export { loadSimplifier, MESH_WASM_MARKER, MESHOPTIMIZER_VERSION, type Simplifier } from './simplifier';
export type * from './types';
export type { IntakeWorkerRequest, IntakeWorkerResponse } from './worker';
export { type Coverage, type CoverageInput, uvCoverage } from './coverage';
