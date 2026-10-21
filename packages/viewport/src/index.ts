// @ekza-studio/viewport — one-canvas multi-pane three.js viewport (MVP-SPEC §4.6, §7 WP-5; ADR 0006).
export { registerViewportContributions } from './manager/contributions';
export { subscribeViewportManager, viewportManagerOf } from './manager/lookup';
export { resolveControl, type ViewportTestApi, viewportTestApi } from './manager/testApi';
export {
  DEFAULT_DISPLAY,
  type PanePointerMenus,
  type PanePointerPress,
  type PaneState,
  ViewportManager,
  WHEEL_BURST_MS,
} from './manager/ViewportManager';
// M6a (M6A-SPEC §4.7, §5.17, §5.26; B9)
export { type ImagePlaneCamera, type ImagePlaneSpec } from './manager/imagePlanes';
export { defaultCameraOf, defaultDisplayOf, MODEL_DISPLAY } from './manager/workspaceViews';
export { LAYER } from './layers';
export { isMmbStandIn } from './navigation/profiles';
export { loadScaleKit } from './manipulators/scale/load';
export { SCALE_LABEL, scaleToolDef } from './tools/scaleTool';
export {
  loadMeshDisplay,
  loadMeshView,
  MESH_LAYERS,
  type MeshDisplay,
  type MeshDisplayOptions,
  type MeshDisplayPick,
  type MeshLayerHost,
  type MeshLayerTarget,
  type MeshView,
  meshPaneDisplay,
} from './mesh';
export { defaultPaneCamera, FIRST_SHOT_CAMERA, LAYOUT_PANES } from './panes/layout';
// M6a (B10): the Model select runtime (mesh display, component and object picking, the operators' pointer probe).
export {
  attachModelSelect,
  type ModelSelectRuntime,
  modelSelectOf,
  subscribeModelSelect,
} from './tools/model/select';
export type { ViewportToolHost } from './tools/host';
export { selectModeOf } from './tools/selectTool';
export * from './types';
export {
  startVirtualSliderDrag,
  type VirtualSliderDrag,
  type VirtualSliderDragOptions,
} from './tools/virtualSliderDrag';
// M6a (B12a, M6A-SPEC §5.15, §8.7): Model's transform runtime (component and object transforms, the MMB rule, Tweak,
// snapping, pivots, soft select) and the modal readout's state.
export {
  attachModelTransform,
  type ModelTransformBehaviour,
  type ModelTransformRuntime,
  modelTransformOf,
  subscribeModelTransform,
  TRANSFORM_TOOL_KEYS,
  type TransformToolId,
} from './tools/model/transform';
export {
  setTransformReadout,
  subscribeTransformReadout,
  type TransformReadout,
  transformReadout,
} from './tools/model/transform/readout';
export type { ManipulatorFrame, ModelManipulator, ModelManipulatorTarget } from './tools/model/transform/types';
export { mmbHandleFor, withModelTransform } from './tools/transformTool';
