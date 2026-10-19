// `@ekza-animator/mesh-view` (M6A-SPEC §4.4): edit-mode overlays, static mesh surfaces and component picking — a LAZY
// chunk that `viewport/src/mesh/**` imports dynamically (with three-mesh-bvh). This entry module references
// `VIEW_MARKER`, the `check-size` marker of the `mesh-view` boundary (§2), so eager code that pulls mesh-view in fails
// the size gate.
export type * from './types';
export { ComponentPicker, PICK_RADIUS, type PickOccluder, type PickOptionsInput } from './ComponentPicker';
export { EditMeshView, emptySelection, NGON_CODES } from './EditMeshView';
export { MeshSurface } from './MeshSurface';
export { mirroredOf, partnerOf } from './mirror';
export { MESH_VIEW_STYLE } from './style';
export {
  DEFAULT_MESH_VIEW_THEME,
  MESH_VIEW_SOFT_TOKENS,
  MESH_VIEW_TOKENS,
  type MeshViewThemeInput,
  parseHexColour,
  readMeshViewTheme,
} from './theme';

/** `check-size` marker of the mesh-view chunk (§2); referenced by every mesh-view entry module. */
export const VIEW_MARKER = 'ekza-mesh-view' as const;
