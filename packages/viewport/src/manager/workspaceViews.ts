// Per-workspace pane defaults (M6A-SPEC §4.6 DisplayFlags, §5.17, §8.2; B9). Pane display flags and camera bindings
// are remembered per workspace (`<workspace>:<paneId>`), so Model's `colours` shading and M-Side split never show in
// Animate's panes; the view cameras themselves (where a pane id looks from) stay shared, so switching keeps them.
import type { DisplayFlags, PaneCamera, ViewPreset } from '@ekza-studio/editor-core';
import { defaultPaneCamera } from '../panes/layout';

/** Animate's pane display: today's look (M6a fields at their Animate defaults). */
export const DEFAULT_DISPLAY: DisplayFlags = {
  mesh: true,
  skeleton: false,
  controls: true,
  grid: true,
  xray: false,
  hud: true,
  springBones: false,
  // M6a (M6A-SPEC §4.6): the Animate defaults (today's look); Model's are MODEL_DISPLAY.
  shading: 'lit',
  wireOnShaded: false,
  flat: false,
  cull: false,
  components: true,
  normals: 'off',
  faceOrientation: false,
  triangulation: false,
  hardEdges: false,
  polyCount: false,
  meshCheck: false,
  symmetryPlane: true,
  dimUnhilited: false,
  imagePlanes: true,
  // M6b (M6B-SPEC §4.6): Animate keeps today's look (the joints overlay is Rig & Skin's).
  joints: false,
  xrayJoints: false,
  jointAxes: 'none',
  jointLabels: 'none',
  weights: 'off',
  weightNumbers: false,
  lockRelative: false,
  constraintLines: false,
  shapeCvs: false,
};

/** Model's pane display (§4.6, research 16 U7): palette colours, wire on shaded, flat, hard edges, the poly count;
 *  rig controls are not shown (Model picks meshes and groups only). */
export const MODEL_DISPLAY: DisplayFlags = {
  ...DEFAULT_DISPLAY,
  controls: false,
  shading: 'colours',
  wireOnShaded: true,
  flat: true,
  hardEdges: true,
  polyCount: true,
};

const VIEW = (preset: ViewPreset): PaneCamera => ({ kind: 'view', preset });

/** Model's pane cameras: M-Single persp, M-Side `front | persp` (the split layout), M-Quad as the classic four view. */
const MODEL_CAMERAS: Readonly<Record<string, PaneCamera>> = {
  'pane-single': VIEW('persp'),
  'pane-left': VIEW('front'),
  'pane-right': VIEW('persp'),
};

/** Rig & Skin's pane display (M6B-SPEC §4.6, §8.3; C7): the joints overlay with x-ray, axes on the selection and
 *  labels on hover; meshes lit with their wire hidden; controls shown (Object mode poses them for tests). */
export const RIG_DISPLAY: DisplayFlags = {
  ...DEFAULT_DISPLAY,
  joints: true,
  xrayJoints: true,
  jointAxes: 'selected',
  jointLabels: 'hover',
  constraintLines: true,
};

/** The display a pane starts with in a workspace. */
export function defaultDisplayOf(workspace: string): DisplayFlags {
  return workspace === 'model' ? MODEL_DISPLAY : workspace === 'rig' ? RIG_DISPLAY : DEFAULT_DISPLAY;
}

/** The camera a pane looks through in a workspace until the user picks another one. */
export function defaultCameraOf(workspace: string, paneId: string): PaneCamera {
  return (workspace === 'model' ? MODEL_CAMERAS[paneId] : undefined) ?? defaultPaneCamera(paneId);
}

/** The memory key of a pane in a workspace. */
export const paneKey = (workspace: string, paneId: string): string => `${workspace}:${paneId}`;
