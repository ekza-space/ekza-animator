// @ekza-studio/viewport — one-canvas multi-pane three.js viewport (MVP-SPEC §4.6, §7 WP-5; ADR 0006).
export { registerViewportContributions } from './manager/contributions';
export { subscribeViewportManager, viewportManagerOf } from './manager/lookup';
export { resolveControl, type ViewportTestApi, viewportTestApi } from './manager/testApi';
export {
  type AgentOverlayPass,
  DEFAULT_DISPLAY,
  type DisplayOverlay,
  type PanePointerMenus,
  type PanePointerPress,
  type PaneState,
  type ViewportAgentHost,
  ViewportManager,
  type ViewportPointerLayer,
  WHEEL_BURST_MS,
} from './manager/ViewportManager';
// M6a (M6A-SPEC §4.7, §5.17, §5.26; B9)
export { type ImagePlaneCamera, type ImagePlaneSpec } from './manager/imagePlanes';
export { defaultCameraOf, defaultDisplayOf, MODEL_DISPLAY } from './manager/workspaceViews';
export { LAYER } from './layers';
export { isMmbStandIn } from './navigation/profiles';
// STUDIO-TOUCH-SPEC §20.4 (T1): a touch shell's pointer arbiter (`ViewportManager.setPointerArbiter`) and the
// tolerances by pointer type (§5.4).
export {
  type ArbiterClaim,
  type ArbiterConfig,
  type ArbiterFollow,
  type ArbiterHost,
  type ArbiterPointer,
  type ArbiterPointerType,
  type ArbiterPort,
  type ArbiterRouting,
  type ArbiterTap,
  type CoalescedSample,
  createPointerArbiter,
  hostPort,
  onChrome,
  type PipeStep,
  type PointerArbiter,
  type PointerArbiterStage,
  pointerArbiter,
  type ViewGesture,
} from './input/arbiter';
export {
  createModifierSource,
  type ModifierSource,
  NO_MODIFIERS,
  type VirtualHoldCode,
  type VirtualModifiers,
} from './input/modifiers';
export {
  handleGrowPx,
  POINTER_TOLERANCE,
  type PointerKind,
  pointerInUse,
  pointerKind,
  usePointerTolerance,
} from './input/tolerance';
// AUTORIG-SPEC §8.1 (D3): a shell's per-press navigation override (`ViewportManager.setNavigationOverride`).
export type { NavGesture, NavigationOverride, NavPointerInput } from './navigation/override';
// AUTORIG-SPEC §8.1, §8.3 (D3), moved from Auto-Rig by STUDIO-TOUCH-SPEC §20.3 item 1 (T1): Simple navigation and the
// two-finger stage (a lazy chunk of `installSimpleNavigation`).
export {
  addNavigationClaim,
  BRUSH_TOOLS,
  createTwoFingerStage,
  type Finger,
  installSimpleNavigation,
  MESH_TOOLS,
  type NavigationClaim,
  type SimplePress,
  simpleGesture,
  toolClaims,
  twoFingerStep,
} from './navigation/touch';
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
// M6b (M6B-SPEC §4.7): the lazy Rig & Skin overlays (C0 stubs; C3, C6, C8b, C9 fill viewport/src/rig/**).
export { loadViewportRig, type ViewportRigModule } from './rig/load';
// M6b (C3): the skeleton runtime of a viewport (the test API's joint and marker queries) and the pointer layer.
export { viewportRigOf } from './rig/joints/attach';
export type { ViewportRigRuntime } from './rig/runtime';
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
// M6b (C6): Skin mode's runtime of a viewport (the skinned and weight display, the Paint Skin Weights tool), loaded on
// the first Rig & Skin entry.
export { type RigSkinRuntime, rigSkinOf } from './tools/rig/paint';
// M-AI (MCP-SPEC §5.15.3; B3): one offscreen view_capture tile through the agent host (imported by the lazy agent module)
export {
  type AgentTileCamera,
  type AgentTileRequest,
  type AgentTileResult,
  renderAgentTile,
  tileCamera,
} from './manager/agentTile';
