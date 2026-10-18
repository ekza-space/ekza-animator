// Contract file: MVP-SPEC §4.5 with the M2A-SPEC §4.5 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { StoreApi } from 'zustand/vanilla';
import type { AnimCurve, CompiledAnimCurve, Disposer, Frame, Handle, TangentType } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, CameraId, ChangeBatch, ChannelId, ChannelValues, CharacterId, ClipId, ControlId,
  CurveId, DocumentStore, KeyId, Tx, UndoResult, UserId } from '@ekza-animator/doc';
import type { ExportArtifact, ExportKind, ExportProfileDef, ExportReduceSpec, ExportRequest, GlbContainer,
  ValidationReport } from '@ekza-animator/io';
import type { ChannelBuffer, ClipSampler, FootPin, LimbId, PoseBuffers, PoseClipboard, RigProgram,
  SkeletonDesc } from '@ekza-animator/rig';
import type { OperatorMap } from './operators/args';

// ---------- panels and scopes ----------
/** Open string; built-in ids below. Extensions use namespaced ids ('acme.notes'). */
export type PanelKind = string;
export const PANEL = {
  viewport: 'viewport', graph: 'graph', timeline: 'timeline', outliner: 'outliner', clips: 'clips',
  channelBox: 'channelBox', attributes: 'attributes', dopeSheet: 'dopeSheet',   // M2a: dopeSheet
} as const;
/** 'global' or a PanelKind. */
export type KeyScope = string;
export const GLOBAL_SCOPE = 'global';

// ---------- selection (U state) ----------
export interface KeyPartSelection { readonly key: boolean; readonly in: boolean; readonly out: boolean }
export interface ChannelRef { readonly control: ControlId; readonly channel: ChannelId }
/** Selection is limited to one character in the MVP: selecting another character's control makes it active. */
export interface Selection {
  readonly controls: readonly ControlId[];                       // ordered; lead = last
  readonly keys: ReadonlyMap<KeyId, KeyPartSelection>;           // Graph Editor / time slider
  readonly channels: readonly ChannelRef[];                      // Channel Box / Graph channel list highlight
}
export interface SelectionMask { readonly controls: boolean; readonly joints: boolean; readonly meshes: boolean }
export type SelectMode = 'replace' | 'toggle' | 'add' | 'remove';

// ---------- panes and display (owned here so operators can type them; viewport re-exports) ----------
export type ViewPreset = 'persp' | 'top' | 'front' | 'side';
export type PaneCamera = { readonly kind: 'view'; readonly preset: ViewPreset } | { readonly kind: 'shot'; readonly cameraId: CameraId };
export interface DisplayFlags {
  readonly mesh: boolean;        // default true
  readonly skeleton: boolean;    // default false
  readonly controls: boolean;    // default true
  readonly grid: boolean;        // default true
  readonly xray: boolean;        // default false (meshes 50 % transparent)
  readonly hud: boolean;         // default true
  readonly springBones: boolean; // default false (VRM spring-bone preview during playback only)
}
export type ViewportLayout = 'single' | 'split' | 'quad';
/** Manipulator handles; gimbal rings reuse rx/ry/rz (axis = channel). */
export type ManipHandle = 'tx' | 'ty' | 'tz' | 'txy' | 'tyz' | 'txz' | 'tview' | 'rx' | 'ry' | 'rz' | 'rview';

// ---------- time (U state) ----------
export type LoopMode = 'once' | 'loop' | 'oscillate';
export type PlaybackSpeed = 'realtime' | 'every-frame' | 'half' | 'double';
export interface TimeState {
  /** Master clock in scene frames (ProjectRecord.sceneFps). The UI shows active-clip frames (§4.11.8). */
  readonly sceneFrame: Frame;
  readonly playing: boolean;
  readonly direction: 1 | -1;
  readonly loop: LoopMode;                                        // default 'loop'
  readonly speed: PlaybackSpeed;                                  // default 'realtime'
  readonly playbackRange: { readonly start: Frame; readonly end: Frame } | null;   // scene frames; null = active clip range
  readonly snapToFrames: boolean;                                 // default true (integer active-clip frames)
  /** Time-slider selection band in active-clip frames (Shift+click / Shift+drag), or null. */
  readonly band: { readonly start: Frame; readonly end: Frame } | null;
}

