// The camera layers the mesh views draw on (M6A-SPEC §4.7): the surface on the shipped mesh layer, components,
// normals, Mesh Check markers and helpers on the four layers §4.7 adds to `LAYER` (B9 owns `layers.ts`; these values
// are the contract's, so a `LAYER.meshComponents` … `LAYER.helpers` landing there must equal them).
import type { MeshViewLayers } from '@ekza-studio/mesh-view';
import { LAYER } from '../layers';

export const MESH_LAYERS: MeshViewLayers = Object.freeze({
  surface: LAYER.mesh,
  components: 6,
  normals: 7,
  lint: 8,
  helpers: 9,
});
