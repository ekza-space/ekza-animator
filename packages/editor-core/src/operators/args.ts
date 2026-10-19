// Contract file: MVP-SPEC §4.5 with the M2A-SPEC §4.5 and MCP-SPEC §4.10 additions, copied verbatim (shapes are
// normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Fps, Frame, InfinityMode, Quat, RotateOrder, TangentType, Vec3 } from '@ekza-animator/anim-core';
import type { CameraId, ChannelId, CharacterId, ClipId, ControlId, CurveId, DerivedFrom, DocSnapshot, KeyId,
  Redistributable, RootMotionMode } from '@ekza-animator/doc';
import type { ExportArtifact, ExportRequest } from '@ekza-animator/io';
import type { FootRollParams, LimbId, MirrorMode, ReduceSpec } from '@ekza-animator/rig';
import type { BodyPart, ChannelEditResult, ChannelRef, DisplayFlags, GraphViewMode, HistoryResult, IkFkKeyMode,
  KeyPartSelection, KeyPolicy, KeyTarget, LoopMode, ManipSpace, NavProfile, PaneCamera, PanelKind, PlaybackSpeed,
  Prefs, SelectionMask, SelectMode, ToolId, TweenMode, UiDialog, ViewportLayout } from '../types';

export type SampleId = 'seed-san' | 'polybot' | 'quaternius-ual';
export interface FileArgs { readonly name: string; readonly bytes: Uint8Array }
export interface ImportModelOptions {
  readonly clips: 'all' | 'none' | readonly number[];             // glTF animation indices
  readonly clipFps: Fps | 'source';                               // default 'source' (§4.11.6)
  readonly keyMode: 'source-times' | 'resample';                  // default per §4.11.6
  readonly eulerFilter: boolean;                                  // default true
  readonly reduce: ReduceSpec | null;                             // default per prefs.reduceOnImport
  readonly secondaryControls: boolean;                            // default true
}
export interface ImportAnimationOptions {
  readonly clipFps: Fps | 'source';
  readonly keyMode: 'source-times' | 'resample';
  readonly eulerFilter: boolean;
  readonly reduce: ReduceSpec | null;
  readonly hipsScale: 'auto' | number;
}
export interface ImportResult { readonly character: CharacterId; readonly clips: readonly ClipId[]; readonly warnings: readonly string[] }
export interface ClipsResult { readonly clips: readonly ClipId[]; readonly warnings: readonly string[] }
export interface CountResult { readonly count: number }
export type KeyChannels = 'all' | 'translate' | 'rotate' | 'scale' | 'attributes' | 'selected';   // changed: + 'attributes'
/** M2a §5.19: the body parts a 'bodyPart' key target groups controls into (re-exported for operator authors). */
export type { BodyPart };
export interface ClipSettingsArgs {
  readonly clip: ClipId;
  readonly fps?: Fps;
  readonly fpsMode?: 'keep-seconds' | 'keep-frames';
  readonly range?: { readonly start: Frame; readonly end: Frame };
  readonly sceneStart?: Frame;
  readonly loop?: boolean;
  readonly rootMotion?: RootMotionMode;
  readonly slot?: string | null;
  readonly contact?: Frame | null;
  readonly tags?: readonly string[];
  readonly provenance?: { readonly derivedFrom?: readonly DerivedFrom[]; readonly redistributable?: Redistributable };
}
export interface KeyFieldsArgs {
  readonly frame?: Frame;
  readonly value?: number;                                        // display units (degrees for rotations)
  readonly inAngleDeg?: number;
  readonly outAngleDeg?: number;
  readonly inWeight?: number;
  readonly outWeight?: number;
  readonly relative?: boolean;
}

// ---------- M-AI (MCP-SPEC §4.10): explicit-target operators ----------
export interface ChannelTarget { readonly control: ControlId; readonly channel: ChannelId }
export interface KeyWriteItem extends ChannelTarget {
  readonly frame: Frame; readonly value: number;                     // stored units
  readonly inType?: TangentType; readonly outType?: TangentType;     // default prefs.defaultTangents
  readonly breakdown?: boolean;
}
export interface SeamMetrics { readonly maxC0: number; readonly maxC1: number; readonly worst: readonly ChannelTarget[] }
export type AdjustPivot =
  | { readonly kind: 'rest' } | { readonly kind: 'mean' } | { readonly kind: 'rangeStart' }
  | { readonly kind: 'frame'; readonly frame: Frame } | { readonly kind: 'value'; readonly value: number };
