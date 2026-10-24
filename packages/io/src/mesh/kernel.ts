// The kernel values io uses (M6A-SPEC §2, §4.5): only the lazy entries `io/mesh` and `io/write` reach this module,
// and both are lazy chunks of the editor, so the kernel never enters the eager route through io (the `mesh-kernel`
// size boundary checks that). Every other io module imports mesh-core types only.
// oxlint-disable-next-line no-restricted-imports -- io/mesh is the lazy mesh entry that imports the kernel (§4.5)
export {
  BUILTIN_LAYERS,
  checkMesh,
  computeNormals,
  EDGE_HARD,
  // M7 G-a: the AI-like test model of `io/testing` (aiModel.ts) is built on the template.
  humanoidBody,
  morphLayer,
  triangulate,
} from '@ekza-studio/mesh-core';
