// `@ekza-studio/mesh-core` (M6A-SPEC §4.3): the mesh kernel's public API — a LAZY chunk. The editor loads it with a
// dynamic `import()` (MeshRuntimeRegistry, io/mesh, viewport/src/mesh/**); the eager route reads only
// `@ekza-studio/mesh-core/descriptors`. B0a wrote this barrel with the reference kernel and stub lines; each owner
// changes only the lines of its own symbols (§3 rule 2): B1 the kernel lines (core, revision, derived data,
// primitives), B2 select/soft/symmetry, B3 regionFrame, B4 copySubset/appendMesh, B5 checkMesh, B13 humanoidBody.
export * from './descriptors';
export { BitSet } from './bitset';
export { KERNEL_MARKER } from './kernel';
export { isRefusal, refuse } from './refusal';
export { MESH_OPS, MESH_SET_OPS } from './registry';
export { selectionOf } from './selection';
// ---------- B1 ----------
export { setKernelDebug } from './core/debug';
export { editMeshFrom, emptyMesh } from './core/edit';
export { BUILTIN_LAYERS, groupLayer, morphLayer } from './layers/builtin';
export { computeNormals, resolveSmoothingAngle } from './normals/normals';
export { primitive } from './primitives/primitives';
export { manifestChunkIds, parseManifest, readRevision, writeRevision } from './revision/revision';
export { topologyStats } from './validate/stats';
export { triangulate } from './triangulate/triangulate';
export { validateMesh } from './validate/validate';
// ---------- B2 ----------
export { loopGesture } from './select/gesture';
export { edgeLoop, edgeRing, faceLoop, partialLoop, vertexLoop } from './select/loops';
export { convertSelection, growSelection, shrinkSelection } from './select/region';
export { softWeights } from './soft/weights';
export { expandSelection } from './symmetry/expand';
export { buildSymmetryMap } from './symmetry/map';
export { mirrorEdgePoint } from './symmetry/pointer';
// ---------- B3 ----------
export { regionFrame } from './ops/extrude/frame';
// B12b (the extrude session's frame on border edges, the kernel's own chain frame; B3's edges.ts)
export { borderChainFrame } from './ops/extrude/edges';
// B12b (the extrude session's frame under symmetry: the group the kernel moves, a partner's source frame and S)
export { type ExtrudeGroupFrame, type ExtrudeMirror, extrudeGroupFrame } from './ops/extrude/sessionFrame';
// ---------- B4 ----------
export { appendMesh, copySubset } from './subset';
// ---------- B5 ----------
export { checkMesh } from './check';
// ---------- B13 ----------
export { humanoidBody } from './templates';
