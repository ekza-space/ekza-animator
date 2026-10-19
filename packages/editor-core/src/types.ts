// Contract file: MVP-SPEC §4.5 with the M2A-SPEC §4.5 and M6A-SPEC §4.6 additions, copied verbatim (shapes are normative;
// change the spec first). M6a functions and constants (`meshOperator`, `meshSetOperator`, `WORKSPACE`) live in
// implementation modules (§4 placement rule).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { StoreApi } from 'zustand/vanilla';
import type { AnimCurve, CompiledAnimCurve, Disposer, Frame, Handle, ParamDef, ParamValues, Quat, TangentType,
  Vec3 } from '@ekza-animator/anim-core';
import type { AssetId, AssetRecord, CameraId, ChangeBatch, ChannelId, ChannelValues, CharacterId, ClipId, ControlId,
  CurveId, DocumentStore, GroupId, KeyId, MeshId, MeshRef, Tx, UndoResult, UserId } from '@ekza-animator/doc';
import type { ComponentKind, ComponentSelection, DirtySet, EditMesh, ElementRemap, FalloffCurve, HiddenSet, MeshData,
  MeshOp, MeshSetOp, Normals, OpFrame, OpResult, OpWarning, Refusal, SymmetryAxis, SymmetryMap,
  Triangulation } from '@ekza-animator/mesh-core';   // type-only: no kernel code is bundled
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
  readonly objects: readonly SceneObjectId[];                    // M6a, changed (additive): lead = last
}
export interface SelectionMask { readonly controls: boolean; readonly joints: boolean; readonly meshes: boolean;
  readonly groups: boolean }                                      // M6a, changed (additive)
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
  // ---------- M6a (M6A-SPEC §4.6), changed ----------
  // Per-pane flags are remembered **per workspace** (B9: the ViewportManager's pane memory is keyed
  // `<workspace>:<paneId>`), so Model's 'colours' shading never shows in Animate's `pane-persp`. Defaults below.
  readonly shading: Shading;          // Animate 'lit' (= today's look), Model 'colours'
  readonly wireOnShaded: boolean;     // Animate false, Model true
  readonly flat: boolean;             // Animate false, Model true (display only; hard edges are mesh data)
  readonly cull: boolean;             // false
  readonly components: boolean;       // true
  readonly normals: 'off' | 'face' | 'vertex' | 'both';   // 'off'
  readonly faceOrientation: boolean;  // false
  readonly triangulation: boolean;    // false
  readonly hardEdges: boolean;        // Model true
  readonly polyCount: boolean;        // Model true
  readonly meshCheck: boolean;        // true while the Mesh Check panel is visible
  readonly symmetryPlane: boolean;    // true
  readonly dimUnhilited: boolean;     // false
  readonly imagePlanes: boolean;      // true
}
export type Shading = 'wire' | 'shaded' | 'colours' | 'lit';
export type ViewportLayout = 'single' | 'split' | 'quad';
/** Manipulator handles; gimbal rings reuse rx/ry/rz (axis = channel). */
export type ManipHandle = 'tx' | 'ty' | 'tz' | 'txy' | 'tyz' | 'txz' | 'tview' | 'rx' | 'ry' | 'rz' | 'rview'
  | 'sx' | 'sy' | 'sz' | 'suniform' | 'pivot';   // M6a, changed: Scale tool, pivot handle

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
export const VIEWPORT_TOOL = { select: 'select', move: 'move', rotate: 'rotate', scale: 'scale', multiCut: 'multiCut',
  insertLoop: 'insertLoop', targetWeld: 'targetWeld', slide: 'slide', paint: 'paint', extrude: 'extrude' } as const;   // M6a, changed
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
  /** Fix round 1: the session's active character and clips at the write; recovery returns to them. Older slots
   *  lack them (recovery then opens each character's first clip). */
  readonly activeCharacter?: CharacterId | null;
  readonly activeClip?: Readonly<Record<CharacterId, ClipId>>;
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
  | 'recovery'                                                    // M2a
  | 'makeEditableReport' | 'imagePlaneImport';                    // M6a, changed (additive)

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
  // ---------- M6a (M6A-SPEC §4.6), changed (additive) ----------
  readonly workspace: WorkspaceId; readonly lastRun: LastRun | null;
  readonly model: ModelSessionState;
  /** Per-workspace viewport layout: `workspace.set` stores the leaving workspace's `viewportLayout`/`maximizedPane`
   *  here and restores the entered one's (Model default: quad, `pane-persp` maximized), so Animate's are untouched. */
  readonly workspaceViews: Readonly<Record<string, { readonly layout: ViewportLayout; readonly maximizedPane: string | null }>>;
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
  // M6a (M6A-SPEC §4.6; version stays 1; missing fields take defaults on load)
  readonly lastWorkspace: WorkspaceId;                   // 'animate'
  readonly modeling: {
    readonly primitiveDefaults: 'low-poly' | 'maya';     // 'low-poly'
    readonly numericCapture: 'auto' | 'explicit';        // 'auto'
    readonly undoSelection: Readonly<Record<string, boolean>>;   // { model: true, animate: false }
    readonly undoBudgetMB: number;                       // 256
    readonly journalBudgetMB: number;                    // 64
    readonly symmetryTolerance: number;                  // 0.001 (m)
    readonly gridStep: number;                           // 0.1 (m)
    readonly increments: { readonly move: number; readonly rotate: number; readonly scale: number };   // 0.1, π/12, 0.1
    readonly vertexSnapRadiusPx: number;                 // 12
    readonly multiCutSnapStep: number;                   // 0.25
    readonly optionDefaults: Readonly<Record<string, ParamValues>>;   // option boxes, per operator id
    readonly toolkitCollapsed: readonly string[];
    readonly paletteRecents: readonly string[];
    readonly convertOnModeSwitch: boolean;               // false
  };
}
export type PrefsStore = StoreApi<Prefs>;

