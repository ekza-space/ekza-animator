// The editor shell's imperative core (MVP-SPEC §7 WP-8): what the React shell, the GL host, the input adapter,
// the dialogs, the panels and the e2e test API share. One Shell per mounted editor; no React state lives here.
import type { Disposer } from '@ekza-animator/anim-core';
import type {
  EditorApp,
  ImporterDef,
  OperatorResult,
  PanelKind,
  PrefsStorage,
  RunContext,
} from '@ekza-animator/editor-core';
import type { ExportArtifact } from '@ekza-animator/io';
import type { ViewportManager } from '@ekza-animator/viewport';
import type { DockviewApi } from 'dockview-react';
import type { StoreApi } from 'zustand/vanilla';
import type { KeyboardAdapter } from '../input/keyboard';
import type { CommandPalette } from '../overlays/CommandPalette';
import type { MarkingMenus } from '../overlays/MarkingMenu';
import type { HoverTarget } from '../input/pointer';
import type { PanelRegistry } from '../panels/types';
import type { ToastNotifier } from '../services/notify';
import type { EditorParams } from '../test-api/params';
import type { EkzaAnimatorTestApi } from '../test-api/types';
import type { ModelSummary } from './summary';

// ---------- probes: what the e2e test API reads from panels (§4.8) ----------
// Each probe is the slice of the test API a panel owns, in page CSS px. The panel work packages export exactly these
// shapes: WP-5 `viewportTestApi(vm)`, WP-6 `graphTestHooks(app)`, WP-6t `screenOfTimelineFrame/Tick(app, frame)`.

/** Viewport slice (WP-5 `viewportTestApi(vm)`); without one the test API answers from the ViewportManager. */
export type ViewportProbe = Pick<
  EkzaAnimatorTestApi,
  'panes' | 'cameraOf' | 'screenOfControl' | 'screenOfManipulator' | 'renderedFrames'
>;

/** The M1 fields of `graph()`; the M2a field `viewMode` is optional in a probe. */
type GraphState = NonNullable<ReturnType<EkzaAnimatorTestApi['graph']>>;

/**
 * Graph Editor slice (WP-6 `graphTestHooks(app)`); without one `graph()` and `screenOf{Key,Handle,Curve}` are null.
 * M2a: `graph().viewMode` and `screenOfRegionHandle` are optional in a probe. The Graph Editor's probe provides both
 * (A4); for a probe without them (test fakes) the test API answers 'absolute' and null. `graph().buffers` comes from
 * the session.
 */
export type GraphProbe = Pick<EkzaAnimatorTestApi, 'screenOfKey' | 'screenOfHandle' | 'screenOfCurve'> & {
  graph(): (Omit<GraphState, 'viewMode' | 'buffers'> & Partial<Pick<GraphState, 'viewMode'>>) | null;
} & Partial<Pick<EkzaAnimatorTestApi, 'screenOfRegionHandle'>>;

/** Time slider slice (WP-6t `screenOfTimelineFrame/Tick`); without one both are null. M2a: `timelineTicks` and
 *  `screenOfBand` are optional in a probe; the time slider's probe provides both (A3), a probe without them (test
 *  fakes) gives no ticks and no band point. */
export type TimelineProbe = Pick<EkzaAnimatorTestApi, 'screenOfFrame' | 'screenOfTick'> &
  Partial<Pick<EkzaAnimatorTestApi, 'timelineTicks' | 'screenOfBand'>>;

/** M2a (A3): the Dope Sheet slice; null answers while its dock tab is inactive (like M1's `graph()`). */
export type DopeSheetProbe = Pick<EkzaAnimatorTestApi, 'dopeSheet' | 'screenOfDopeKey' | 'screenOfDopeRegion'>;

