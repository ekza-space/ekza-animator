// `@ekza-studio/io/mesh` (M6A-SPEC §4.5, §2): the lazy mesh entry of io — make editable, `meshToPrimitives` and the
// palette PNG writer. It imports the mesh-core kernel; the io main entry gains types only, so the eager route never
// pulls mesh-core through io. `@ekza-studio/io/write` re-exports this API for editor-core, whose import rules allow
// the write path but not this entry (M6A-B8 notes).
export { srgb8ToLinear, srgbEotf } from './colour';
export { MAKE_EDITABLE_MAX_TRIANGLES, type MakeEditableResult, meshFacts, meshFromGltf } from './fromGltf';
export { editLicence } from './licence';
export { PALETTE_CELL_PX, PALETTE_MAX_SWATCHES, paletteGrid, writePaletteTexture } from './palette';
export {
  type DetailedPrimitive,
  type MeshToPrimitivesOptions,
  meshToPrimitives,
  meshToPrimitivesDetailed,
  TANGENT_REFUSAL,
  type TangentRefusal,
} from './toPrimitives';
export { lintMeshes, type MeshLintInput, type MeshLintOptions, triangleCount } from '../lint/meshes';
