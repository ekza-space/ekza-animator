// Contract file: MVP-SPEC §4.8 with the M2A-SPEC §4.8 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { ChannelId } from '@ekza-animator/doc';
import type { ManipHandle } from '@ekza-animator/editor-core';
export interface EkzaAnimatorTestApi {
  readonly ready: Promise<void>;                              // editor mounted, WebGL context created
  readonly webgl: { readonly ok: boolean; readonly renderer: string | null };
  run(op: string, args?: unknown, ctx?: { panel?: string; paneId?: string }): Promise<{ status: string; value?: unknown; reason?: string; error?: { code: string; message: string } }>;
  /** Same path as drag-and-drop. auto: true skips the import dialog and uses importOptions (or defaults). */
  loadFile(name: string, bytes: Uint8Array, opts?: { auto?: boolean; importOptions?: Record<string, unknown> }): Promise<void>;
  state(): {
    clipFrame: number | null; sceneFrame: number; playing: boolean; layout: string; maximizedPane: string | null;
    activeCharacter: string | null; activeClip: string | null; band: { start: number; end: number } | null;
    selection: { controls: string[]; keys: string[] };
    history: { canUndo: boolean; canRedo: boolean; undoLabel: string | null };
    tool: string; rotateSpace: string; autoKey: boolean; dialog: string | null; readOnly: boolean;
    keyTarget: string; ripple: boolean; dirty: boolean; recovery: string[];   // M2a (additive)
  };
  counts(): Record<string, number>;                          // records per table (non-deleted)
  characters(): { id: string; name: string; format: string }[];
  controls(character?: string): { id: string; key: string; name: string; side: 'L' | 'R' | 'C'; visible: boolean; size: number }[];
  clips(character?: string): { id: string; name: string; fps: number; start: number; end: number; loop: boolean; sceneStart: number }[];
  curves(clip: string, control?: string): { id: string; control: string; channel: ChannelId; weighted: boolean; pre: string; post: string;
    keys: { id: string; t: number; v: number; inType: string; outType: string; broken: boolean; inHandle: { dt: number; dv: number }; outHandle: { dt: number; dv: number };
      breakdown: boolean }[] }[];   // M2a: breakdown (additive)
  /** Evaluates the curve exactly (anim-core) at a clip frame. */
  curveValue(curve: string, frame: number): number;
  channelValues(control: string, clipFrame?: number): Record<string, number>;   // default: current frame
  overrides(control: string): Record<string, number>;
  boneWorld(character: string, humanBoneOrNodeName: string, clipFrame?: number): { t: [number, number, number]; q: [number, number, number, number] };
  /** Canonical facing f = normalize((W(leftUpperLeg) − W(rightUpperLeg)) × (W(head) − W(hips))) at rest. */
  facing(character: string): [number, number, number];
  panes(): { id: string; camera: string; locked: boolean; rect: { x: number; y: number; w: number; h: number } }[];
  cameraOf(paneId: string): { position: [number, number, number]; quaternion: [number, number, number, number] };
  screenOfControl(control: string, paneId: string): { x: number; y: number } | null;   // page CSS px, a point ON the shape polyline
  screenOfManipulator(paneId: string, handle: ManipHandle): { x: number; y: number } | null;   // a grab point on the handle
  graph(): { visibleCurves: string[]; view: { f0: number; v0: number; sx: number; sy: number }; canvasRect: { x: number; y: number; w: number; h: number };
    viewMode: string; buffers: string[] } | null;                                    // M2a: viewMode, buffers (additive, A4)
  screenOfKey(key: string): { x: number; y: number } | null;                          // page CSS px in the Graph Editor
  screenOfHandle(key: string, side: 'in' | 'out'): { x: number; y: number } | null;
  screenOfCurve(curve: string, frame: number): { x: number; y: number } | null;       // point on the drawn curve
  screenOfFrame(frame: number): { x: number; y: number } | null;                      // time slider (clip frames)
  screenOfTick(frame: number): { x: number; y: number } | null;                       // key tick, null if none at frame
  lastExport(): { fileName: string; mime: string; bytes: Uint8Array; sha256: string; lints: unknown[]; readBack: unknown } | null;
  renderedFrames(): number;                                                          // WebGL frames rendered so far (idle check)

  // ---------- M2a (M2A-SPEC §4.8) ----------
  /** M2a: custom attributes by name (without '@') at a clip frame (default: current). */
  attrs(control: string, clipFrame?: number): Record<string, number>;
  /** M2a: control world in canonical character space at a clip frame (default: current). */
  controlWorld(control: string, clipFrame?: number): { t: [number, number, number]; q: [number, number, number, number] };
  /** M2a (A0): one-sided derivative dv/dt of the compiled curve at a clip frame (stored units per frame). */
  curveSlope(curve: string, frame: number, side: 'left' | 'right'): number;
  /** M2a (A0 over RigProgram.limbs): limbs of a character with their evaluated ikFk at the current frame. */
  limbs(character?: string): { id: string; ikFk: number; ikControl: string; pole: string; fk: string[] }[];
  /** M2a (A0 over rig footPivotWorlds): world positions of a leg's foot-roll pivots at the current frame. */
  limbPivots(character: string, limb: string): { heel: number[]; ball: number[]; toe: number[]; inner: number[]; outer: number[] } | null;
  /** M2a (A3) */
  dopeSheet(): { rows: { id: string; kind: string; label: string; depth: number; expanded: boolean; dimmed: boolean;
      keys: number[]; breakdowns: number[]; selected: number[]; holds: [number, number][] }[];
    view: { f0: number; sx: number; scrollY: number }; canvasRect: { x: number; y: number; w: number; h: number } } | null;
  screenOfDopeKey(row: string, frame: number): { x: number; y: number } | null;
  screenOfDopeRegion(part: 'start' | 'middle' | 'end'): { x: number; y: number } | null;
  /** M2a (A3): time-slider ticks of the current key set. */
  timelineTicks(): { frame: number; breakdown: boolean; selected: boolean }[];
  /** M2a (A3): a grab point on the time slider's band handle; null without a band. */
  screenOfBand(part: 'start' | 'middle' | 'end'): { x: number; y: number } | null;
  screenOfRegionHandle(handle: string): { x: number; y: number } | null;                    // A4, scale tool region box
  /** A4: the shared Tween bar mounted in that panel (status line, Graph Editor or Dope Sheet toolbar). */
  screenOfTween(panel: 'graph' | 'dopeSheet' | 'status', amount: number): { x: number; y: number } | null;
  tweenTarget(panel: 'graph' | 'dopeSheet' | 'status'): { kind: 'frame' | 'keys'; label: string } | null;   // A4
  /** M2a (A0 over session.autosave and file.autosaveNow; A5 implements the store) */
  autosave(): { enabled: boolean; slot: string | null; lastSavedAt: number | null; pending: boolean };
  flushAutosave(): Promise<void>;
}
