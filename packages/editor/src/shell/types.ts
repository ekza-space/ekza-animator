// The editor shell's imperative core (MVP-SPEC §7 WP-8): what the React shell, the GL host, the input adapter,
// the dialogs, the panels and the e2e test API share. One Shell per mounted editor; no React state lives here.
import type { Disposer } from '@ekza-animator/anim-core';
import type { CurveId } from '@ekza-animator/doc';
import type {
  EditorApp,
  ImporterDef,
  OperatorResult,
  PaneCamera,
  PanelKind,
  PrefsStorage,
  RunContext,
} from '@ekza-animator/editor-core';
import type { ExportArtifact } from '@ekza-animator/io';
import type { ViewportManager } from '@ekza-animator/viewport';
import type { DockviewApi } from 'dockview-react';
import type { StoreApi } from 'zustand/vanilla';
import type { KeyboardAdapter } from '../input/keyboard';
import type { HoverTarget } from '../input/pointer';
import type { PanelRegistry } from '../panels/types';
import type { ToastNotifier } from '../services/notify';
import type { EditorParams } from '../test-api/params';
import type { ModelSummary } from './summary';

// ---------- probes: what the e2e test API reads from panels (registered by the panels, §4.8) ----------

/** Registered by the viewport panel (WP-5): its panes, so `panes()` and `screenOf*` know cameras and surfaces. */
export interface ViewportProbe {
  panes(): readonly { readonly id: string; readonly element: HTMLElement; readonly camera: PaneCamera }[];
}

/** Registered by the Graph Editor panel (WP-6) for its focused controller. Points are canvas CSS px. */
export interface GraphProbe {
  readonly canvas: HTMLElement;
  view(): { readonly f0: number; readonly v0: number; readonly sx: number; readonly sy: number };
  visibleCurves(): readonly CurveId[];
  keyPoint(key: string): { readonly x: number; readonly y: number } | null;
  handlePoint(key: string, side: 'in' | 'out'): { readonly x: number; readonly y: number } | null;
  curvePoint(curve: string, frame: number): { readonly x: number; readonly y: number } | null;
}

/** Registered by the timeline panel (WP-6t) for its time slider. Points are canvas CSS px. */
export interface TimelineProbe {
  readonly canvas: HTMLElement;
  frameToX(frame: number): number;
  tickPoint(frame: number): { readonly x: number; readonly y: number } | null;
}

export interface ProbeMap {
  readonly viewport: ViewportProbe;
  readonly graph: GraphProbe;
  readonly timeline: TimelineProbe;
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
  readonly summaryError: string | null;
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
  /** Rebuilds the default Animate layout and forgets the stored one. */
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
}

export interface FilePipeline {
  /** Drag-and-drop and the file picker: one file after another; errors become toasts. */
  openFiles(files: readonly File[]): Promise<void>;
  /** The common path (also the test API's `loadFile`). Rejects with the failure message. */
  openFile(name: string, bytes: Uint8Array, opts?: OpenFileOptions): Promise<void>;
  confirmImport(options: Readonly<Record<string, unknown>>): Promise<OperatorResult<unknown>>;
  cancelImport(): void;
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
  /** WebGL frames rendered so far (test API `renderedFrames()`, the idle-check of ARCHITECTURE §14). */
  renderedFrames(): number;
  /** Called by the GL host for every frame it renders without a ViewportManager. */
  countFallbackFrame(): void;
  /** Points `app.requestFrame` back at the rAF scheduler (the GL host went away or never started). */
  restoreFallbackFrames(): void;
  readonly probes: ProbeRegistry;
  readonly workspace: WorkspaceApi;
  readonly files: FilePipeline;
  readonly exports: ExportRecorder;
  readonly keyboard: KeyboardAdapter;
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
