// '@ekza-studio/io/testing' (Node; WP-0b, then WP-4): three.js loading in Node for parity and read-back tests,
// synthetic GLB builders and a naive FK pose source for bake tests.
// M7 G-a (MODELING-PLAN §7.3): the procedural AI-like model of the intake acceptance (no network, no third-party asset).
export { AI_LIKE_TEMPLATE_TRIANGLES, type AiLikeModelOptions, makeAiLikeGlb } from './aiModel';
export { GltfBuilder, type HostileKind, makeBudgetStressGlb, makeGlb, makeHostileGlb } from './glb';
export { loadGltfInNode, type NodeGltf, withNodeImageStub } from './loadGltf';
export { type GltfNodesJson, readGlbJson, skeletonNodeOrder } from './nodeOrder';
export { createFkPoseSource, type FkPoseSourceOptions } from './poseSource';