// ---------- tools (U state) ----------
export type ToolId = string;
export const VIEWPORT_TOOL = { select: 'select', move: 'move', rotate: 'rotate' } as const;
export const GRAPH_TOOL = { select: 'select', move: 'move', insert: 'insert', scale: 'scale' } as const;   // M2a: scale
export const DOPE_TOOL = { select: 'select', move: 'move', scale: 'scale' } as const;
export type ManipSpace = 'object' | 'world' | 'gimbal';      // gimbal: rotate tool only

// ---------- M2a vocabulary (M2A-SPEC §4.5) ----------
export type KeyTarget = 'selected' | 'bodyPart' | 'character';
export type BodyPart = 'root' | 'torso' | 'head' | 'arm.L' | 'arm.R' | 'fingers.L' | 'fingers.R' | 'leg.L' | 'leg.R';
export type GraphViewMode = 'absolute' | 'normalized' | 'stacked';
export type TweenMode = 'tween' | 'neighbor' | 'ease' | 'pushPull' | 'toDefault';
/** 'auto': 'seamless' when the ikFk curve has keys or auto-key is on, else 'none' (§5.6). */
export type IkFkKeyMode = 'auto' | 'none' | 'key' | 'seamless';
export type ControlVisibility = 'visible' | 'ghost' | 'hidden';
/** M2a §5.1 rule 5 (A0): display unit of a TRS channel or a '@name' attribute. */
export type ChannelUnit = 'angle' | 'distance' | 'none';

export interface ToolState {
  readonly viewport: ToolId;
  readonly graph: ToolId;
  readonly dopeSheet: ToolId;                                     // M2a, default 'select'
  readonly manipulatorSize: number;                               // px, default 90
  readonly selectionMask: SelectionMask;                          // default controls only
  readonly keyTarget: KeyTarget;                                  // changed: + 'bodyPart'
  readonly ripple: boolean;                                       // M2a, default false (Dope Sheet + time slider)
  /** M2a §5.13: 'auto' = 'keys' when keys are selected, else 'frame'; 'frame' forces the pose target. Default 'auto'. */
  readonly tweenTarget: 'auto' | 'frame';
}

// ---------- clipboards ----------
export interface KeyClipboardKey {
  readonly dt: number;                                            // frames relative to the earliest copied key
  readonly v: number;
  readonly inType: TangentType; readonly outType: TangentType;
  readonly inHandle: Handle; readonly outHandle: Handle;
  readonly broken: boolean; readonly weightLocked: boolean;
}
export interface KeyClipboard {
  readonly kind: 'ekza.keys'; readonly version: 2;
  readonly curves: readonly {
    readonly control: string;                                     // template key
    readonly channel: ChannelId;
    readonly weighted: boolean;                                   // source curve's flag (§4.11.4 conversion)
    readonly keys: readonly KeyClipboardKey[];
  }[];
}

// ---------- M2a: buffer curves and autosave (M2A-SPEC §4.5) ----------
/** Graph Editor buffer curve (per user, never in the document). */
export interface CurveBuffer { readonly curve: AnimCurve; readonly capturedAt: number }

export interface AutosaveSlotInfo {
  readonly id: string;                                            // 'as_' + 16 base62, one per page load
  readonly projectName: string;
  readonly savedAt: number;                                       // ms since epoch
  readonly characters: number;
  readonly clips: number;
  readonly bytes: number;                                         // snapshot JSON + new asset bytes
  readonly appVersion: string;
  readonly schemaVersion: number;
}
export interface AutosaveStatus {
  readonly enabled: boolean;                                      // false: storage unavailable or prefs off
  readonly slot: string | null;
  readonly lastSavedAt: number | null;
  readonly pending: boolean;
  readonly error: string | null;
}

