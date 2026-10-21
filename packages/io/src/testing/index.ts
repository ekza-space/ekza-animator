// '@ekza-studio/io/testing' (Node; WP-0b, then WP-4): three.js loading in Node for parity and read-back tests,
// synthetic GLB builders and a naive FK pose source for bake tests.
export { GltfBuilder, type HostileKind, makeBudgetStressGlb, makeGlb, makeHostileGlb } from './glb';
export { loadGltfInNode, type NodeGltf, withNodeImageStub } from './loadGltf';
export { type GltfNodesJson, readGlbJson, skeletonNodeOrder } from './nodeOrder';
export { createFkPoseSource, type FkPoseSourceOptions } from './poseSource';
