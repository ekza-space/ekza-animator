export { Editor, type EditorProps } from './Editor';
// AUTORIG-SPEC §4.4 (D1): the `/editor` route's shell inside the `(studio)` layout's `StudioHost`
// (`@ekza-studio/editor/host`); `Editor` above is both in one tree.
export { STUDIO_SHELL_MARKER, StudioShell, type StudioShellProps } from './shell/EditorShell';
export { StudioHost } from './host/StudioHost';
export {
  EditorAppProvider,
  useDocQuery,
  useEditorApp,
  useFrameCallback,
  useHelpLine,
  usePrefs,
  useRunOperator,
  useSession,
  useTestProbe,
  useViewportManager,
} from './hooks';
export { registerBuiltinPanels } from './panels';
export { createPanelRegistry } from './panels/registry';
export type { PanelDef, PanelProps, PanelRegistry } from './panels/types';
export { type BrowserServicesOptions, createBrowserServices } from './services/browser';
export type { ShellOperatorArgs } from './shell/operator-map';
export {
  type DopeSheetProbe,
  type FrameCallback,
  type GraphProbe,
  type TimelineProbe,
  type TweenPanel,
  type TweenProbe,
  tweenProbeKey,
  type ViewportProbe,
} from './shell/types';
export type { EkzaStudioTestApi } from './test-api/types';
