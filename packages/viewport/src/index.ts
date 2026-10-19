// @ekza-animator/viewport — one-canvas multi-pane three.js viewport (MVP-SPEC §4.6, §7 WP-5; ADR 0006).
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
export { defaultPaneCamera, FIRST_SHOT_CAMERA, LAYOUT_PANES } from './panes/layout';
export type { ViewportToolHost } from './tools/host';
export { selectModeOf } from './tools/selectTool';
export * from './types';
export {
  startVirtualSliderDrag,
  type VirtualSliderDrag,
  type VirtualSliderDragOptions,
} from './tools/virtualSliderDrag';