/** M-AI stretch (MCP-SPEC §1.2, §6.12): the motion recipes of `pose.recipe`. Types only; no operator is registered. */
export type PoseRecipeName = 'wave' | 'nod' | 'headShake' | 'breathe' | 'idleSway' | 'lookAt' | 'walkCycleBlock';

export interface OperatorMap {
  // file
  'file.new': { args: void; result: void };
  'file.open': { args: FileArgs; result: void };                  // importer registry dispatch
  'file.openProject': { args: FileArgs; result: { readonly readOnly: boolean; readonly migratedFrom: number } };
  // changed (M-AI, D0): `activate` (default true = shipped behaviour) on the three import operators
  'file.importModel': { args: FileArgs & { readonly options?: Partial<ImportModelOptions>; readonly activate?: boolean }; result: ImportResult };
  'file.importAnimation': { args: FileArgs & { readonly character?: CharacterId; readonly options?: Partial<ImportAnimationOptions>;
    readonly activate?: boolean }; result: ClipsResult };
  'file.loadSample': { args: { readonly sample: SampleId; readonly options?: Partial<ImportModelOptions>; readonly activate?: boolean }; result: ImportResult };
  'file.save': { args: { readonly fileName?: string } | void; result: { readonly fileName: string; readonly bytes: number } };
  'file.saveAs': { args: { readonly fileName?: string } | void; result: { readonly fileName: string; readonly bytes: number } };
  'file.saveJson': { args: void; result: { readonly fileName: string; readonly bytes: number } };
  'file.export': { args: ExportRequest; result: readonly ExportArtifact[] };
  // edit
  'edit.undo': { args: void; result: HistoryResult | null };
  'edit.redo': { args: void; result: HistoryResult | null };
  'edit.copy': { args: void; result: void };                      // dispatch by panel (menu use)
  'edit.paste': { args: void; result: void };
  'edit.delete': { args: void; result: void };
  'edit.escape': { args: void; result: void };
  // select
  'select.controls': { args: { readonly ids: readonly ControlId[]; readonly mode: SelectMode }; result: void };
  'select.all': { args: void; result: void };
  'select.none': { args: void; result: void };
  'select.mirror': { args: void; result: void };
  'select.keys': { args: { readonly items: readonly { readonly key: KeyId; readonly parts?: Partial<KeyPartSelection> }[]; readonly mode: SelectMode }; result: void };
  'select.curveKeys': { args: { readonly curve: CurveId; readonly mode: SelectMode }; result: void };
  'select.channels': { args: { readonly refs: readonly ChannelRef[]; readonly mode: SelectMode }; result: void };   // v0.3 integration (WP-9 R-1)
  // key
  'key.set': { args: { readonly channels?: KeyChannels; readonly target?: KeyTarget; readonly breakdown?: boolean } | void; result: CountResult };   // changed (M2a)
  'key.deleteAtFrame': { args: void; result: CountResult };
  'key.toggleAutoKey': { args: void; result: void };
  // channel
  'channel.setValues': { args: { readonly edits: readonly { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }[]; readonly key?: KeyPolicy; readonly label?: string }; result: ChannelEditResult };
  'channel.toggleLock': { args: { readonly refs: readonly ChannelRef[]; readonly locked?: boolean }; result: void };
  // pose
  'pose.resetToRest': { args: { readonly controls?: readonly ControlId[] } | void; result: ChannelEditResult };
  'pose.copy': { args: void; result: void };
  'pose.paste': { args: { readonly mirrored?: boolean } | void; result: ChannelEditResult };
  'pose.mirror': { args: { readonly mode: MirrorMode }; result: ChannelEditResult };
  'pose.pinFeet': { args: { readonly sides?: readonly ('L' | 'R')[] } | void; result: void };
  'pose.unpinFeet': { args: void; result: void };
  'pose.plantFeet': { args: { readonly sides?: readonly ('L' | 'R')[] } | void; result: ChannelEditResult };
  // time (frames are active-clip frames unless unit is 'scene')
  'time.setFrame': { args: { readonly frame: Frame; readonly unit?: 'clip' | 'scene'; readonly carry?: boolean }; result: void };   // changed (M2a)
  'time.step': { args: { readonly delta: number }; result: void };
  'time.nextKey': { args: void; result: void };
  'time.prevKey': { args: void; result: void };
  'time.goToStart': { args: void; result: void };
  'time.goToEnd': { args: void; result: void };
  'time.togglePlay': { args: { readonly direction?: 1 | -1 } | void; result: void };
  'time.play': { args: { readonly direction?: 1 | -1 } | void; result: void };
  'time.stop': { args: void; result: void };
  'time.setPlaybackRange': { args: { readonly range: { readonly start: Frame; readonly end: Frame } | null }; result: void };
  'time.setLoop': { args: { readonly loop: LoopMode }; result: void };
  'time.setSpeed': { args: { readonly speed: PlaybackSpeed }; result: void };
  'time.selectBand': { args: { readonly band: { readonly start: Frame; readonly end: Frame } | null; readonly mode?: SelectMode }; result: CountResult };
  // graph (also used by the time slider on band-selected keys)
  'graph.tangent.set': { args: { readonly type: TangentType; readonly side?: 'both' | 'in' | 'out' }; result: void };
  'graph.tangent.break': { args: void; result: void };
  'graph.tangent.unify': { args: void; result: void };
  'graph.curve.setWeighted': { args: { readonly weighted: boolean }; result: void };
  'graph.tangent.lockWeight': { args: { readonly locked: boolean }; result: void };
  'graph.infinity.set': { args: { readonly pre?: InfinityMode; readonly post?: InfinityMode }; result: void };
  'graph.keys.setFields': { args: KeyFieldsArgs; result: void };
  /** `ripple` absent: `session.tools.ripple` when the focused panel is the Dope Sheet or the time slider, else false. */
  'graph.keys.move': { args: { readonly dFrames: number; readonly dValue: number; readonly ripple?: boolean }; result: CountResult };   // changed (M2a)
  'graph.keys.scale': { args: { readonly pivot: Frame; readonly factor: number; readonly ripple?: boolean;
    readonly valuePivot?: number; readonly valueFactor?: number }; result: CountResult };   // changed (M2a)
  'graph.keys.delete': { args: void; result: CountResult };
  'graph.key.insert': { args: { readonly curve: CurveId; readonly frame: Frame }; result: { readonly key: KeyId } };
  'graph.keys.keyCurves': { args: void; result: CountResult };
  'graph.keys.copy': { args: void; result: CountResult };
  /** `mode` absent: 'insert' when ripple is on and the focused panel is the Dope Sheet or the time slider, else 'merge' (§5.10). */
  'graph.keys.paste': { args: { readonly mode?: 'merge' | 'replace' | 'insert' } | void; result: CountResult };   // changed (M2a)
  'graph.eulerFilter': { args: void; result: CountResult };
  'graph.curves.simplify': { args: { readonly tolerance?: ReduceSpec } | void; result: { readonly before: number; readonly after: number; readonly maxError: number } };
  'graph.frame': { args: { readonly what: 'selection' | 'all' }; result: void };
  // clip
  'clip.new': { args: { readonly character?: CharacterId; readonly name?: string; readonly fps?: Fps;
    readonly range?: { readonly start: Frame; readonly end: Frame };
    readonly loop?: boolean; readonly activate?: boolean } | void;          // changed (M-AI): `loop`, `activate` (default true)
    result: { readonly clip: ClipId } };
  'clip.rename': { args: { readonly clip: ClipId; readonly name: string }; result: void };
  'clip.duplicate': { args: { readonly clip: ClipId; readonly name?: string; readonly activate?: boolean };   // changed (M-AI)
    result: { readonly clip: ClipId } };
  'clip.delete': { args: { readonly clip: ClipId }; result: void };
  'clip.setActive': { args: { readonly clip: ClipId }; result: void };
  'clip.setSettings': { args: ClipSettingsArgs; result: void };
  // view
  'view.layout': { args: { readonly layout: ViewportLayout }; result: void };
  'view.toggleMaximize': { args: { readonly paneId?: string; readonly panel?: PanelKind } | void; result: void };
  'view.frame': { args: { readonly what: 'selection' | 'all'; readonly paneId?: string }; result: void };
  'view.display.toggle': { args: { readonly flag: keyof DisplayFlags; readonly paneId?: string }; result: void };
  'view.lookThrough': { args: { readonly paneId: string; readonly camera: PaneCamera }; result: void };
  'view.copyViewToShot': { args: { readonly paneId: string; readonly cameraId?: CameraId }; result: { readonly cameraId: CameraId } };
  'view.toggleCameraLock': { args: { readonly cameraId?: CameraId; readonly paneId?: string } | void; result: void };
  'view.tool': { args: { readonly panel: PanelKind; readonly tool: ToolId }; result: void };
  'view.manipulatorSize': { args: { readonly delta: number }; result: void };
  'view.setManipSpace': { args: { readonly tool: 'move' | 'rotate'; readonly space: ManipSpace }; result: void };
  'view.setNavProfile': { args: { readonly profile: NavProfile }; result: void };
  'view.cameraRadial': { args: { readonly paneId?: string } | void; result: void };   // M1-stretch
  'view.camera.setSettings': { args: { readonly camera: CameraId; readonly fovY?: number; readonly near?: number; readonly far?: number; readonly aspect?: number | null }; result: void };   // v0.3 integration (WP-9 R-3), U
  'view.selectionMask': { args: { readonly mask: Partial<SelectionMask> }; result: void };   // v0.3 integration (WP-8 R-1)
  // rig
  'rig.setRotateOrder': { args: { readonly control: ControlId; readonly order: RotateOrder }; result: void };   // M1-stretch
  'rig.setControlSize': { args: { readonly control: ControlId; readonly size: number }; result: void };
  'rig.toggleSecondary': { args: void; result: void };
  // ui
  'ui.open': { args: { readonly dialog: UiDialog }; result: void };
  'ui.close': { args: void; result: void };
  // prefs and workspace (shell, v0.3 integration: WP-8 R-1)
  'prefs.set': { args: { readonly patch: Partial<Omit<Prefs, 'version'>> }; result: void };
  'workspace.reset': { args: void; result: void };
  'workspace.showPanel': { args: { readonly panel: PanelKind }; result: void };