// ---------- operators ----------
export type OperatorId = `${string}.${string}`;
export type OperatorCategory = string;                            // 'file' | 'edit' | 'select' | 'key' | 'channel' | 'pose' | 'time' | 'graph' | 'clip' | 'view' | 'rig' | 'ui' | …
export type PollResult = true | { readonly ok: false; readonly reason: string };
export interface RunContext { readonly panel?: PanelKind; readonly paneId?: string; readonly source?: RunSource;   // M6a, changed (additive)
  /** M6a (B0a addition, docs/wp-notes/m6a-contracts-foundation.md): the run comes from an auto-repeated keydown
   *  (`KeyboardEvent.repeat`); selection operators coalesce such runs (§5.6). */
  readonly repeat?: boolean }
export interface OperatorContext {
  readonly app: EditorApp;
  readonly panel: PanelKind | null;
  readonly paneId: string | null;
  /** M6a (B0a addition): the run context's source and repeat flag, for LastRun recording and selection coalescing. */
  readonly source?: RunSource;
  readonly repeat?: boolean;
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
    // M6a, changed (additive)
    readonly adjustable?: boolean; readonly repeatable?: boolean;
    /** A selection gesture: in workspaces with undoSelection it records a selection part (§5.6), never a doc step. */
    readonly selection?: boolean;
  };
  // ---------- M6a, changed (additive) ----------
  /** ADR 0016 D6: one source for the Last-op card, INPUTS, option boxes, palette prompts and the JSON schema. */
  readonly params?: readonly ParamDef[];
  /** Declared non-param arg keys the runner passes through `coerceArgs` untouched (`meshOperator` adds `meshes` and
   *  `kind`; `mesh.primitive.set` declares `mesh`; `imagePlane.import` declares `bytes`, …). Other unknown keys drop. */
  readonly extraArgs?: readonly string[];
  readonly tool?: ToolId;                      // G (non-repeatable) and Y re-activate it
  readonly workspaces?: readonly WorkspaceId[];   // menus and palette list it only there; poll is unaffected
  readonly aliases?: readonly string[];        // command-palette aliases (Blender names: 'Loop Cut', 'Knife', …)
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
  readonly preset: string;                                        // M6a, changed: registered preset id (only 'maya' ships)
  bindings(): readonly KeyBinding[];                              // preset + overrides
  /** scopes: most specific first, e.g. ['graph', 'global']. */
  resolve(input: KeyInput, scopes: readonly KeyScope[], trigger: KeyTrigger): KeyBinding | null;
  /** M6a, changed (§5.17): `Space` in every scope with any modifiers (as shipped); `KeyB` only with no modifiers and
   *  only when `scopes` contains 'model.viewport' (B0b); every other code is never deferred. */
  isTapHoldKey(code: string, scopes: readonly KeyScope[], mods: { readonly mod: boolean; readonly shift: boolean;
    readonly alt: boolean; readonly ctrl: boolean }): boolean;
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
export interface ToolKeyEvent { readonly type: 'down' | 'up'; readonly code: string; readonly shift: boolean; readonly alt: boolean; readonly mod: boolean;
  readonly ctrl: boolean; readonly repeat: boolean }   // M6a, changed (additive): literal Ctrl
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
  phase?(): ToolPhase; numeric?(): NumericTarget | null;          // M6a, changed (additive)
}
export interface ToolDef<Host = unknown> {
  readonly id: ToolId;
  readonly panel: PanelKind;
  readonly label: string;
  readonly icon?: string;
  create(app: EditorApp, host: Host): ToolInstance;
  // ---------- M6a, changed (additive) ----------
  readonly workspaces?: readonly WorkspaceId[];
  /** Metadata only (where menus and the Toolkit offer the tool). One ToolDef per id: the shipped `move`/`rotate` and
   *  the new `scale` branch on the component mode inside (B12a), never a second registration of the same id. */
  readonly modes?: readonly ComponentMode[];
  /** `KeyboardEvent.code`s the tool always receives first, idle or not (§5.17): transform tools X, V, J, D, B;
   *  Paint Colour KeyI, Enter. Placing/dragging tools also receive the reserved modal keys. */
  readonly keys?: readonly string[];
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
  readonly workspaces?: readonly WorkspaceId[]; readonly modes?: readonly ComponentMode[];   // M6a, changed
}
export type Contribution =
  | { readonly kind: 'operator'; readonly def: OperatorDef<unknown, unknown, unknown> }
  | { readonly kind: 'tool'; readonly def: ToolDef }
  | { readonly kind: 'keymap'; readonly bindings: readonly KeyBinding[] }
  | { readonly kind: 'importer'; readonly def: ImporterDef }
  | { readonly kind: 'exporter'; readonly def: ExporterDef }
  | { readonly kind: 'exportProfile'; readonly def: ExportProfileDef }
  | { readonly kind: 'menu'; readonly def: MenuItemDef }
  | { readonly kind: 'workspace'; readonly def: WorkspaceDef }
  | { readonly kind: 'markingMenu'; readonly def: MarkingMenuDef };   // M6a, changed

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
  readonly blobs?: BlobStore | null;                              // M6a, changed (additive): absent = an in-memory store
  /** M6a (B0a addition, §3 rule 8): the kernel debug switch of development and e2e builds; the kernel loader applies
   *  it (`setKernelDebug`) when the lazy kernel chunk loads. Absent = off (tests turn it on in their setup). */
  readonly kernelDebug?: boolean;
}