// ---------- session (U state) ----------
export type UiDialog = 'open' | 'import' | 'export' | 'shortcuts' | 'about' | 'firstRun' | 'preferences'
  | 'recovery';                                                   // M2a

export interface FeetPins { readonly character: CharacterId; readonly pins: readonly FootPin[] }
export interface SessionState {
  readonly user: UserId;
  readonly projectName: string;
  readonly dirty: boolean;                                        // unsaved document changes
  readonly activeCharacter: CharacterId | null;
  readonly activeClip: Readonly<Record<CharacterId, ClipId>>;
  readonly selection: Selection;
  readonly time: TimeState;
  readonly tools: ToolState;
  /** Unkeyed edits of keyed channels (ARCHITECTURE §4.5); ControlIds are globally unique. */
  readonly overrides: ReadonlyMap<ControlId, ChannelValues>;
  readonly hiddenControls: ReadonlySet<ControlId>;                // per-user visibility overrides
  readonly showSecondary: boolean;                                // default false
  readonly viewportLayout: ViewportLayout;                        // default 'split'
  readonly maximizedPane: string | null;
  readonly hoveredPanel: { readonly kind: PanelKind; readonly paneId: string | null } | null;
  readonly hoverControl: ControlId | null;                        // Outliner hover → viewport pre-highlight (v0.3 integration, WP-9 R-2)
  readonly clipboard: { readonly pose: PoseClipboard | null; readonly keys: KeyClipboard | null };
  readonly feetPins: FeetPins | null;
  readonly dialog: UiDialog | null;
  readonly busy: { readonly label: string; readonly progress: number | null } | null;
  readonly curveBuffers: ReadonlyMap<CurveId, CurveBuffer>;       // M2a
  readonly autosave: AutosaveStatus;                              // M2a
  readonly recovery: readonly AutosaveSlotInfo[];                 // M2a: orphaned slots found at start
}
export type SessionStore = StoreApi<SessionState>;

// ---------- preferences (P state) ----------
export type NavProfile = 'maya' | 'trackpad' | 'mayaOneButton';   // mayaOneButton: M1-stretch
export interface Prefs {
  readonly version: 1;
  readonly firstRunDone: boolean;
  readonly navProfile: NavProfile;                                // default: 'trackpad' on macOS, else 'maya'
  readonly spaceBehaviour: 'maya' | 'play';                       // default 'maya' (tap maximize, hold radial)
  readonly keymapOverrides: readonly KeyBinding[];
  readonly defaultTangents: { readonly in: TangentType; readonly out: TangentType };   // 'auto'/'auto'
  readonly autoKey: boolean;                                      // default false
  readonly autoKeyMode: 'keyed-only' | 'all';                     // default 'keyed-only' (Maya)
  readonly graphHandles: 'selected' | 'all';                      // default 'selected'
  readonly moveSpace: 'object' | 'world';                         // default 'world'
  readonly rotateSpace: ManipSpace;                               // default 'object'; remembered per user
  readonly reduceOnImport: 'auto' | 'always' | 'never';           // default 'auto' (> 0.5 keys/frame)
  readonly uiScale: number;                                       // 1
  // M2a (version stays 1; missing fields take defaults on load)
  readonly autoRigIk: { readonly legs: boolean; readonly arms: boolean };          // default { legs: true, arms: true }
  readonly ikFkVisibility: 'hide' | 'ghost';                                      // default 'hide' ('ghost' is stretch)
  readonly ikFkSwitchKey: IkFkKeyMode;                                            // default 'auto'
  readonly tweenOvershoot: boolean;                                               // default false
  readonly arrowKeys: 'pickWalk' | 'frames';                                       // default 'pickWalk' (Q-UI-2)
  readonly virtualSlider: { readonly degPerPx: number; readonly metresPerPx: number; readonly unitsPerPx: number;
    readonly viewportMmb: boolean };                                                // 0.5, 0.01, 0.01, true (§5.18)
  readonly exportReduce: { readonly enabled: boolean } & ExportReduceSpec;          // dialog default; enabled true
  readonly autosave: { readonly enabled: boolean; readonly delayMs: number; readonly maxIntervalMs: number };       // true, 2000, 30000
}
export type PrefsStore = StoreApi<Prefs>;

