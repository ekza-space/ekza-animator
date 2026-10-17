// three.js camera layers that implement the per-pane display flags (ADR 0006 §9). Objects of the main scene sit on
// one layer each; a pane enables the layers its DisplayFlags show.
import type { Camera } from 'three';
import type { DisplayFlags } from './types';

export const LAYER = {
  /** Lights and anything every pane must see. */
  always: 0,
  mesh: 1,
  grid: 2,
  skeleton: 3,
  /** Control lines, pass A (occluded part, `GreaterDepth`). */
  controlsOccluded: 4,
  /** Control lines, pass B (visible part). */
  controlsVisible: 5,
} as const;

/** Enables the main-scene layers a pane shows. */
export function applyMainLayers(camera: Camera, display: DisplayFlags): void {
  camera.layers.set(LAYER.always);
  if (display.mesh) camera.layers.enable(LAYER.mesh);
  if (display.grid) camera.layers.enable(LAYER.grid);
  if (display.skeleton) camera.layers.enable(LAYER.skeleton);
}
