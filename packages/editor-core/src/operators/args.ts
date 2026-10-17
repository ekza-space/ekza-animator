// Contract file: MVP-SPEC §4.5, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { Fps, Frame, InfinityMode, RotateOrder, TangentType } from '@ekza-animator/anim-core';
import type { CameraId, ChannelId, CharacterId, ClipId, ControlId, CurveId, DerivedFrom, KeyId, Redistributable,
  RootMotionMode } from '@ekza-animator/doc';
import type { ExportArtifact, ExportRequest } from '@ekza-animator/io';
import type { MirrorMode, ReduceSpec } from '@ekza-animator/rig';
import type { ChannelEditResult, ChannelRef, DisplayFlags, HistoryResult, KeyPartSelection, KeyPolicy,
  LoopMode, ManipSpace, NavProfile, PaneCamera, PanelKind, PlaybackSpeed, Prefs, SelectionMask, SelectMode, ToolId,
  UiDialog, ViewportLayout } from '../types';

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
export type KeyChannels = 'all' | 'translate' | 'rotate' | 'scale' | 'selected';
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
  'key.set': { args: { readonly channels?: KeyChannels; readonly target?: 'selected' | 'character' } | void; result: CountResult };
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
  'time.setFrame': { args: { readonly frame: Frame; readonly unit?: 'clip' | 'scene' }; result: void };
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
  'graph.keys.move': { args: { readonly dFrames: number; readonly dValue: number }; result: CountResult };
  'graph.keys.scale': { args: { readonly pivot: Frame; readonly factor: number }; result: CountResult };
  'graph.keys.delete': { args: void; result: CountResult };
  'graph.key.insert': { args: { readonly curve: CurveId; readonly frame: Frame }; result: { readonly key: KeyId } };
  'graph.keys.keyCurves': { args: void; result: CountResult };
  'graph.keys.copy': { args: void; result: CountResult };
  'graph.keys.paste': { args: { readonly mode?: 'merge' | 'replace' } | void; result: CountResult };
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
}
