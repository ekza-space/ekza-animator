// Contract file: MVP-SPEC §4.5 with the M2A-SPEC §4.5 additions, the M6A-SPEC §6 rows (B0a) and the M6B-SPEC §6/§0.6 rows (C0), copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Fps, Frame, InfinityMode, ParamValues, ReadonlyVec3, ReadonlyXf, RotateOrder, TangentType } from '@ekza-studio/anim-core';
import type { CameraId, ChannelId, CharacterId, CharacterVrmMeta, ClipId, ConstraintId, ControlId, CurveId, DerivedFrom,
  GroupId, HumanBoneName, ImagePlaneId, ImagePlaneRecord, JointId, JointRole, KeyId, MeshId, MeshRecord, OrthoCamera,
  PaletteId, Redistributable, RootMotionMode, Side, SkeletonId, SwatchId, SwatchShader } from '@ekza-studio/doc';
import type { BindMethod, ComponentKind, PaintOp, StrokeStamp } from '@ekza-studio/mesh-core';
import type { CharacterExportRequest, ExportArtifact, ExportRequest, StaticExportRequest } from '@ekza-studio/io';
import type { BakeConstraintsArgs, ConstraintType, FootRollParams, LimbId, MirrorMode, QuickRigMarker, QuickRigMarkers,
  ReduceSpec, SkeletonPreset } from '@ekza-studio/rig';
import type { BodyPart, ChannelEditResult, ChannelRef, DisplayFlags, GraphViewMode, HistoryResult, IkFkKeyMode,
  KeyPartSelection, KeyPolicy, KeyTarget, LoopMode, ManipSpace, NavProfile, PaneCamera, PanelKind, PlaybackSpeed,
  Prefs, SelectionMask, SelectMode, ToolId, TweenMode, UiDialog, ViewportLayout } from '../types';
import type { ComponentMode, MeshOpArgs, MeshOpOutcome, MeshSetCommitResult, SceneObjectId, SelectionConstraint,
  SelectionStyle, Shading, SoftSelectSettings, SymmetryMode, WorkspaceId } from '../types';
import type { BrushSettings, PaintMode, PoseView, RigMode } from '../types';

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
/** The shader fields `palette.addSwatch`/`palette.setSwatch` take (SHADING-SPEC §5). */
export interface SwatchShaderArgs {
  readonly shader?: SwatchShader;
  readonly glossiness?: number;
  readonly specular?: readonly [number, number, number];
}
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

