// The HostShell (AUTORIG-SPEC §4.4, D1): what both shells of the `(studio)` layout share — one per page load,
// created by `StudioHost` with the browser services and the EditorApp. It owns the UI store (dialogs, confirm, help,
// GL status, the hovered panel), the frame hooks, the probes, the toasts, the keyboard adapter, the file pipeline,
// the export recorder, autosave, the command palette (the overlay port), the navigation port and the slot of the
// shell mounted on the page. The Studio shell (`shell/createShell.ts`) adds dockview, panels, menus and marking menus
// on top of it; the Auto-Rig shell adds its wizard. Types only: no runtime code here.
import type { Disposer } from '@ekza-studio/anim-core';
import type {
  EditorApp,
  HandoffInfo,
  MarkingMenuDef,
  NavigationPort,
  OperatorResult,
  PrefsStorage,
  RunContext,
  WorkspaceId,
} from '@ekza-studio/editor-core';
import type { StoreApi } from 'zustand/vanilla';
import type { KeyboardAdapter } from '../input/keyboard';
import type { CommandPalette } from '../overlays/CommandPalette';
import type { ToastNotifier } from '../services/notify';
import type {
  ConfirmRequest,
  ExportRecorder,
  FilePipeline,
  FrameHooks,
  HelpMessage,
  ProbeRegistry,
  ShellUiState,
} from '../shell/types';
import type { EditorParams } from '../test-api/params';

/** The shell a route mounts in the host (Studio's dockview shell, or the Auto-Rig wizard). */
export interface MountedShell {
  readonly kind: 'studio' | 'autorig';
  /** Called before the host navigates away from this shell: close its menus, end its tool sessions (§4.4). */
  leave?(): void;
  /** Opens a marking menu (the overlay port's `openMarkingMenu`; Studio only). */
  openMarkingMenu?(menu: MarkingMenuDef, ctx: RunContext): void;
  /** What a handoff record carries of this shell (Auto-Rig: its step and start pose); null for Studio. */
  handoffState?(): HandoffInfo['autorig'];
}

/** The host's navigation port (`provideNavigation`): the contract plus what the arriving shell reads once. */
export interface HostNavigation extends NavigationPort {
  /** The Studio workspace the last same-page `go` asked for (read once by the arriving Studio shell), else null. */
  takeWorkspace(): WorkspaceId | null;
  /** The info of the handoff record this page received (`?handoff=`), once: the Auto-Rig shell reads its step. */
  takeHandoffInfo(): HandoffInfo | null;
  /** Host-internal: a received handoff record's info (its subject and workspace become the arrival's). */
  arrive(info: HandoffInfo): void;
}

export interface HostShell {
  readonly app: EditorApp;
  readonly toasts: ToastNotifier | null;
  readonly storage: PrefsStorage | null;
  readonly params: EditorParams;
  readonly ui: StoreApi<ShellUiState>;
  readonly frame: FrameHooks;
  /** Frames the GL host's canvas has run so far (test API `renderedFrames()`). */
  renderedFrames(): number;
  /** Called by the GL host for every frame of its canvas. */
  countFrame(): void;
  /** Points `app.requestFrame` back at the rAF scheduler (the GL host went away or never started). */
  restoreFallbackFrames(): void;
  readonly probes: ProbeRegistry;
  readonly files: FilePipeline;
  readonly exports: ExportRecorder;
  readonly keyboard: KeyboardAdapter;
  /** The command palette (`Mod+K`, `⋯ › Command palette…`): its chunk loads on first use on either route. */
  readonly commandPalette: CommandPalette;
  readonly navigation: HostNavigation;
  /** The shell mounted on the page (null between two shells, or before the first one has loaded). */
  readonly mounted: StoreApi<MountedShell | null>;
  /** Mounts a shell (the previous one is replaced); the disposer unmounts it when it is still the mounted one. */
  mount(shell: MountedShell): Disposer;
  /** Shows a transient help-line message (cancelled commands, hints). */
  help(text: string, tone?: HelpMessage['tone']): void;
  /** Asks the user (modal confirm); resolves true at once in e2e mode. */
  confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean>;
  /** Runs an operator for a UI surface: failures become toasts, cancellations help-line messages. */
  runFromUi(op: string, args?: unknown, ctx?: RunContext): Promise<OperatorResult<unknown>>;
  dispose(): void;
}
