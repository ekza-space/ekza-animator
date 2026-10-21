// mesh-core skin (M6B-SPEC §4.2): the skin value objects (C0 baselines), the solvers' inputs, the sparse kit (C4), bind
// (C4) and the weight edits (C5/C6). One line per module; each owner changes only its own lines (§3 rule 2).
export * from './types';
export { readSkin, readSkinReview, SKIN_REVIEW_LAYER, withSkin } from './layers';
// C4
export { skinGeometryOf } from './geometry';
export { cotLaplacian, lumpedMass } from './laplacian';
export { autoWeightPoints, bindSkin } from './bind';
// C6 (with the C5 MVP subset)
export { editWeights, skinDirty } from './edit';
export { beginStroke } from './stroke';
export { mirrorWeights } from './mirror';
export { checkSkin } from './check';
// C5 (deferred after the MVP)
export { transferWeights } from './transfer';
export { fillMissingWeights } from './inpaint';
export { foldJoints } from './fold';