// ---------- operators ----------
export type OperatorId = `${string}.${string}`;
export type OperatorCategory = string;                            // 'file' | 'edit' | 'select' | 'key' | 'channel' | 'pose' | 'time' | 'graph' | 'clip' | 'view' | 'rig' | 'ui' | …
export type PollResult = true | { readonly ok: false; readonly reason: string };
export interface RunContext { readonly panel?: PanelKind; readonly paneId?: string }
export interface OperatorContext {
  readonly app: EditorApp;
  readonly panel: PanelKind | null;
  readonly paneId: string | null;
}
export interface ApplyContext extends OperatorContext {
  /** The operator's single transaction (flags.undo) or null. Calling app.run inside apply throws EkzaError('nested-run'). */
  readonly tx: Tx | null;
}
/**
 * Operators run in two phases (§4.11.0): `prepare` (async; I/O, parsing, hashing, `store.open`, app.run of
 * other operators for dispatchers; no document writes) then `apply` (sync; for flags.undo the runner wraps it
 * in exactly one store.transact and records one history step).
 */
export interface OperatorDef<A = void, R = void, P = void> {
  readonly id: OperatorId;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly category: OperatorCategory;
  readonly scope: KeyScope;
  readonly flags?: {
    readonly undo?: boolean;                                      // apply runs inside one transaction
    readonly internal?: boolean;                                  // hidden from menus and palette
    readonly structural?: boolean;                                // rewrites many records (fps change); M3: needs an exclusive claim
  };
  undoLabel?(args: A): string;
  /** v0.3 integration (WP-7a): consecutive runs with the same key within `ms` merge into one step (§4.11.0 rule 7). */
  coalesce?(args: A): { readonly key: string; readonly ms: number } | null;
  poll?(ctx: OperatorContext, args: A): PollResult;
  prepare?(ctx: OperatorContext, args: A): Promise<P> | P;
  apply(ctx: ApplyContext, args: A, prepared: P): R;
}
export type OperatorResult<R = unknown> =
  | { readonly status: 'finished'; readonly value: R }
  | { readonly status: 'cancelled'; readonly reason: string }
  | { readonly status: 'failed'; readonly error: { readonly code: string; readonly message: string } };
export interface OperatorRegistry {
  register<A, R, P>(def: OperatorDef<A, R, P>): Disposer;
  get(id: string): OperatorDef<unknown, unknown, unknown> | undefined;
  list(): readonly OperatorDef<unknown, unknown, unknown>[];
  poll(id: string, ctx?: RunContext, args?: unknown): PollResult;
}
export type OperatorArgs<K extends keyof OperatorMap> = OperatorMap[K]['args'];
export type OperatorReturn<K extends keyof OperatorMap> = OperatorMap[K]['result'];
/** `args` may be omitted when the operator's args type is or includes `void`. */
export type OperatorRunArgs<K extends keyof OperatorMap> = void extends OperatorArgs<K>
  ? [args?: OperatorArgs<K>, ctx?: RunContext]
  : [args: OperatorArgs<K>, ctx?: RunContext];