  // ---------- M2a additions (M2A-SPEC §4.5, §4.9) ----------
  // rig
  'rig.addLimbIk': { args: { readonly character?: CharacterId; readonly limbs?: readonly LimbId[] } | void;
    result: { readonly added: readonly LimbId[]; readonly warnings: readonly string[] } };
  'rig.ikFk.switch': { args: { readonly limb: LimbId; readonly to: 'ik' | 'fk'; readonly match?: boolean;
    readonly key?: IkFkKeyMode; readonly character?: CharacterId }; result: ChannelEditResult };
  'rig.ikFk.match': { args: { readonly limb: LimbId; readonly side: 'ik' | 'fk'; readonly key?: boolean;
    readonly character?: CharacterId }; result: ChannelEditResult };
  /** `step` default: 'frames' for side 'fk', 'keys' for side 'ik' (§5.6). */
  // changed (M-AI, P1): `clip` (required for actor runs; user runs keep the active clip as default)
  'rig.ikFk.matchRange': { args: { readonly limb: LimbId; readonly side: 'ik' | 'fk';
    readonly range?: { readonly start: Frame; readonly end: Frame }; readonly step?: 'keys' | 'frames';
    readonly character?: CharacterId; readonly clip?: ClipId }; result: CountResult };
  'rig.setFootParams': { args: { readonly limb: 'leg.L' | 'leg.R'; readonly character?: CharacterId;
    readonly params: Partial<Pick<FootRollParams, 'heelBack' | 'ballFront' | 'toeFront' | 'innerWidth' | 'outerWidth' | 'breakAngle'>> };
    result: void };
  // select / key / pose
  'select.pickWalk': { args: { readonly direction: 'up' | 'down' | 'left' | 'right'; readonly add?: boolean }; result: void };
  'key.setTarget': { args: { readonly target: KeyTarget }; result: void };
  'key.toggleRipple': { args: { readonly ripple?: boolean } | void; result: void };
  'key.tween': { args: { readonly mode: TweenMode; readonly amount: number; readonly target?: 'frame' | 'keys';
    readonly breakdown?: boolean; readonly frames?: readonly Frame[] };       // changed (M-AI): `frames`
    result: CountResult };
  'key.convert': { args: { readonly to: 'breakdown' | 'key' }; result: CountResult };
  'pose.mirrorAnimation': { args: { readonly mode: MirrorMode; readonly offset?: 'none' | 'halfCycle';
    readonly controls?: readonly ControlId[] }; result: CountResult };
  // time
  /**
   * `at` (default: the active character's current clip frame; the menu-bar items pass none). `removeKeys` (default
   * false): with frames < 0, delete keys in (at, at + |frames|] instead of poll-failing (§5.9).
   */
  'time.insertTime': { args: { readonly at?: Frame; readonly frames: number; readonly target?: 'selected' | 'character';
    readonly removeKeys?: boolean }; result: CountResult };
  /**
   * Delete Time (§5.9): removes the frames of `range` (default: the time-slider band, else the current clip frame) and
   * their keys, as `time.insertTime {at: start − 1, frames: −(end − start + 1), removeKeys: true}`.
   */
  'time.deleteTime': { args: { readonly range?: { readonly start: Frame; readonly end: Frame };
    readonly target?: 'selected' | 'character' } | void; result: CountResult };
  // graph and dope sheet
  'graph.keys.copyTo': { args: { readonly dFrames: number }; result: CountResult };
  'graph.buffer.snapshot': { args: { readonly curves?: readonly CurveId[] } | void; result: CountResult };
  'graph.buffer.swap': { args: { readonly curves?: readonly CurveId[] } | void; result: CountResult };
  'graph.buffer.clear': { args: void; result: void };
  'graph.view.setMode': { args: { readonly mode: GraphViewMode | 'toggleNormalized' | 'toggleStacked' }; result: void };
  'dopeSheet.frame': { args: { readonly what: 'selection' | 'all' }; result: void };
  // file
  'file.recover': { args: { readonly slot: string }; result: { readonly readOnly: boolean } };
  'file.discardRecovery': { args: { readonly slot: string }; result: void };
  'file.autosaveNow': { args: void; result: { readonly slot: string; readonly bytes: number } | null };   // internal