/** M2a: content-addressed autosave slots (IndexedDB in the browser; null in Node). */
export interface AutosaveStore {                // changed (M6a): slots carry their mesh blob closure (§5.20)
  /** Claims a slot for this page (Web Lock held until unload); returns its id. */
  open(): Promise<string>;
  /** The autosave store is the **single owner** of the IndexedDB `blobs` store: it writes the blobs of
   *  `blobs` that are missing, records them as the slot's set, and deletes blobs no slot lists in an idle pass. */
  write(slot: string, data: { readonly snapshotJson: string; readonly assets: readonly AssetRecord[];
    readonly info: Omit<AutosaveSlotInfo, 'id' | 'bytes'>; readonly blobs: readonly BlobId[] },
    readAsset: (id: AssetId) => Promise<Uint8Array>, readBlob: (id: BlobId) => Promise<Uint8Array>): Promise<{ readonly bytes: number }>;
  /** Slots whose page is gone (lock not held, or heartbeat older than 20 s without Web Locks). */
  listOrphans(): Promise<readonly AutosaveSlotInfo[]>;
  read(slot: string): Promise<{ readonly snapshot: unknown;
    readonly assets: ReadonlyMap<AssetId, { readonly record: AssetRecord; readonly bytes: Uint8Array }>;
    readonly blob: (id: BlobId) => Promise<Uint8Array | undefined> } | null>;
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
  readonly selection?: SelectionPart | null;                      // M6a, changed (additive)
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
  // ---------- M6a (ADR 0013 extended by ADR 0016 D12), changed (additive) ----------
  /** Records a selection-only step ('Select', 'Hide', 'Show'), coalescing by §5.6; clears redo in both EditorHistory
   *  and the doc (`UndoManager.clearRedo()`). A step with only a selection part is not empty: `isEmpty` and pruning
   *  keep it. Dropping a step that owns a doc entry (the 500-step limit included) evicts the doc entries up to it
   *  (`evictOldest`), so no doc entry outlives its step.
   *  `opts.repeat` (B0a addition): the part continues the previous gesture (an auto-repeated grow/shrink key, a
   *  continuous drag) and merges into the top step when it has the same kind and gesture. */
  recordSelection(part: SelectionPart, label: 'Select' | 'Hide' | 'Show', opts?: { readonly repeat?: boolean }): void;
  /** Steps leaving the history for good, oldest first. */
  onDrop(listener: (steps: readonly HistoryStep[], reason: HistoryDropReason) => void): Disposer;
  /** Drops the n oldest steps and their doc entries (UndoManager.evictOldest); fires onDrop(…, 'budget'). */
  dropOldest(n: number): void;
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
  // ---------- M6a (M6A-SPEC §4.6), changed (additive) ----------
  readonly workspaces: Registry<WorkspaceDef>;
  readonly markingMenus: Registry<MarkingMenuDef>;
  readonly meshes: MeshRuntimeRegistry;
  readonly components: ComponentSelectionService;
  readonly extrude: ExtrudeSessionApi;
  readonly capture: NumericCaptureApi;
  readonly blobs: BlobStore;
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

// ===================================== M6a (M6A-SPEC §4.6) =====================================

// ---------- workspaces ----------
export type WorkspaceId = 'model' | 'rig' | 'animate' | 'review' | (string & {});
export interface WorkspaceStatus { readonly glyph: 'done' | 'attention' | 'todo' | 'none'; readonly reasons: readonly string[] }
export interface WorkspaceDef {
  readonly id: WorkspaceId;
  readonly label: string;                      // 'Model', 'Rig & Skin', 'Animate', 'Review'
  readonly shortLabel: string;                 // below 1280 px: 'Mdl', 'Rig', 'Anim', 'Rev'
  readonly order: number;
  readonly enabled: boolean;
  readonly disabledReason?: string;            // tooltip of a disabled tab
  readonly keyScope: string | null;            // 'model'; null for Animate (today's scopes unchanged)
  readonly menus: readonly string[];           // menu-bar menu ids in order
  readonly statusGroups: readonly string[];    // status-line group ids in order
  readonly defaultTool: ToolId;
  readonly pickMask: SelectionMask;
  readonly timeline: boolean;
  readonly layout: string;                     // layout preset id ('animate', 'model-quad')
  status?(app: EditorApp): WorkspaceStatus;    // derived, cheap; read on human-speed changes only
}

// ---------- selection and session (U state) ----------
export type SceneObjectId = MeshId | GroupId;
export type ComponentMode = 'object' | ComponentKind;
export type SymmetryMode = 'off' | `${'object' | 'world'}-${SymmetryAxis}`;
export interface SymmetrySettings { readonly mode: SymmetryMode; readonly tolerance: number; readonly preserveSeam: boolean }
export interface SoftSelectSettings {
  readonly on: boolean; readonly radius: number;                 // metres (world)
  readonly falloff: 'volume' | 'surface';
  readonly curve: Exclude<FalloffCurve, object>;                 // preset name; custom curves are M6a-stretch
}
export type SelectionStyle = 'marquee' | 'drag' | 'tweak';       // 'drag' (paint select) is M6a-stretch
export type SelectionConstraint = 'off' | 'angle' | 'border' | 'loop' | 'ring' | 'shell';   // only 'off' in core
export type RunSource = 'keyboard' | 'menu' | 'marking-menu' | 'toolkit' | 'palette' | 'tool' | 'card' | 'api';
export interface ComponentCounts { readonly vertex: number; readonly edge: number; readonly face: number }
/** The last undoable run of an operator that declares `params` (`[]` allowed) or is flagged adjustable or repeatable
 *  (ADR 0016 D6; §5.7). */
export interface LastRun {
  readonly id: OperatorId;
  readonly label: string;
  readonly params: readonly ParamDef[];
  readonly args: ParamValues;                  // resolved: defaults, coercion, selection-bound values, nullables
  /** Component kind the run read its selection in (null: object-level). Adjust Last re-runs on the restored
   *  selection of this kind whatever the current mode (§5.7). */
  readonly kind: ComponentKind | null;
  readonly stepId: number;                     // the EditorHistory step the run recorded
  readonly docSeqAfter: number;                // store.version right after the run
  readonly paneId: string | null;
  readonly source: RunSource;
  readonly adjustable: boolean;
  readonly repeatable: boolean;
  readonly tool: ToolId | null;                // re-activated by G after a tool run or when not repeatable (and by Y)
  readonly targets: readonly MeshId[];
  readonly seed: string;                       // stepSeed for derived MeshSetOp ids (§3 rule 3)
  readonly context: { readonly symmetry: Readonly<Record<string, SymmetrySettings>>; readonly soft: SoftSelectSettings | null };
  readonly closed: string | null;              // why the card closed; null = live (§5.7)
}
export interface ExtrudeSessionState {
  readonly stepId: number;
  readonly meshes: readonly MeshId[];
  readonly frame: OpFrame;                     // world frame of the first region
  /** The session's args undo stack (§5.8): stack[0] = the extrude's first args; `index` = the args now applied. */
  readonly stack: readonly ParamValues[];
  readonly index: number;
  readonly manipSpace: 'local' | 'world';      // the extrude manipulator's local/world toggle (Maya)
}
export interface NumericCaptureState {
  readonly armed: 'drag' | 'keyboard-op' | null;
  readonly field: string | null;               // param being edited
  readonly text: string | null;                // entry buffer; null = not typing
}
export interface ModelSessionState {
  readonly componentMode: ComponentMode;                 // 'object'
  readonly lastComponentMode: ComponentKind;             // F8 target; 'vertex'
  /** Hilited meshes; kept (not drawn) while in object mode so the Last-op card can compare them at the next
   *  component entry (§5.6). */
  readonly hilite: readonly MeshId[];
  readonly components: { readonly version: number; readonly selected: ComponentCounts; readonly mirrored: ComponentCounts;
    readonly hidden: ComponentCounts };                  // mirrored = partners the symmetry expansion adds (HUD "+40 sym")
  readonly symmetry: ReadonlyMap<MeshId, SymmetrySettings>;   // remembered per mesh (absent = prefs default, 'off')
  readonly softSelect: SoftSelectSettings;               // { on: false, radius: 0.5, falloff: 'volume', curve: 'smooth' }
  readonly constraint: SelectionConstraint;              // 'off'
  readonly selectionStyle: SelectionStyle;               // 'marquee'
  readonly cameraBased: 'auto' | 'on' | 'off';           // 'auto' = on in shaded, off in wire and x-ray
  readonly backfaces: boolean;                           // false
  readonly snap: { readonly grid: boolean; readonly vertex: boolean; readonly increment: boolean };   // sticky toggles, all false
  readonly pivotEdit: boolean;
  readonly componentPivot: Vec3 | null;                  // pinned component pivot (world); null = selection centre
  readonly hiddenObjects: ReadonlySet<SceneObjectId>;
  readonly isolate: Readonly<Record<string, readonly SceneObjectId[] | null>>;   // per pane id
  readonly extrudeSession: ExtrudeSessionState | null;
  readonly capture: NumericCaptureState;
  readonly lastTool: ToolId | null;                      // Y
  readonly activeSwatch: string | null;                  // SwatchId (Palette panel, Paint Colour)
  readonly tweakHandle: ManipHandle | null;              // last-picked handle of the W/E/R tool (MMB rule, §5.15)
}

// ---------- operators (changed, additive) ----------
export type CompassSlot = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export interface MarkingMenuItem {
  readonly label?: string;                     // default: operator label
  readonly op?: OperatorId;
  readonly args?: unknown;
  readonly submenu?: readonly MarkingMenuItem[];
  readonly checked?: (app: EditorApp) => boolean;
  readonly disabledReason?: string;            // static "arrives later" items
}
export interface MarkingMenuDef {
  readonly id: string;                         // 'model.modes', 'model.tools', 'model.convert', 'model.options', 'model.merge', 'model.primitives'
  readonly trigger: { readonly button: 'rmb' | 'lmb'; readonly mods: 'none' | 'shift' | 'ctrl' | 'ctrl+shift'; readonly holdKey?: string } | { readonly key: string };
  readonly workspaces: readonly WorkspaceId[];
  readonly when: { readonly modes?: readonly ComponentMode[]; readonly over?: 'mesh' | 'empty' | 'any' };
  readonly slots: Partial<Record<CompassSlot, MarkingMenuItem>>;
  readonly list: readonly MarkingMenuItem[];
}

// ---------- tools (changed, additive) ----------
export type ToolPhase = 'idle' | 'hover' | 'placing' | 'dragging';
/** What a modal tool exposes to the numeric capture (§5.10). */
export interface NumericTarget {
  readonly fields: readonly ParamDef[];        // Tab order; `active` first by default
  readonly active: string;
  value(field: string): number;
  set(field: string, value: number): void;     // live preview, no document writes
  confirm(): void;                             // = LMB release / Enter
  cancel(): void;                              // = Esc
}

// ---------- editor history (changed, additive; ADR 0013 extended by ADR 0016 D12) ----------
export interface MeshSelectionSnapshot {
  readonly manifest: string | null;            // revision the indices belong to
  readonly kind: ComponentKind;
  readonly verts: Uint32Array; readonly edges: Uint32Array; readonly faces: Uint32Array;   // BitSet.encode() (tagged)
  readonly order: Uint32Array | null; readonly active: number;
}
export interface SelectionSnapshot {            // also the value of TxMeta.selectionBefore/After from M6a on
  readonly controls: readonly ControlId[];
  readonly objects: readonly SceneObjectId[];
  readonly componentMode: ComponentMode;
  readonly hilite: readonly MeshId[];
  readonly meshes: Readonly<Record<string, MeshSelectionSnapshot>>;   // hilited meshes only
}
export interface HideSnapshot {
  readonly objects: readonly SceneObjectId[];
  readonly meshes: Readonly<Record<string, { readonly manifest: string | null; readonly verts: Uint32Array;
    readonly edges: Uint32Array; readonly faces: Uint32Array }>>;
}
export type SelectionGesture = 'replace' | 'additive' | 'clear' | 'marquee' | 'loop' | 'convert' | 'grow' | 'shrink' | 'objects';
export type SelectionPart =
  | { readonly kind: 'select'; readonly gesture: SelectionGesture; readonly before: SelectionSnapshot; readonly after: SelectionSnapshot }
  | { readonly kind: 'hide'; readonly before: HideSnapshot; readonly after: HideSnapshot };
export type HistoryDropReason = 'limit' | 'clear' | 'budget' | 'redo-cleared';

// ---------- services ----------
export type BlobId = string;                    // lowercase sha256 hex
/** Content-addressed mesh chunks and manifests (ADR 0015 §3). Not AssetRecords. */
export interface BlobStore {
  put(bytes: Uint8Array): BlobId;              // sync: hashes, dedupes, keeps bytes resident
  get(id: BlobId): Promise<Uint8Array>;        // hash-verified; EkzaError('blob-missing' | 'blob-corrupt'); a copy the caller owns
  peek(id: BlobId): Uint8Array | undefined;    // the resident bytes, lent read-only (never mutate them; copy first)
  has(id: BlobId): boolean;                    // resident (the store has no other backing; autosave owns IndexedDB)
  /** Frees resident blobs not in `reachable` (mark-and-sweep, §5.20). Never call it inside a transaction or an
   *  emit loop (§5.20 sweep rule). */
  sweep(reachable: ReadonlySet<BlobId>): { readonly freed: number; readonly bytes: number };
  readonly residentBytes: number;
  ids(): readonly BlobId[];
  /** Blobs `put` since the last completed sweep: roots until the next completed batch (§5.20). */
  readonly fresh: ReadonlySet<BlobId>;
  /** Chunk closure of revisions (manifests + their chunks), from resident manifests; editor-core computes it so the
   *  browser autosave store never parses manifests. */
  closure(manifests: readonly BlobId[]): readonly BlobId[];
}

// ---------- mesh runtime (B7; ADR 0015 §5–§6) ----------
export type MeshRuntimeState = 'asset' | 'loading' | 'ready' | 'error';
export type MeshRuntimeEvent =
  | { readonly type: 'changed'; readonly dirty: DirtySet; readonly preview: boolean }
  | { readonly type: 'state'; readonly state: MeshRuntimeState }
  | { readonly type: 'rebuilt' };
/** The registry keeps one runtime for **every live mesh record with `data`** (§5.5 lifecycle). */
export interface MeshRuntime {
  readonly id: MeshId;
  /** 'asset' = data null (reserved, never written in M6a); 'loading' while the kernel chunk or non-resident blobs
   *  resolve; 'ready' = the revision's MeshData is resident; 'error' = a blob is missing or corrupt. */
  readonly state: MeshRuntimeState;
  readonly error: string | null;
  readonly ref: MeshRef | null;                // revision the mesh equals when no session is open
  /** Stored form of the current revision in 'ready' (open or closed): MeshSurface, export, HUD of closed meshes. */
  data(): MeshData | null;
  readonly isOpen: boolean;                    // edit links exist (open() … close())
  readonly mesh: EditMesh | null;              // non-null only while 'ready' and open
  readonly version: number;                    // bumps on every content change, previews included
  triangulation(): Triangulation;              // cached; incremental by dirty faces; works open or closed
  normals(): Normals;
  symmetry(): SymmetryMap | null;              // for the mesh's current SymmetrySettings; rebuilt after topology commits
  subscribe(listener: (e: MeshRuntimeEvent) => void): Disposer;
}
export interface MeshOpSession {
  readonly opId: string;
  readonly meshes: readonly MeshId[];
  readonly args: ParamValues;
  readonly results: ReadonlyMap<MeshId, OpResult | Refusal>;
  readonly active: boolean;
  update(args: ParamValues): void;             // OpResult.adjust fast path, else revert + re-run; no doc writes
  cancel(): void;                              // reverts every mesh; nothing written; no history step
}
export interface MeshCommitResult {
  readonly refs: ReadonlyMap<MeshId, MeshRef>;
  readonly selection: ReadonlyMap<MeshId, ComponentSelection>;
  readonly warnings: readonly OpWarning[];
  readonly resolvedArgs: ParamValues;
}
export interface MeshSetCommitResult {
  readonly created: readonly MeshId[]; readonly updated: readonly MeshId[]; readonly removed: readonly MeshId[];
  readonly warnings: readonly OpWarning[];
}
export interface MeshRuntimeRegistry {
  get(id: MeshId): MeshRuntime | undefined;
  /** Idempotent; builds edit links. From resident chunks (`BlobStore.peek`) it is synchronous; 'loading' only when
   *  chunks are not resident. Callers: B10 (entering a component mode, hilite changes), B7 (commitOp/commitSetOp open
   *  their targets for the run and close the ones that were closed before). */
  open(id: MeshId): MeshRuntime;
  /** Drops edit links and their caches only. The runtime, its MeshData, its journal and the last-op edge survive, so
   *  `edit.adjustLast` after leaving component mode stays synchronous. Callers: B10 (leaving component mode,
   *  un-hiliting). */
  close(id: MeshId): void;
  list(): readonly MeshRuntime[];
  /** Preview session (tools, card drags). `base: 'before-last'` previews an adjust-last re-run from the pre-op mesh. */
  beginOp(op: MeshOp, targets: readonly MeshId[], args: ParamValues, opts?: { readonly base?: 'current' | 'before-last';
    readonly selection?: ReadonlyMap<MeshId, ComponentSelection> }): MeshOpSession;
  readonly session: MeshOpSession | null;
  /** Inside an operator's apply (one transaction): commits the matching open session, else reverts it and runs the
   *  op; hashes dirty chunks (BlobStore.put), patches every target's `data` (two-phase, §5.5). Throws
   *  EkzaError('op-refused', reason) on a refusal (the runner reports 'failed', no step). */
  commitOp(tx: Tx, op: MeshOp, targets: readonly MeshId[], args: ParamValues, ctx: { readonly seed: string }): MeshCommitResult;
  /** MeshSetOp runner (§5.13): N ref patches, record creations and soft deletions in the same transaction. */
  commitSetOp(tx: Tx, op: MeshSetOp, inputs: readonly MeshId[], args: ParamValues, ctx: { readonly seed: string }): MeshSetCommitResult;
  /** A whole new revision for a record (create, Make editable, primitive regeneration, Freeze). */
  writeData(tx: Tx, id: MeshId, data: MeshData): MeshRef;
  readonly journalBytes: number;
  subscribe(listener: (id: MeshId, e: MeshRuntimeEvent) => void): Disposer;
}
/** Default targets: the hilited meshes with a selection of `kind`. `kind` defaults to the current component mode's
 *  kind; Adjust Last passes the recorded one (§5.7), so a re-run in object mode reads the restored face selection. */
export type MeshOpArgs = ParamValues & { readonly meshes?: readonly MeshId[]; readonly kind?: ComponentKind };
export interface MeshOpOutcome { readonly meshes: readonly MeshId[]; readonly warnings: readonly OpWarning[] }

// ---------- component selection service (B10) ----------
export interface ComponentSelectionService {
  readonly version: number;
  get(mesh: MeshId, kind?: ComponentKind): ComponentSelection;     // the mode's kind by default; empty when unknown
  set(mesh: MeshId, sel: ComponentSelection): void;                // no history (callers record)
  apply(mesh: MeshId, kind: ComponentKind, indices: ArrayLike<number>, mode: SelectMode): void;
  clear(mesh?: MeshId): void;
  hidden(mesh: MeshId): HiddenSet;
  setHidden(mesh: MeshId, hidden: HiddenSet): void;
  snapshot(meshes?: readonly MeshId[]): SelectionSnapshot;
  /** Restores; a mesh whose current revision differs from the snapshot's is skipped (and reported). */
  restore(snapshot: SelectionSnapshot): { readonly skipped: readonly MeshId[] };
  restoreHidden(snapshot: HideSnapshot): { readonly skipped: readonly MeshId[] };
  remap(mesh: MeshId, remap: ElementRemap): void;                 // after topology commits that return no selection
  subscribe(listener: (version: number) => void): Disposer;
}

// ---------- extrude session and numeric capture (B12b, B11) ----------
export interface AbsorbGesture {
  /** World-space delta about the session frame's pivot since the gesture began. */
  update(delta: { readonly translate?: Vec3; readonly rotate?: Quat; readonly scale?: Vec3 }): void;
  commit(): void;                              // one edit.adjustLast run
  cancel(): void;
}
export interface ExtrudeSessionApi {
  readonly state: ExtrudeSessionState | null;
  /** W/E/R and MMB drags on the cap call this first; null = no session (transform the components normally). The
   *  gesture converts from the tool's space for translate and rotate, and always from the session frame for scale
   *  (§5.8). */
  beginAbsorb(tool: 'move' | 'rotate' | 'scale' | 'mmb', space: 'world' | 'object' | 'component'): AbsorbGesture | null;
  /** Ends the session before the ending gesture reads the mesh (§5.8); `drop` applies the zero-drop rule. */
  end(reason: string, opts: { readonly drop: boolean }): void;
  /** `edit.undo`/`edit.redo` call these first while a session is open (§5.8 args stack): true = handled (one step
   *  back/forward through `stack` by `edit.adjustLast`), false = at the stack's end (undo then removes the extrude). */
  stepBack(): boolean;
  stepForward(): boolean;
  /** `T` (§5.7): reopens a session when `lastRun` is a live `mesh.extrude` whose result is still the selection. */
  reopen(): boolean;
  setManipSpace(space: 'local' | 'world'): void;
}
export interface NumericCaptureApi {
  readonly state: NumericCaptureState;
  arm(reason: 'drag' | 'keyboard-op', target: NumericTarget | 'last-run'): void;
  disarm(): void;
  /** Keyboard adapter hook (§5.10): true = consumed (the keymap is not consulted). */
  key(e: { readonly code: string; readonly key: string; readonly shift: boolean; readonly mod: boolean; readonly alt: boolean }): boolean;
  /** `T`: opens the Last-op card with the primary field focused. */
  openCard(): void;
}