// ---------- keymaps ----------
/** Physical key (KeyboardEvent.code). `mod` = Ctrl on Windows/Linux, Cmd on macOS. */
export interface Chord {
  readonly code: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;                                        // literal Ctrl (rare; mac-only chords)
}
export type KeyTrigger = 'press' | 'tap' | 'hold';
export interface KeyBinding {
  readonly chord: Chord;
  readonly op: OperatorId;
  readonly args?: unknown;
  readonly scope: KeyScope;
  readonly trigger?: KeyTrigger;                                  // default 'press'
}
export interface KeyInput {
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
}
export interface KeymapManager {
  readonly platform: 'mac' | 'other';
  readonly preset: 'maya';
  bindings(): readonly KeyBinding[];                              // preset + overrides
  /** scopes: most specific first, e.g. ['graph', 'global']. */
  resolve(input: KeyInput, scopes: readonly KeyScope[], trigger: KeyTrigger): KeyBinding | null;
  isTapHoldKey(code: string): boolean;                            // 'Space' in the MVP
  label(chord: Chord): string;                                    // 'Ctrl+Shift+S' / '⇧⌘S'
  setOverrides(bindings: readonly KeyBinding[]): void;
}

// ---------- tools ----------
export interface ToolPointerEvent {
  readonly panel: PanelKind;
  readonly paneId: string | null;
  readonly x: number;                                             // CSS px relative to the pane/canvas
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly shift: boolean; readonly alt: boolean; readonly mod: boolean; readonly ctrl: boolean;
  readonly pointerType: 'mouse' | 'pen' | 'touch';
  readonly timeStamp: number;
  readonly detail: number;                                        // click count (double-click = 2)
}
export interface ToolWheelEvent {
  readonly panel: PanelKind; readonly paneId: string | null;
  readonly x: number; readonly y: number;
  readonly deltaX: number; readonly deltaY: number;               // pixels (deltaMode normalized)
  readonly shift: boolean; readonly alt: boolean; readonly mod: boolean; readonly ctrl: boolean;
}
export interface ToolKeyEvent { readonly type: 'down' | 'up'; readonly code: string; readonly shift: boolean; readonly alt: boolean; readonly mod: boolean }
/** Handlers return true when the event was consumed. */
export interface ToolInstance {
  activate?(): void;
  deactivate?(): void;
  pointerDown?(e: ToolPointerEvent): boolean;
  pointerMove?(e: ToolPointerEvent): boolean;
  pointerUp?(e: ToolPointerEvent): boolean;
  wheel?(e: ToolWheelEvent): boolean;
  key?(e: ToolKeyEvent): boolean;
  cancel?(): void;                                                // Esc / blur during a drag: cancel the gesture
  cursor?(): string | null;
}
export interface ToolDef<Host = unknown> {
  readonly id: ToolId;
  readonly panel: PanelKind;
  readonly label: string;
  readonly icon?: string;
  create(app: EditorApp, host: Host): ToolInstance;
}
export interface ToolRegistry {
  register<H>(def: ToolDef<H>): Disposer;
  get(panel: PanelKind, id: ToolId): ToolDef | undefined;
  list(panel: PanelKind): readonly ToolDef[];
}

// ---------- contribution registries (ADR 0008) ----------
export interface Registry<T extends { readonly id: string }> {
  register(def: T): Disposer;
  get(id: string): T | undefined;
  list(): readonly T[];
  subscribe(listener: () => void): Disposer;
}
export interface ImporterDef {
  readonly id: string;                                            // 'gltf-model', 'vrma', 'ekzanim'
  readonly label: string;
  readonly extensions: readonly string[];                         // lowercase, without dot: ['glb', 'vrm']
  /** Content sniffing when the extension is ambiguous (e.g. a .glb that is animation-only). */
  sniff?(name: string, bytes: Uint8Array): boolean;
  readonly op: OperatorId;                                        // receives { name, bytes }
}
export interface ExporterDef {
  readonly id: ExportKind;
  readonly label: string;
  readonly extension: (app: EditorApp, req: ExportRequest) => string;   // 'vrm' | 'glb' | 'vrma'
  poll(app: EditorApp, req: ExportRequest): PollResult;
  /** Async, no document writes. */
  run(app: EditorApp, req: ExportRequest): Promise<readonly ExportArtifact[]>;
}
export interface MenuItemDef {
  readonly id: string;
  readonly menu: string;                                          // 'file' | 'edit' | … | 'graph.curves' | 'timeline.context'
  readonly op: OperatorId;
  readonly args?: unknown;
  readonly group: string;
  readonly order: number;
  readonly label?: string;                                        // default: operator label
}
export type Contribution =
  | { readonly kind: 'operator'; readonly def: OperatorDef<unknown, unknown, unknown> }
  | { readonly kind: 'tool'; readonly def: ToolDef }
  | { readonly kind: 'keymap'; readonly bindings: readonly KeyBinding[] }
  | { readonly kind: 'importer'; readonly def: ImporterDef }
  | { readonly kind: 'exporter'; readonly def: ExporterDef }
  | { readonly kind: 'exportProfile'; readonly def: ExportProfileDef }
  | { readonly kind: 'menu'; readonly def: MenuItemDef };