  // ---------- M-AI additions (MCP-SPEC §4.10): explicit targets, stored units, `label` set by the tool layer ----------
  'key.write': { args: { readonly clip: ClipId; readonly keys?: readonly KeyWriteItem[];
    readonly poseAt?: { readonly controls: readonly ControlId[]; readonly frames: readonly Frame[]; readonly channels?: KeyChannels };
    readonly extendRange?: boolean; readonly label?: string };
    result: { readonly written: number; readonly curvesCreated: number; readonly rangeExtended: boolean;
      readonly hiddenByOverrides: readonly ChannelTarget[] } };
  'key.delete': { args: { readonly clip: ClipId; readonly targets: readonly ChannelTarget[];
    readonly frames?: readonly Frame[]; readonly range?: { readonly start: Frame; readonly end: Frame }; readonly label?: string };
    result: { readonly deleted: number } };
  'key.adjust': { args: { readonly clip: ClipId; readonly targets: readonly ChannelTarget[];
    readonly range?: { readonly start: Frame; readonly end: Frame }; readonly frames?: readonly Frame[];
    /** Per channel kind, stored units: radians (rotations, angle attributes), metres, factor (scale). */
    readonly offset?: { readonly rotate?: number; readonly translate?: number; readonly scale?: number; readonly attr?: number };
    readonly factor?: number;                                         // value scale about `pivot` (1.25 = 25 % bigger)
    readonly pivot?: AdjustPivot;                                     // default { kind: 'rest' }
    readonly falloffFrames?: number;                                  // linear fade of the change outside `range`
    readonly label?: string };
    result: { readonly keys: number; readonly curves: number;
      readonly skipped: readonly (ChannelTarget & { readonly reason: 'locked' | 'no_keys' })[] } };
  'key.retime': { args: { readonly clip: ClipId; readonly targets: readonly ChannelTarget[];
    readonly mode: 'offset' | 'scale' | 'insertTime' | 'deleteTime' | 'warp';
    readonly offset?: number; readonly wrap?: boolean; readonly factor?: number; readonly pivot?: Frame;
    readonly at?: Frame; readonly frames?: number; readonly warp?: readonly (readonly [Frame, Frame])[];
    readonly ripple?: boolean; readonly retimeBreakdowns?: boolean; readonly snapToFrames?: boolean; readonly label?: string };
    result: { readonly moved: number; readonly merged: number; readonly clamped: number; readonly snapped: number;
      readonly contactFrame: Frame | null } };
  'pose.setAt': { args: { readonly clip: ClipId; readonly frame: Frame;
    readonly edits: readonly { readonly control: ControlId; readonly channel: ChannelId; readonly value: number }[];
    readonly mode: 'key' | 'static' | 'propose'; readonly tangent?: TangentType; readonly syncRotation?: boolean;
    readonly extendRange?: boolean; readonly label?: string };
    result: { readonly keyed: number; readonly synced: number; readonly statics: number;
      readonly skipped: readonly (ChannelTarget & { readonly reason: 'locked' | 'non-keyable' | 'animated' })[];
      readonly hiddenByOverrides: readonly ChannelTarget[] } };
  'pose.goals': { args: { readonly clip: ClipId; readonly frame: Frame;
    readonly aims?: readonly { readonly bone: string; readonly direction: Vec3; readonly keepTwist: boolean; readonly weight: number;
      readonly split?: { readonly neck: number; readonly head: number } }[];
    readonly ik?: readonly { readonly limb: LimbId; readonly position?: Vec3; readonly rotation?: Quat; readonly pole?: Vec3;
      readonly ensureIk: 'never' | 'auto'; readonly switchRange?: { readonly start: Frame; readonly end: Frame } }[];
    readonly extendRange?: boolean; readonly label?: string };
    result: { readonly aims: readonly { readonly bone: string; readonly control: ControlId; readonly achieved: Vec3; readonly errorRad: number }[];
      readonly ik: readonly { readonly limb: LimbId; readonly reached: boolean; readonly errorM: number;
        readonly switched: { readonly start: Frame; readonly end: Frame } | null }[];
      readonly keyed: number } };
  'pose.transfer': { args: { readonly clip: ClipId; readonly fromClip?: ClipId; readonly fromFrame: Frame;
    readonly toFrames: readonly Frame[]; readonly controls: readonly ControlId[]; readonly mirror: MirrorMode | 'none';
    readonly extendRange?: boolean; readonly label?: string };
    result: { readonly keyed: number } };
  'clip.makeLoop': { args: { readonly clip: ClipId; readonly method: 'matchEnds' | 'blend' | 'cycleOnly';
    readonly blendFrames?: number; readonly rootTravel: 'cycleOffset' | 'inPlace' | 'keep'; readonly dryRun?: boolean };
    result: { readonly before: SeamMetrics; readonly after: SeamMetrics; readonly curvesChanged: number } };
  'edit.revertSteps': { args: { readonly steps: readonly number[] };
    result: { readonly reverted: readonly number[]; readonly skipped: readonly { readonly step: number; readonly reason: string }[];
      readonly skippedFields: readonly { readonly table: string; readonly id: string; readonly fields: readonly string[] | null }[] } };
  'edit.restoreDocument': { args: { readonly snapshot: DocSnapshot; readonly label: string };   // user runs only (denied to agents)
    result: { readonly writes: number } };
  // stretch (D0 types only, MCP-SPEC §1.2; not registered until built): 'pose.plantContacts', 'pose.recipe'
  'pose.plantContacts': { args: { readonly clip: ClipId; readonly feet?: readonly ('L' | 'R')[];
    readonly contacts?: readonly { readonly foot: 'L' | 'R'; readonly range: { readonly start: Frame; readonly end: Frame } }[];
    readonly blendFrames?: number; readonly label?: string };
    result: { readonly contacts: number; readonly keyed: number; readonly maxSlideAfterM: number } };
  'pose.recipe': { args: { readonly clip: ClipId; readonly recipe: PoseRecipeName; readonly startFrame?: Frame;
    readonly params?: Readonly<Record<string, number | string | boolean>>; readonly label?: string };
    result: { readonly keyed: number; readonly range: { readonly start: Frame; readonly end: Frame } } };
}
