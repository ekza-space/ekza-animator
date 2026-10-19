// three.js camera layers that implement the per-pane display flags (ADR 0006 §9). Objects of the main scene sit on
// one layer each; a pane enables the layers its DisplayFlags show.
import type { Camera } from 'three';
import type { DisplayFlags } from './types';

export const LAYER = {
  /** Lights and anything every pane must see. */
  always: 0,
  /** Character meshes and the mesh-view surfaces (B6). */
  mesh: 1,
  grid: 2,
  skeleton: 3,
  /** Control lines, pass A (occluded part, `GreaterDepth`). */
  controlsOccluded: 4,
  /** Control lines, pass B (visible part). */
  controlsVisible: 5,
  // M6a (M6A-SPEC §4.7): the mesh-view overlays and the helpers.
  /** Vertices, edges, face dots and tints of hilited meshes in component modes. */
  meshComponents: 6,
  /** Face and vertex normals. */
  meshNormals: 7,
  /** Mesh Check markers. */
  meshLint: 8,
  /** Symmetry plane, soft-selection ring, pivot handle, image planes (their ortho pane only), humanoid guides. */
  helpers: 9,
} as const;

/** Enables the main-scene layers a pane shows. */
export function applyMainLayers(camera: Camera, display: DisplayFlags): void {
  camera.layers.set(LAYER.always);
  if (display.mesh) {
    camera.layers.enable(LAYER.mesh);
    if (display.components) camera.layers.enable(LAYER.meshComponents);
    if (display.normals !== 'off') camera.layers.enable(LAYER.meshNormals);
    if (display.meshCheck) camera.layers.enable(LAYER.meshLint);
  }
  if (display.grid) camera.layers.enable(LAYER.grid);
  if (display.skeleton) camera.layers.enable(LAYER.skeleton);
  // Each helper hides itself by its own flag (symmetry plane, image planes) or state (soft ring, pivot handle).
  camera.layers.enable(LAYER.helpers);
}
