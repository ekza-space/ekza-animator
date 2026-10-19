// @ekza-animator/viewport — one-canvas multi-pane three.js viewport (MVP-SPEC §4.6, §7 WP-5; ADR 0006).
export { registerViewportContributions } from './manager/contributions';
export { subscribeViewportManager, viewportManagerOf } from './manager/lookup';
export { resolveControl, type ViewportTestApi, viewportTestApi } from './manager/testApi';
export {
  type AgentOverlayPass,
  DEFAULT_DISPLAY,
  type PaneState,
  type ViewportAgentHost,
  ViewportManager,
  WHEEL_BURST_MS,
} from './manager/ViewportManager';
export { defaultPaneCamera, FIRST_SHOT_CAMERA, LAYOUT_PANES } from './panes/layout';
export type { ViewportToolHost } from './tools/host';
export { selectModeOf } from './tools/selectTool';
export * from './types';
export {
  startVirtualSliderDrag,
  type VirtualSliderDrag,
  type VirtualSliderDragOptions,
} from './tools/virtualSliderDrag';