/** Panels that mount the shared Tween bar (M2A-SPEC §5.13). */
export type TweenPanel = 'graph' | 'dopeSheet' | 'status';
/** M2a (A4): one mounted Tween bar, registered under `tweenProbeKey(panel)`. */
export interface TweenProbe {
  screenOfTween(amount: number): { x: number; y: number } | null;
  tweenTarget(): { kind: 'frame' | 'keys'; label: string } | null;
}
/** The probe key of the Tween bar mounted in `panel` (probes are keyed by the bar's panel). */
export const tweenProbeKey = (panel: TweenPanel): `tween.${TweenPanel}` => `tween.${panel}`;

export interface ProbeMap {
  readonly viewport: ViewportProbe;
  readonly graph: GraphProbe;
  readonly timeline: TimelineProbe;
  // M2a (M2A-SPEC §4.8; A0 adds the keys, the owners register them)
  readonly dopeSheet: DopeSheetProbe;
  readonly 'tween.graph': TweenProbe;
  readonly 'tween.dopeSheet': TweenProbe;
  readonly 'tween.status': TweenProbe;
}

export interface ProbeRegistry {
  /** The most recently registered probe of a kind that is still registered. */
  get<K extends keyof ProbeMap>(kind: K): ProbeMap[K] | null;
  set<K extends keyof ProbeMap>(kind: K, probe: ProbeMap[K]): Disposer;
}

// ---------- frame loop ----------

export type FrameCallback = (timestampMs: number) => void;

export interface FrameHooks {
  /** Runs before the GL render of a frame: playback clock, evaluation, then the registered callbacks. */
  readonly before: Set<FrameCallback>;
  /** Runs after the GL render of a frame: 2D canvas redraws (Graph Editor, time slider). */
  readonly after: Set<FrameCallback>;
  runBefore(timestampMs: number): void;
  runAfter(timestampMs: number): void;
}

// ---------- shell UI state (not the editor session: dialogs live in session.dialog) ----------

export type GlStatus = 'pending' | 'ready' | 'unavailable' | 'lost';

export interface PendingImport {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly importer: ImporterDef;
  /** null while the file is being read, or when no summary could be read (the import may still work). */
  readonly summary: ModelSummary | null;
  /** Why the summary could not be read (`code`: the EkzaError code, e.g. 'not-glb'), or null. */
  readonly summaryError: { readonly code: string | null; readonly message: string } | null;
}

export interface HelpMessage {
  readonly id: number;
  readonly text: string;
  readonly tone: 'info' | 'warning' | 'error';
}

export interface ConfirmRequest {
  readonly title: string;
  readonly text: string;
  readonly confirmLabel: string;
  readonly resolve: (confirmed: boolean) => void;
}

export interface ShellUiState {
  readonly viewport: ViewportManager | null;
  readonly gl: { readonly status: GlStatus; readonly renderer: string | null };
  readonly hover: HoverTarget | null;
  /** The last panel the pointer was over (menu commands dispatch to it, e.g. Edit › Copy). */
  readonly lastPanel: HoverTarget | null;
  readonly pendingImport: PendingImport | null;
  readonly dragOver: boolean;
  readonly help: HelpMessage | null;
  /** Shell-side busy state (reading a dropped file); the session's `busy` covers operators. */
  readonly busy: string | null;
  readonly dockMaximized: boolean;
  readonly confirm: ConfirmRequest | null;
  /** M6a (§8.2): the time slider shown (true) or hidden (false) per workspace, where the user toggled it (Windows ›
   *  Timeline); absent = the workspace definition's `timeline`. */
  readonly timeline: Readonly<Record<string, boolean>>;
}

// ---------- the last export (test API `lastExport()`) ----------

export interface LastExport {
  readonly fileName: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly lints: readonly unknown[];
  readonly readBack: unknown;
}

export interface ExportRecorder {
  recordDownload(record: { readonly fileName: string; readonly bytes: Uint8Array; readonly mime: string }): void;
  recordArtifacts(artifacts: readonly ExportArtifact[]): void;
  last(): LastExport | null;
}

// ---------- workspace (dockview adapter) ----------