// ---------- services (injected by the host) ----------
/** Content-addressed blobs (research 06 §10.1). get/has are async so a remote store fits later. */
export interface AssetStore {
  put(bytes: Uint8Array, meta: { readonly name: string; readonly ext: AssetRecord['ext']; readonly role: AssetRecord['role'] }): Promise<AssetRecord>;
  /** Verifies SHA-256 and size; throws EkzaError('asset-missing') or EkzaError('asset-corrupt'). */
  get(id: AssetId): Promise<Uint8Array>;
  has(id: AssetId): Promise<boolean>;
  /** Synchronous cache read; undefined when not resident. */
  peek(id: AssetId): Uint8Array | undefined;
  ids(): readonly AssetId[];
}
export interface FileService {
  download(fileName: string, bytes: Uint8Array, mime: string): void;
}
export interface ClipboardService {
  writeText(text: string): Promise<void>;
  readText(): Promise<string | null>;
}
export interface Notifier {
  toast(t: { readonly kind: 'info' | 'success' | 'warning' | 'error'; readonly text: string;
             readonly action?: { readonly label: string; readonly op: OperatorId; readonly args?: unknown } }): void;
}
/** Opaque display model (three.js objects live in io/three + viewport; editor-core never touches them). */
export interface DisplayModel { readonly kind: 'three'; readonly handle: unknown; dispose(): void }
export interface ModelLoader {
  /** Must be called with the WebGLRenderer before the first load (KTX2 support detection). */
  setRenderer(renderer: unknown): void;
  load(container: GlbContainer, skeleton: SkeletonDesc): Promise<DisplayModel>;
}
export interface PrefsStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface EditorServices {
  readonly assets: AssetStore;
  readonly files: FileService;
  readonly clipboard: ClipboardService;
  readonly notify: Notifier;
  readonly models: ModelLoader | null;                            // null in Node tests
  readonly validate: ((bytes: Uint8Array) => Promise<ValidationReport>) | null;
  readonly storage: PrefsStorage | null;                          // null: preferences are not persisted
  readonly samplesPath?: string;                                  // base URL of the bundled samples, default '/samples/' (v0.3 integration, WP-8 R-2)
  readonly autosave?: AutosaveStore | null;                       // M2a: null or absent = autosave off (Node, blocked storage)
}

/** M2a: content-addressed autosave slots (IndexedDB in the browser; null in Node). */
export interface AutosaveStore {
  /** Claims a slot for this page (Web Lock held until unload); returns its id. */
  open(): Promise<string>;
  write(slot: string, data: { readonly snapshotJson: string; readonly assets: readonly AssetRecord[];
    readonly info: Omit<AutosaveSlotInfo, 'id' | 'bytes'> }, readAsset: (id: AssetId) => Promise<Uint8Array>): Promise<{ readonly bytes: number }>;
  /** Slots whose page is gone (lock not held, or heartbeat older than 20 s without Web Locks). */
  listOrphans(): Promise<readonly AutosaveSlotInfo[]>;
  read(slot: string): Promise<{ readonly snapshot: unknown; readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }> } | null>;
  remove(slot: string): Promise<void>;
}

