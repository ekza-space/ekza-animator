// `@ekza-studio/editor/host` (AUTORIG-SPEC §4.1, §4.4; D1): the HostShell both shells mount — `StudioHost` (the
// `(studio)` layout's island: services, EditorApp, GL host, dialogs, palette, toasts, input, autosave, the handoff
// record, the navigation port and the test API) and what a shell needs from it: `useHost()` and `useHostUi()`, the
// dialog opener (`openDialog`), the navigation port (`hostNavigation`), the overlay port (`openOverlay`), `PaneView`,
// the R-Markers pane constants and the test API's Auto-Rig provider registration. No dockview, no panel registry,
// no menus: `/autorig` imports this subpath and the Studio shell never reaches it through here.
import { type EditorApp, hostNavigation, shellOverlayPort, type UiDialog } from '@ekza-studio/editor-core';

export { HostContext, HostProvider, useHost, useHostUi, useOptionalHost } from './context';
export { createHostShell, type CreateHostOptions } from './createHost';
export { type NavigationOptions, routeHref } from './navigation';
export { RIG_LAYOUT, RIG_MARKER_PANES, RIG_MARKER_SIZES, type RigLayoutId } from './panes';
export { type CreateAppArgs, STUDIO_HOST_MARKER, StudioHost, type StudioHostProps } from './StudioHost';
export type { HostNavigation, HostShell, MountedShell } from './types';
export { PaneView } from '../panels/viewport/PaneView';
export { type AutoRigTestState, provideAutoRigTestState } from '../test-api/autorig';
export { type HaloTestState, provideHaloTestState } from '../test-api/halo';
export { provideRecoveryHook, type RecoveryHook } from './registrations/recovery';
export { useAgentPill } from './registrations/agent';
export { pickerAccept } from '../services/fileTypes';
// STUDIO-TOUCH-SPEC §13.3, §17, S9–S11 (T11): Halo's Home and Share read the platform services T0 built — the byte
// sniffer of Bring a model, the iOS device class and the share preference of the two-step save, the memory profile's
// triangle gate and the storage card's persistence request. Re-exports only (tree-shaken where unused).
export {
  type FileKind,
  isIosWebKit,
  nameForKind,
  sniffFileKind,
  UNSUPPORTED_FILE_TEXT,
} from '../services/fileTypes';
export { sharePreferred } from '../services/files';
export { requestPersistentStorage } from '../services/autosave';
export { type MemoryProfile, memoryProfileOf } from './memoryProfile';
export { hostNavigation };

/** Opens a host dialog (`ui.open`): the dialogs every route has (Export, Open, Import, Preferences, Recovery, …). */
export function openDialog(host: { runFromUi(op: string, args?: unknown): Promise<unknown> }, dialog: UiDialog): void {
  void host.runFromUi('ui.open', { dialog });
}

/** The overlay port (§4.4): the command palette loads its chunk on first use, on either route. */
export function openOverlay(app: EditorApp, overlay: 'commandPalette'): boolean {
  const port = shellOverlayPort(app);
  if (port === null || overlay !== 'commandPalette') return false;
  port.openCommandPalette();
  return true;
}
