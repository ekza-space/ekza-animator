// The kernel values io uses (M6A-SPEC §2, §4.5): only the lazy entries `io/mesh` and `io/write` reach this module,
// and both are lazy chunks of the editor, so the kernel never enters the eager route through io (the `mesh-kernel`
// size boundary checks that). Every other io module imports mesh-core types only.
// oxlint-disable-next-line no-restricted-imports -- io/mesh is the lazy mesh entry that imports the kernel (§4.5)
export { BUILTIN_LAYERS, computeNormals, EDGE_HARD, morphLayer, triangulate } from '@ekza-animator/mesh-core';