// ---------- characters and evaluation ----------
export interface CharacterRuntime {
  readonly id: CharacterId;
  readonly asset: AssetId;
  readonly container: GlbContainer;
  readonly skeleton: SkeletonDesc;
  readonly program: RigProgram;                                   // recompiled on structural rig change
  readonly channels: ChannelBuffer;
  readonly pose: PoseBuffers;                                     // pose at the character's current clip frame
  readonly display: DisplayModel | null;                          // set asynchronously ('display' event)
  sampler(clip: ClipId): ClipSampler;
}
export interface CharacterEvent { readonly type: 'added' | 'removed' | 'recompiled' | 'display'; readonly id: CharacterId }
export interface CharacterRegistry {
  get(id: CharacterId): CharacterRuntime | undefined;
  list(): readonly CharacterRuntime[];
  subscribe(listener: (e: CharacterEvent) => void): Disposer;
}

export type ChannelState = 'keyed-on-frame' | 'keyed' | 'changed' | 'locked' | 'static' | 'non-keyable';
export interface EvaluationService {
  readonly poseVersion: number;
  /** Evaluate dirty characters at the current scene frame. Returns true when any pose changed. Once per frame. */
  tick(): boolean;
  /** Re-entrant evaluation into a caller buffer (bake, plant feet, tests). `clipFrame` is in the clip's frames. */
  evaluateAt(character: CharacterId, clip: ClipId, clipFrame: Frame, out: PoseBuffers, opts?: { readonly withOverrides?: boolean }): void;
  /** Active clip frame of a character at the current scene frame (null without an active clip). */
  clipFrame(character: CharacterId): Frame | null;
  /** Current channel values (curves ⊕ overrides) of a control at its character's clip frame, all 9 TRS channels. */
  channelValues(control: ControlId): Readonly<Record<'tx' | 'ty' | 'tz' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz', number>>;
  channelState(control: ControlId, channel: ChannelId): ChannelState;
  compiledCurve(curve: CurveId): CompiledAnimCurve;
  subscribe(listener: (e: { readonly poseVersion: number; readonly characters: readonly CharacterId[] }) => void): Disposer;
  /** M2a: value of any channel (TRS or '@attr') at the control's current clip frame, curves ⊕ overrides. */
  channelValue(control: ControlId, channel: ChannelId): number;
  /** M2a: every custom attribute of the control by name (without '@'). */
  attrValues(control: ControlId): Readonly<Record<string, number>>;
  /** M2a: evaluated ikFk of a limb of the character (null without that limb). */
  ikFk(character: CharacterId, limb: LimbId): number | null;
}

export interface PlaybackClock {
  /** Called once per animation frame with the rAF timestamp; updates session time; returns true if time changed. */
  advance(nowMs: number): boolean;
  readonly running: boolean;
}

// ---------- editor history (ADR 0013) ----------
export interface OverrideDelta {
  readonly character: CharacterId;
  readonly clip: ClipId;
  readonly clipFrame: Frame;
  readonly before: ReadonlyMap<ControlId, ChannelValues>;         // only the controls this step changed
  readonly after: ReadonlyMap<ControlId, ChannelValues>;
}
export interface HistoryStep {
  readonly id: number;
  readonly label: string;
  readonly docTxId: string | null;                                // the document UndoEntry this step owns
  readonly overrides: OverrideDelta | null;
  readonly coalesceKey?: string;
  readonly at: number;                                            // ms (coalescing window)
}
export interface HistoryResult {
  readonly label: string;
  readonly doc: UndoResult | null;
  readonly overridesRestored: boolean;
  readonly warnings: readonly string[];
}
export interface EditorHistory {
  canUndo(): boolean;
  canRedo(): boolean;
  peekUndo(): HistoryStep | null;
  peekRedo(): HistoryStep | null;
  undo(): HistoryResult | null;
  redo(): HistoryResult | null;
  /** Called by the operator runner and the gesture helpers; clears the redo stack. */
  record(step: Omit<HistoryStep, 'id' | 'at'>): void;
  /** Drop override parts (frame change, clip switch, file.new/open); steps left empty are removed. */
  dropOverrides(where: { readonly character?: CharacterId; readonly clip?: ClipId; readonly controls?: readonly ControlId[] }): void;
  clear(): void;
  subscribe(listener: () => void): Disposer;
}