export interface WorkspaceApi {
  /** The bound dockview API (null until the workspace has mounted). */
  readonly dockview: DockviewApi | null;
  /** M6a: the workspace whose layout the dockview shows. */
  readonly workspace: string;
  /** Rebuilds the current workspace's default layout and forgets the stored one. */
  reset(): void;
  /** Activates the panel of `kind`, adding it to its default dock when it is closed. False when unknown. */
  showPanel(kind: PanelKind): boolean;
  /** Maximizes or restores the dockview group of a panel instance (or of the first panel of `kind`). */
  toggleMaximize(target: { readonly instanceId?: string | null; readonly kind?: PanelKind | null }): boolean;
  hasMaximized(): boolean;
  /** Panel kinds present in the layout. */
  kinds(): readonly PanelKind[];
}

// ---------- file pipeline ----------

export interface OpenFileOptions {
  /** Skip the import dialog; run the importer with `importOptions` (or its defaults). */
  readonly auto?: boolean;
  readonly importOptions?: Readonly<Record<string, unknown>>;
  /**
   * A model's import dialog: resolve only once it has closed (the import ran, or the dialog was cancelled or
   * replaced). Without it `openFile` resolves as soon as the dialog shows (the test API's `loadFile`).
   */
  readonly waitForDialog?: boolean;
}

export interface FilePipeline {
  /**
   * Drag-and-drop and the file picker: projects, then models, then animations (drop order otherwise), one after
   * another; each model's import dialog closes before the next file opens, and later drops queue behind earlier
   * ones. Errors become toasts; the promise never rejects.
   */
  openFiles(files: readonly File[]): Promise<void>;
  /** The common path (also the test API's `loadFile`). Rejects with the failure message. */
  openFile(name: string, bytes: Uint8Array, opts?: OpenFileOptions): Promise<void>;
  /** Imports the pending model with the dialog's options; the dialog closes first. */
  confirmImport(options: Readonly<Record<string, unknown>>): Promise<OperatorResult<unknown>>;
  /** Drops the pending model (the import dialog closed without importing). */
  cancelImport(): void;
  /** Stops queued files and releases every waiter (shell disposal). */
  dispose(): void;
}

// ---------- the shell ----------

export interface Shell {
  readonly app: EditorApp;
  readonly panels: PanelRegistry;
  readonly toasts: ToastNotifier | null;
  readonly storage: PrefsStorage | null;
  readonly params: EditorParams;
  readonly ui: StoreApi<ShellUiState>;
  readonly frame: FrameHooks;
  /**
   * Frames the GL host's canvas has run so far (test API `renderedFrames()`, the idle check of ARCHITECTURE §14):
   * every demand-loop frame counts, whether or not the ViewportManager found dirty panes to draw.
   */
  renderedFrames(): number;
  /** Called by the GL host for every frame of its canvas. */
  countFrame(): void;
  /** Points `app.requestFrame` back at the rAF scheduler (the GL host went away or never started). */
  restoreFallbackFrames(): void;
  readonly probes: ProbeRegistry;
  readonly workspace: WorkspaceApi;
  readonly files: FilePipeline;
  readonly exports: ExportRecorder;
  readonly keyboard: KeyboardAdapter;
  /** M6a (§5.18): the marking menus (pointer presses in panes, `ui.markingMenu`). */
  readonly markingMenus: MarkingMenus;
  /** M6a (§5.18): the command palette (`Mod+K`). */
  readonly commandPalette: CommandPalette;
  /** Binds the dockview API once the workspace has mounted. */
  attachWorkspace(api: DockviewApi): Disposer;
  /** Shows a transient help-line message (cancelled commands, hints). */
  help(text: string, tone?: HelpMessage['tone']): void;
  /** Asks the user (modal confirm); resolves true at once in e2e mode. */
  confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean>;
  /** Runs an operator for a UI surface: failures become toasts, cancellations help-line messages. */
  runFromUi(op: string, args?: unknown, ctx?: RunContext): Promise<OperatorResult<unknown>>;
  dispose(): void;
}
