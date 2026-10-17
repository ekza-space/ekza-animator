// Contract file: MVP-SPEC §4.8, copied verbatim (shapes are normative; change the spec first).
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
  };
  counts(): Record<string, number>;                          // records per table (non-deleted)
  characters(): { id: string; name: string; format: string }[];
  controls(character?: string): { id: string; key: string; name: string; side: 'L' | 'R' | 'C'; visible: boolean; size: number }[];
  clips(character?: string): { id: string; name: string; fps: number; start: number; end: number; loop: boolean; sceneStart: number }[];
  curves(clip: string, control?: string): { id: string; control: string; channel: ChannelId; weighted: boolean; pre: string; post: string;
    keys: { id: string; t: number; v: number; inType: string; outType: string; broken: boolean; inHandle: { dt: number; dv: number }; outHandle: { dt: number; dv: number } }[] }[];
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
  graph(): { visibleCurves: string[]; view: { f0: number; v0: number; sx: number; sy: number }; canvasRect: { x: number; y: number; w: number; h: number } } | null;
  screenOfKey(key: string): { x: number; y: number } | null;                          // page CSS px in the Graph Editor
  screenOfHandle(key: string, side: 'in' | 'out'): { x: number; y: number } | null;
  screenOfCurve(curve: string, frame: number): { x: number; y: number } | null;       // point on the drawn curve
  screenOfFrame(frame: number): { x: number; y: number } | null;                      // time slider (clip frames)
  screenOfTick(frame: number): { x: number; y: number } | null;                       // key tick, null if none at frame
  lastExport(): { fileName: string; mime: string; bytes: Uint8Array; sha256: string; lints: unknown[]; readBack: unknown } | null;
  renderedFrames(): number;                                                          // WebGL frames rendered so far (idle check)
}
