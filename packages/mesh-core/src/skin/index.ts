// mesh-core skin (M6B-SPEC §4.2): the skin value objects (C0 baselines), the solvers' inputs, the sparse kit (C4), bind
// (C4) and the weight edits (C5/C6). One line per module; each owner changes only its own lines (§3 rule 2).

export { applyHolds, autoWeightPoints, bindSkin, ISLAND_RULE } from './bind';
export { checkSkin } from './check';
// C6 (with the C5 MVP subset)
export { editWeights, skinDirty } from './edit';
export { foldJoints } from './fold';
// C4
export { pointGraph, pointNormals, pointTriangles, skinGeometryOf } from './geometry';
export { fillMissingWeights } from './inpaint';
export { type Islands, skinIslands } from './islands';
export { cotLaplacian, csrDiagonal, csrFromTriples, csrMultiply, csrSubmatrix, lumpedMass } from './laplacian';
export { readSkin, readSkinReview, SKIN_REVIEW_LAYER, withSkin } from './layers';
export { mirrorWeights } from './mirror';
export { HEAT_PCG, type PcgOptions, solvePcg } from './pcg';
export { beginStroke } from './stroke';
// C5 (deferred after the MVP)
export { transferWeights } from './transfer';
export * from './types';