export interface OperatorMap {
  // file
  'file.new': { args: void; result: void };
  'file.open': { args: FileArgs; result: void };                  // importer registry dispatch
  'file.openProject': { args: FileArgs; result: { readonly readOnly: boolean; readonly migratedFrom: number } };
  'file.importModel': { args: FileArgs & { readonly options?: Partial<ImportModelOptions> }; result: ImportResult };
  'file.importAnimation': { args: FileArgs & { readonly character?: CharacterId; readonly options?: Partial<ImportAnimationOptions> }; result: ClipsResult };
  'file.loadSample': { args: { readonly sample: SampleId; readonly options?: Partial<ImportModelOptions> }; result: ImportResult };
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
  'clip.new': { args: { readonly character?: CharacterId; readonly name?: string; readonly fps?: Fps; readonly range?: { readonly start: Frame; readonly end: Frame } } | void; result: { readonly clip: ClipId } };
  'clip.rename': { args: { readonly clip: ClipId; readonly name: string }; result: void };
  'clip.duplicate': { args: { readonly clip: ClipId }; result: { readonly clip: ClipId } };
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
  'rig.ikFk.matchRange': { args: { readonly limb: LimbId; readonly side: 'ik' | 'fk';
    readonly range?: { readonly start: Frame; readonly end: Frame }; readonly step?: 'keys' | 'frames';
    readonly character?: CharacterId }; result: CountResult };
  'rig.setFootParams': { args: { readonly limb: 'leg.L' | 'leg.R'; readonly character?: CharacterId;
    readonly params: Partial<Pick<FootRollParams, 'heelBack' | 'ballFront' | 'toeFront' | 'innerWidth' | 'outerWidth' | 'breakAngle'>> };
    result: void };
  // select / key / pose
  'select.pickWalk': { args: { readonly direction: 'up' | 'down' | 'left' | 'right'; readonly add?: boolean }; result: void };
  'key.setTarget': { args: { readonly target: KeyTarget }; result: void };
  'key.toggleRipple': { args: { readonly ripple?: boolean } | void; result: void };
  'key.tween': { args: { readonly mode: TweenMode; readonly amount: number; readonly target?: 'frame' | 'keys';
    readonly breakdown?: boolean }; result: CountResult };
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
  // ---------- M6a (M6A-SPEC §6, §4.6; B0a rows) ----------
  // Kernel ops (§6.1): MeshOpArgs → MeshOpOutcome; set-ops → MeshSetCommitResult.
  'mesh.transformComponents': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.extrude': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.inset': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.bevel': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.insertLoop': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.offsetLoop': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.connect': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.cut': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.slide': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.averageVertices': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.bridge': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.fillHole': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.merge': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.mergeToCenter': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.mergeByDistance': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.targetWeld': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.collapse': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.delete': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.deleteEdgeVertex': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.spinEdge': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.flipTriangleEdge': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.triangulate': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.quadrangulate': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.harden': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.soften': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.setNormalAngle': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.reverse': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.conform': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.mirror': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.symmetrize': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.applyTransform': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.uv.planar': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.uv.box': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.uv.cylindrical': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.cleanup': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.paint': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.paint.fillShell': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.paint.remap': { args: MeshOpArgs; result: MeshOpOutcome };
  'mesh.combine': { args: MeshOpArgs; result: MeshSetCommitResult };
  'mesh.separate': { args: MeshOpArgs; result: MeshSetCommitResult };
  'mesh.extract': { args: MeshOpArgs; result: MeshSetCommitResult };
  'mesh.duplicateFaces': { args: MeshOpArgs; result: MeshSetCommitResult };
  // Editor operators (§6.2)
  'workspace.set': { args: { readonly workspace: WorkspaceId }; result: void };
  'view.shading': { args: { readonly mode: Shading; readonly paneId?: string }; result: void };
  'view.display.set': { args: { readonly patch: Partial<DisplayFlags>; readonly paneId?: string }; result: void };
  'ui.commandPalette': { args: void; result: void };
  'ui.markingMenu': { args: { readonly menu: string }; result: void };
  'select.mode': { args: { readonly mode: ComponentMode | 'toggle' }; result: void };
  'model.hilite': { args: { readonly meshes: readonly MeshId[]; readonly mode: 'add' | 'replace' | 'remove' }; result: void };
  'select.components': { args: { readonly mesh: MeshId; readonly kind: ComponentKind; readonly indices: readonly number[];
    readonly mode: SelectMode }; result: void };
  'select.mesh.loop': { args: { readonly mesh: MeshId; readonly kind: ComponentKind; readonly component: number;
    readonly gesture: 'double' | 'shift-double' | 'mod-double' }; result: void };
  'select.mesh.ring': { args: { readonly mesh?: MeshId; readonly component?: number } | void; result: void };
  'select.mesh.grow': { args: void; result: void };
  'select.mesh.shrink': { args: void; result: void };
  'select.mesh.border': { args: void; result: void };
  'select.mesh.shell': { args: void; result: void };
  'select.mesh.all': { args: void; result: void };
  'select.mesh.invert': { args: void; result: void };
  'select.mesh.none': { args: void; result: void };
  'select.mesh.convert': { args: { readonly to: ComponentKind; readonly mode?: 'touching' | 'contained' | 'perimeter'
    | 'border' | 'shell' | 'loop' | 'ring' }; result: void };
  'select.mesh.matching': { args: { readonly mesh: MeshId; readonly code: string }; result: void };
  'select.mesh.bySwatch': { args: { readonly slot?: number } | void; result: void };
  'select.objects': { args: { readonly ids?: readonly SceneObjectId[]; readonly all?: 'meshes'; readonly mode: SelectMode }; result: void };
  'select.mesh.pickWalk': { args: { readonly direction: 'up' | 'down' | 'left' | 'right' }; result: void };   // stretch
  'view.hide': { args: { readonly target: 'selected' | 'unselected' }; result: void };
  'view.showAll': { args: void; result: void };
  'view.isolate': { args: { readonly paneId?: string } | void; result: void };
  'model.symmetry.set': { args: { readonly meshes?: readonly MeshId[]; readonly mode?: SymmetryMode; readonly tolerance?: number;
    readonly preserveSeam?: boolean }; result: void };
  'model.softSelect.set': { args: Partial<Pick<SoftSelectSettings, 'on' | 'radius' | 'falloff' | 'curve'>>; result: void };
  'model.softSelect.toggle': { args: void; result: void };
  'model.selectionStyle.set': { args: { readonly style: SelectionStyle | 'toggle' }; result: void };
  'model.cameraBased.set': { args: { readonly value: 'auto' | 'on' | 'off' }; result: void };
  'model.backfaces.toggle': { args: void; result: void };
  'model.constraint.set': { args: { readonly constraint: SelectionConstraint }; result: void };
  'model.snap.toggle': { args: { readonly kind: 'grid' | 'vertex' | 'increment' }; result: void };
  'model.pivot.editToggle': { args: void; result: void };
  'mesh.pivot.set': { args: { readonly id: SceneObjectId; readonly pivot: ReadonlyVec3 }; result: void };
  'mesh.pivot.center': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'mesh.pivot.bottomCenter': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'mesh.pivot.reset': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'mesh.pivot.bake': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'mesh.resetTransforms': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'mesh.freezeTransforms': { args: { readonly ids?: readonly SceneObjectId[]; readonly translate: boolean; readonly rotate: boolean;
    readonly scale: boolean }; result: void };
  'scene.object.transform': { args: { readonly ids: readonly SceneObjectId[]; readonly placements: readonly ReadonlyXf[] }; result: void };
  'edit.adjustLast': { args: { readonly args: ParamValues }; result: void };
  'edit.repeatLast': { args: void; result: void };
  'model.animateOnly': { args: void; result: void };
  'tool.last': { args: void; result: void };
  'view.lastOpCard': { args: { readonly expand?: boolean; readonly focusPrimary?: boolean } | void; result: void };
  'mesh.create.cube': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.sphere': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.cylinder': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.cone': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.plane': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.torus': { args: ParamValues | void; result: { readonly mesh: MeshId } };
  'mesh.create.template': { args: ParamValues & { readonly template: 'prop' | 'handheld' | 'humanoid' | 'humanoidBody' };
    result: { readonly root: SceneObjectId; readonly created: readonly SceneObjectId[] } };
  'mesh.primitive.set': { args: { readonly mesh: MeshId; readonly params: ParamValues }; result: void };
  'mesh.makeEditable': { args: { readonly character: CharacterId; readonly meshIndex: number }; result: { readonly mesh: MeshId } };
  'mesh.setAttributes': { args: { readonly mesh: MeshId; readonly patch: Partial<Pick<MeshRecord, 'name' | 'faceted'
    | 'colourOutput' | 'material' | 'budget' | 'handheld' | 'palette'>> }; result: void };
  'palette.ensureDefault': { args: void; result: { readonly palette: PaletteId } };
  'palette.create': { args: { readonly name: string }; result: { readonly palette: PaletteId } };
  'palette.duplicate': { args: { readonly palette: PaletteId }; result: { readonly palette: PaletteId } };
  'palette.rename': { args: { readonly palette: PaletteId; readonly name: string }; result: void };
  'palette.addSwatch': { args: { readonly palette: PaletteId; readonly srgb: readonly [number, number, number]; readonly name?: string }
    & SwatchShaderArgs; result: { readonly swatch: SwatchId; readonly slot: number } };
  'palette.setSwatch': { args: { readonly swatch: SwatchId; readonly srgb?: readonly [number, number, number]; readonly name?: string }
    & SwatchShaderArgs; result: void };
  // SHADING-SPEC §5: Assign New Material (a new swatch with the shader, painted on the selection, one step).
  'palette.assignMaterial': { args: { readonly shader: SwatchShader; readonly meshes?: readonly MeshId[];
    readonly srgb?: readonly [number, number, number]; readonly name?: string };
    result: { readonly swatch: SwatchId; readonly slot: number; readonly meshes: readonly MeshId[] } };
  'palette.removeSwatch': { args: { readonly swatch: SwatchId }; result: void };
  'palette.assign': { args: { readonly meshes?: readonly MeshId[]; readonly palette: PaletteId }; result: void };
  'palette.replaceSwatch': { args: { readonly palette: PaletteId; readonly from: number; readonly to: number;
    readonly meshes?: readonly MeshId[] }; result: void };
  'palette.setActive': { args: { readonly swatch: SwatchId | null }; result: void };
  'imagePlane.import': { args: { readonly camera: OrthoCamera; readonly name: string; readonly bytes: Uint8Array };
    result: { readonly id: ImagePlaneId } };
  'imagePlane.set': { args: { readonly id: ImagePlaneId; readonly patch: Partial<Pick<ImagePlaneRecord, 'name' | 'camera'
    | 'offset' | 'size' | 'opacity' | 'depth' | 'locked' | 'visible'>> }; result: void };
  'imagePlane.delete': { args: { readonly id: ImagePlaneId }; result: void };
  'scene.group': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: { readonly group: GroupId } };
  'scene.parent': { args: { readonly ids?: readonly SceneObjectId[]; readonly parent?: SceneObjectId } | void; result: void };
  'scene.unparent': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: void };
  'scene.duplicate': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: { readonly created: readonly SceneObjectId[] } };
  'scene.delete': { args: { readonly ids?: readonly SceneObjectId[] } | void; result: CountResult };
  'scene.rename': { args: { readonly id: SceneObjectId; readonly name: string }; result: void };
  'file.exportModel': { args: StaticExportRequest; result: readonly ExportArtifact[] };

  // ===================== M6b (M6B-SPEC §6, §0.6; C0 registers every id from its owner's stub file) =====================
  // ---------- §6.1 characters and skeletons ----------
  'mesh.importStatic': { args: { readonly bytes: Uint8Array; readonly name: string }; result: { readonly meshes: readonly MeshId[] } };
  'char.fromModel': { args: { readonly objects?: readonly SceneObjectId[]; readonly name?: string | null } | void;
    result: { readonly character: CharacterId; readonly skeleton: SkeletonId } };
  'char.adopt': { args: { readonly character: CharacterId; readonly objects?: readonly SceneObjectId[] }; result: { readonly meshes: readonly MeshId[] } };
  'char.attachProp': { args: { readonly hand?: 'rightHand' | 'leftHand'; readonly name?: string | null; readonly keepSource?: boolean;
    readonly objects?: readonly SceneObjectId[] } | void; result: { readonly joint: JointId } };
  'char.makeEditable': { args: { readonly character: CharacterId }; result: { readonly skeleton: SkeletonId } };
  'char.setVrmMeta': { args: { readonly character: CharacterId; readonly patch: Partial<CharacterVrmMeta> }; result: void };
  'char.renderThumbnail': { args: { readonly character: CharacterId }; result: { readonly asset: string } };
  'skel.template.create': { args: { readonly preset?: SkeletonPreset; readonly proportions?: 'auto' | 'standard' | 'bigHead';
    readonly flexion?: number; readonly objects?: readonly SceneObjectId[] } | void;
    result: { readonly character: CharacterId; readonly skeleton: SkeletonId } };
  'skel.template.addMissing': { args: { readonly skeleton: SkeletonId }; result: { readonly added: readonly JointId[]; readonly mapped: readonly JointId[] } };
  'skel.quickRig.start': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };
  'skel.quickRig.setMarker': { args: { readonly name: QuickRigMarker; readonly point: readonly [number, number, number] }; result: void };
  'skel.quickRig.guess': { args: void; result: void };
  'skel.quickRig.clear': { args: void; result: void };                                            // §0.6 (new)
  'skel.quickRig.setPreset': { args: { readonly preset: SkeletonPreset }; result: void };         // §0.6 (new)
  'skel.quickRig.cancel': { args: void; result: void };                                           // §0.6 (new)
  'skel.quickRig.pick': { args: { readonly marker: QuickRigMarker | null }; result: void };       // §0.6 (new)
  'skel.quickRig.center': { args: { readonly meshes?: readonly MeshId[] } | void; result: void }; // §0.6 (new): Center and ground
  'skel.quickRig.faceForward': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };   // §0.6 (new): Rotate to face +Z
  'skel.quickRig.commit': { args: { readonly preset: SkeletonPreset; readonly markers: QuickRigMarkers;
    readonly meshes: readonly MeshId[]; readonly flexion: number };                               // §0.4.2 args
    result: { readonly character: CharacterId; readonly skeleton: SkeletonId } };
  'skel.joint.create': { args: { readonly points: readonly (readonly [number, number, number])[]; readonly parent?: JointId | null;
    readonly prefix?: string; readonly orient?: 'world' | 'maya' | 'blender'; readonly symmetry?: boolean };
    result: { readonly joints: readonly JointId[] } };
  'skel.joint.duplicate': { args: { readonly joints?: readonly JointId[]; readonly mirror?: boolean } | void; result: { readonly joints: readonly JointId[] } };
  'skel.joint.setRole': { args: { readonly joints?: readonly JointId[]; readonly role: JointRole }; result: void };
  'skel.socket.create': { args: { readonly preset?: 'back' | 'hipL' | 'hipR' | 'handL' | 'handR' | 'custom'; readonly parent?: JointId | null;
    readonly name?: string | null; readonly position?: readonly [number, number, number] | null } | void; result: { readonly joint: JointId } };
  'skel.joint.insert': { args: { readonly bone: { readonly joint: JointId; readonly child: JointId }; readonly t?: number };
    result: { readonly joint: JointId } };
  'skel.bone.split': { args: { readonly joint?: JointId; readonly n?: number } | void; result: { readonly joints: readonly JointId[] } };
  'skel.joint.remove': { args: { readonly joints?: readonly JointId[] } | void; result: CountResult };
  'skel.joint.delete': { args: { readonly joints?: readonly JointId[] } | void; result: CountResult };
  'skel.joint.reparent': { args: { readonly joints?: readonly JointId[]; readonly parent?: JointId } | void; result: void };
  'skel.joint.unparent': { args: { readonly joints?: readonly JointId[] } | void; result: void };
  'skel.joint.rename': { args: { readonly joint: JointId; readonly name: string; readonly mirror?: boolean }; result: void };
  'skel.joint.setHumanBone': { args: { readonly joint: JointId; readonly bone: HumanBoneName | null }; result: void };
  'skel.joint.setSide': { args: { readonly joints?: readonly JointId[]; readonly side: Side }; result: void };
  'skel.joint.move': { args: ParamValues & { readonly joints?: readonly JointId[]; readonly pivot?: readonly number[];
    readonly mode?: 'subtree' | 'joint'; readonly symmetry?: boolean }; result: void };
  'skel.joint.rotateRest': { args: ParamValues & { readonly joints?: readonly JointId[]; readonly pivot?: readonly number[];
    readonly mode?: 'subtree' | 'joint' }; result: void };
  'skel.joint.setRest': { args: { readonly joint: JointId; readonly position?: readonly [number, number, number] | null;
    readonly rotation?: readonly [number, number, number, number] | null }; result: void };
  'skel.joint.orient': { args: ParamValues & { readonly joints?: readonly JointId[] } | void; result: void };
  'skel.joint.mirror': { args: ParamValues & { readonly root?: JointId } | void; result: { readonly joints: readonly JointId[] } };
  'skel.joint.flex': { args: { readonly angle?: number; readonly joints?: readonly JointId[] } | void; result: void };
  'skel.symmetry.set': { args: { readonly skeleton: SkeletonId; readonly on: boolean }; result: void };
  'skel.pose.tStance': { args: void; result: void };
  'skel.pose.applyAsRest': { args: void; result: void };
  // ---------- §6.2 skin and weights (`holds` is the internal recorded arg of every undoable weight operator) ----------
  'skin.bind': { args: { readonly method?: BindMethod; readonly hierarchy?: boolean; readonly dropoff?: number; readonly stiffness?: number;
    readonly pruneBelow?: number; readonly rigidifyAbove?: number | null; readonly symmetrize?: boolean | null;
    readonly joints?: readonly string[] | null; readonly points?: readonly number[] | null; readonly meshes?: readonly MeshId[];
    readonly holds?: readonly string[] } | void; result: { readonly meshes: readonly MeshId[] } };
  'skin.weights.autoForJoints': { args: { readonly joints?: readonly string[]; readonly meshes?: readonly MeshId[] | null;
    readonly holds?: readonly string[] } | void; result: void };
  'skin.unbind': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };
  'skin.weights.paint': { args: { readonly mesh: MeshId; readonly joint: string; readonly op: PaintOp; readonly value: number;
    readonly stamps: readonly StrokeStamp[]; readonly mirror: boolean; readonly holds?: readonly string[] }; result: void };
  'skin.weights.flood': { args: { readonly op?: PaintOp; readonly value?: number; readonly opacity?: number; readonly mirror?: boolean;
    readonly joint?: string; readonly points?: readonly number[] | null; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.set': { args: { readonly value: number; readonly mode?: 'set' | 'add' | 'mul'; readonly joint: string; readonly mesh: MeshId;
    readonly points: readonly number[]; readonly holds?: readonly string[] }; result: void };
  'skin.weights.assign': { args: { readonly joint?: string; readonly points?: readonly number[]; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.rigidIslands': { args: { readonly points?: readonly number[]; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.mirror': { args: { readonly direction?: 'positive-to-negative' | 'negative-to-positive';
    readonly surface?: 'partners' | 'closest-point'; readonly selection?: boolean; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.transfer': { args: { readonly method?: 'inpaint' | 'closest-point' | 'closest-component'; readonly distance?: number;
    readonly angle?: number; readonly source?: MeshId; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.smooth': { args: { readonly factor?: number; readonly iterations?: number; readonly expand?: number;
    readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.hammer': { args: { readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.copyVertex': { args: void; result: void };
  'skin.weights.pasteVertex': { args: { readonly mirrorJoints?: boolean; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.prune': { args: { readonly below?: number; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.normalize': { args: { readonly lockActive?: boolean; readonly holds?: readonly string[] } | void; result: void };
  'skin.weights.move': { args: { readonly fraction?: number; readonly from?: string; readonly to?: readonly string[];
    readonly holds?: readonly string[] } | void; result: void };
  'skin.palette.compact': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };
  'skin.weights.fillMissing': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };
  'skin.review.mark': { args: { readonly meshes?: readonly MeshId[] } | void; result: void };
  'skin.influence.setActive': { args: { readonly mesh: MeshId; readonly joint: string } | null; result: void };
  'skin.influence.hold': { args: { readonly joint?: string; readonly on: boolean }; result: void };
  'skin.influence.holdAll': { args: void; result: void };
  'skin.influence.releaseAll': { args: void; result: void };
  'skin.influence.walk': { args: { readonly direction: 'up' | 'down' | 'left' | 'right' }; result: void };
  'skin.influence.pickDominant': { args: { readonly mesh?: MeshId; readonly point: number }; result: void };
  'skin.paint.mode': { args: { readonly mode?: PaintMode; readonly step?: -1 | 1 }; result: void };
  'skin.paint.set': { args: { readonly patch: Partial<BrushSettings> }; result: void };
  'skin.paint.mirrorToggle': { args: void; result: void };
  'skin.paint.sample': { args: { readonly mesh?: MeshId; readonly point: number }; result: void };
  'skin.testRotate.toggle': { args: void; result: void };
  'skin.test.rom': { args: { readonly character: CharacterId }; result: { readonly clip: ClipId } };
  // ---------- §6.3 workspace, control rig, constraints and shapes ----------
  'rig.mode': { args: { readonly mode: RigMode | 'toggle' }; result: void };
  'rig.pose.view': { args: { readonly view: PoseView }; result: void };
  'rig.pose.resetTest': { args: void; result: void };
  'rig.animateOnly': { args: void; result: void };
  'rig.validation.profile': { args: { readonly profile: string | null }; result: void };
  'rig.outliner.delete': { args: { readonly ids?: readonly string[] } | void; result: void };
  'select.joints': { args: { readonly ids?: readonly JointId[] | null; readonly all?: boolean; readonly mode?: SelectMode } | void; result: void };
  'rig.autoRig.update': { args: { readonly ikLegs?: boolean; readonly ikArms?: boolean; readonly character?: CharacterId } | void; result: void };
  'rig.constraint.create': { args: { readonly type: ConstraintType; readonly maintainOffset?: 'rest' | 'current' | 'none';
    readonly skipTranslate?: readonly [boolean, boolean, boolean]; readonly skipRotate?: readonly [boolean, boolean, boolean];
    readonly weights?: 'attrs' | 'static'; readonly blend?: boolean; readonly interp?: 'average' | 'shortest';
    readonly aimAxis?: readonly [number, number, number] | 'auto'; readonly upAxis?: readonly [number, number, number] | 'auto';
    readonly worldUp?: unknown; readonly follow?: 'bone' | 'control'; readonly key?: string;   // 'auto' = derived
    readonly targets?: readonly string[]; readonly driven?: string }; result: { readonly constraint: ConstraintId } };
  'rig.constraint.edit': { args: { readonly constraint: ConstraintId; readonly patch: Readonly<Record<string, unknown>> }; result: void };
  'rig.constraint.addTarget': { args: { readonly constraint: ConstraintId; readonly target?: string; readonly key?: string;   // 'auto' = derived
    readonly weight?: number; readonly offset?: 'rest' | 'current' | 'snap' | 'auto' }; result: void };
  'rig.constraint.removeTarget': { args: { readonly constraint: ConstraintId; readonly key: string }; result: void };
  'rig.constraint.updateOffset': { args: { readonly constraint: ConstraintId; readonly targets?: readonly string[] | null;
    readonly match?: string | null }; result: void };
  'rig.constraint.clearOffset': { args: { readonly constraint: ConstraintId; readonly targets?: readonly string[] }; result: void };
  'rig.constraint.bake': { args: Partial<BakeConstraintsArgs>; result: void };
  'rig.constraint.mirror': { args: { readonly constraints?: readonly ConstraintId[] } | void; result: void };
  'rig.constraint.delete': { args: { readonly constraints?: readonly ConstraintId[] } | void; result: void };
  'rig.constraint.repairAttrs': { args: { readonly constraint: ConstraintId }; result: void };
  'rig.constraint.poleVector': { args: void; result: void };
  'rig.space.add': { args: Readonly<Record<string, unknown>>; result: void };                     // stretch
  'rig.space.switch': { args: Readonly<Record<string, unknown>>; result: void };                  // stretch
  'rig.shape.replace': { args: { readonly kind: string; readonly controls?: readonly ControlId[] }; result: void };
  'rig.shape.set': { args: { readonly size?: number | null; readonly color?: string | null; readonly lineWidth?: number | null;
    readonly offset?: unknown; readonly controls?: readonly ControlId[] }; result: void };
  'rig.shape.transform': { args: { readonly delta: unknown; readonly pivot: readonly number[]; readonly controls?: readonly ControlId[] }; result: void };
  'rig.shape.editPoints': { args: { readonly control: ControlId; readonly edits: readonly unknown[] }; result: void };
  'rig.shape.mirror': { args: { readonly direction?: 'left-to-right' | 'right-to-left' | 'selected'; readonly controls?: readonly ControlId[] } | void; result: void };
  'rig.shape.copy': { args: { readonly control: ControlId }; result: void };
  'rig.shape.paste': { args: { readonly controls?: readonly ControlId[] } | void; result: void };
  'rig.shape.reset': { args: { readonly fields?: readonly string[] | null; readonly controls?: readonly ControlId[] } | void; result: void };
  'rig.shape.sizeFromMesh': { args: { readonly fields?: readonly string[] | null; readonly controls?: readonly ControlId[] } | void; result: void };
  'rig.shape.cvMode': { args: { readonly on: boolean | 'toggle' }; result: void };
  // ---------- §6.4 export ----------
  'file.exportCharacter': { args: CharacterExportRequest; result: readonly ExportArtifact[] };
  // ---------- §0.6 the clip library (C12) ----------
  'library.open': { args: void; result: void };
  'library.preview': { args: { readonly character: CharacterId; readonly clip: string }; result: void };
  'library.stop': { args: void; result: void };
  'library.useClip': { args: { readonly character: CharacterId; readonly clip: string }; result: { readonly clip: ClipId } };
}