// ---------- edit kernel (shared by operators, tools and panels; §4.11.0) ----------
export interface ChannelEdit { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }
export type KeyPolicy = 'auto' | 'force' | 'none';
export interface ChannelEditResult {
  readonly keyed: number;
  readonly statics: number;
  /** Override values to merge into session.overrides after the write (keyed channels edited without keying). */
  readonly overrides: ReadonlyMap<ControlId, ChannelValues>;
  readonly skipped: readonly { readonly control: ControlId; readonly channel: ChannelId; readonly reason: 'locked' | 'non-keyable' }[];
}
/** One interactive edit (manipulator drag, Channel Box scrub): preview + overrides + auto-key on commit. */
export interface ChannelEditGesture {
  readonly active: boolean;
  update(edits: readonly ChannelEdit[]): void;
  commit(): void;
  cancel(): void;
}
export interface KeyEditOptions {
  readonly snap: boolean;                                         // integer frames
  /** false while dragging (clamp before neighbours); true for the final update before commit (delete collided keys). */
  readonly resolveCollisions: boolean;
  readonly ripple?: boolean;                                      // M2a §5.11; default false
  readonly retimeBreakdowns?: boolean;                            // M2a §5.12; default true
}
/** M2a: one key-editing drag (Graph Editor, Dope Sheet, time slider): preview, once-per-frame updates, one history step. */
export interface KeyEditGesture {
  readonly active: boolean;
  /** Replaces the pending edit; applied at the next `flushScheduled` on top of committed state. */
  update(edit: (tx: Tx) => void): void;
  /** Applies `final` immediately (callers pass resolveCollisions: true), commits ONE transaction, records ONE step. */
  commit(final: (tx: Tx) => void, meta?: { readonly label?: string }): ChangeBatch | null;
  cancel(): void;
}
export interface KeyEditResult { readonly moved: number; readonly deleted: readonly KeyId[] }

// ---------- the kernel object ----------
export interface EditorApp {
  readonly store: DocumentStore;
  readonly session: SessionStore;
  readonly prefs: PrefsStore;
  readonly operators: OperatorRegistry;
  readonly tools: ToolRegistry;
  readonly keymap: KeymapManager;
  readonly importers: Registry<ImporterDef>;
  readonly exporters: Registry<ExporterDef>;
  readonly exportProfiles: Registry<ExportProfileDef>;
  readonly menus: Registry<MenuItemDef>;
  readonly characters: CharacterRegistry;
  readonly evaluation: EvaluationService;
  readonly playback: PlaybackClock;
  readonly history: EditorHistory;
  readonly services: EditorServices;
  /** Typed operator call; `args` may be omitted for operators whose args type includes `void`. */
  run<K extends keyof OperatorMap>(id: K, ...rest: OperatorRunArgs<K>): Promise<OperatorResult<OperatorReturn<K>>>;
  /** Untyped call for keymaps, menus, plugins and the test API. */
  runUntyped(id: string, args?: unknown, ctx?: RunContext): Promise<OperatorResult<unknown>>;
  /** One registration path for built-ins and extensions (ADR 0008). */
  contribute(contribution: Contribution): Disposer;
  /** Request one animation frame (wired by the editor to R3F `invalidate`). */
  requestFrame(): void;
  setFrameRequester(fn: () => void): void;
  /**
   * M2a (M-1): run `task` once before the next frame's evaluation; a later call with the same key replaces the
   * pending task. Without a frame requester (Node) the task runs synchronously.
   */
  scheduleBeforeFrame(key: string, task: () => void): void;
  /** Runs every pending task now, in scheduling order (the frame loop's first step; pointerup; tests). */
  flushScheduled(): void;
  dispose(): void;
}
