// Contract file: MVP-SPEC §4.8 with the M2A-SPEC §4.8 and M6A-SPEC §4.8 additions, copied verbatim (shapes are normative; change the spec first).
// Excluded from formatting in biome.json so it stays diffable against the spec.
import type { ChannelId } from '@ekza-studio/doc';
import type { ManipHandle } from '@ekza-studio/editor-core';
export interface EkzaStudioTestApi {
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
    workspace: string; mode: string; hilite: string[]; capture: { armed: string | null;
      field: string | null; text: string | null }; extrudeSession: boolean;      // M6a, changed (additive)
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

  // ---------- M6a (M6A-SPEC §4.8); each group lives in `test-api/m6a/<package-slug>.ts` of its owner ----------
  /** B9 (`m6a/shell-workspaces.ts`) */
  workspaces(): { id: string; label: string; enabled: boolean; active: boolean; glyph: string; reasons: string[] }[];
  pixel(paneId: string, x: number, y: number): [number, number, number, number];   // page CSS px, after a render
  resolveKey(chord: { code: string; mod?: boolean; shift?: boolean; alt?: boolean; ctrl?: boolean },
    at: { panel: string; paneId?: string }): { op: string; args: unknown; scope: string } | null;
  markingMenu(): { id: string; slots: Record<string, { label: string; op: string | null; enabled: boolean }>;
    list: { label: string; op: string | null; enabled: boolean }[]; screenOfSlot: Record<string, { x: number; y: number }> } | null;
  commandPalette(): { open: boolean; query: string; items: { op: string; label: string; enabled: boolean }[] } | null;
  /** B7 (`m6a/mesh-runtime-doc.ts`; counts, stats and normals through the kernel). `meshes()` lists the records plus
   *  one virtual row per loaded character glTF mesh without a record: badge 'asset', id = its derived MeshId (§5.21),
   *  manifest null, runtime 'none'. */
  meshes(): { id: string; name: string; owner: string; parent: string | null; badge: 'prim' | 'edit' | 'asset';
    manifest: string | null; rev: number; faceted: boolean; generator: string | null; palette: string | null;
    counts: { v: number; e: number; f: number; c: number; tris: number } | null; runtime: string }[];
  meshNormals(mesh: string): { face: number[][]; corner: number[][] } | null;   // computeNormals of the current revision
  meshInfo(mesh: string): { counts: { v: number; e: number; f: number; c: number; tris: number };
    stats: { shells: number; boundaryLoops: number; euler: number; nonManifoldEdges: number; nonManifoldVerts: number };
    problems: number; bounds: [number[], number[]]; manifest: string; layers: string[] } | null;
  meshPositions(mesh: string, verts?: number[], space?: 'local' | 'world'): number[][];
  meshFaces(mesh: string): number[][];                 // vertex indices per face, winding order
  meshEdges(mesh: string): { v: [number, number]; hard: boolean; seam: boolean; faces: number }[];
  meshLayer(mesh: string, layer: string, indices?: number[]): number[][];
  shading(mesh: string): { hardEdges: number; softEdges: number; borderEdges: number };
  /** B10 (`m6a/model-select-ui.ts`). `expanded` = the stored selection plus its symmetry partners (what ops run on). */
  model(): { mode: string; hilite: string[]; selected: Record<string, { vertex: number[]; edge: number[]; face: number[];
    active: number; order: number[] }>; expanded: Record<string, { vertex: number[]; edge: number[]; face: number[] }>;
    hidden: Record<string, { vertex: number[]; edge: number[]; face: number[] }>;
    hiddenObjects: string[]; isolate: Record<string, string[] | null>; style: string; cameraBased: string };
  screenOfVertex(mesh: string, v: number, paneId: string): { x: number; y: number } | null;   // null when occluded/off-screen
  screenOfEdge(mesh: string, e: number, paneId: string, t?: number): { x: number; y: number } | null;
  screenOfFace(mesh: string, f: number, paneId: string): { x: number; y: number } | null;     // a visible interior point
  hud(paneId: string): { mode: string; scene: Record<string, number>; object: Record<string, number>;
    selected: Record<string, number>; selectedSym: Record<string, number>;   // "40 (+40 sym)": 40 and 40
    budget: { tris: number; limit: number | null; state: 'ok' | 'warn' | 'danger' } } | null;
  meshCheck(mesh: string): { code: string; count: number; elements: number[] }[];
  paneObjects(paneId: string): string[];               // objects drawn in the pane (isolate, hide)
  /** B12a (`m6a/model-transform-tools.ts`; B2 maps) */
  symmetry(mesh: string): { mode: string; tolerance: number; preserveSeam: boolean; unmatched: number;
    vertexPartners: number[] } | null;
  softWeights(mesh: string): number[] | null;
  /** B11 (`m6a/model-ops-ui.ts`) */
  lastOp(): { id: string; label: string; args: Record<string, unknown>; adjustable: boolean; repeatable: boolean;
    closed: string | null; source: string; kind: string | null; targets: string[];
    warnings: { code: string; count: number | null }[] } | null;
  helpLine(): string;                                  // the help line's current text (B9 renders, every owner writes)
  lastOpCard(paneId?: string): { title: string; expanded: boolean; fields: { name: string; label: string;
    text: string; value: number | boolean | string }[]; focused: string | null } | null;
  history(): { undo: string[]; redo: string[] };       // labels, oldest first (B0a: kernel-level)
  /** B13 (`m6a/model-content.ts`) */
  palettes(): { id: string; name: string; swatches: { id: string; slot: number; srgb: [number, number, number];
    name: string; shader: 'lambert' | 'blinn'; glossiness: number; specular: [number, number, number] }[] }[];
  activeSwatch(): string | null;
  imagePlanes(): { id: string; camera: string; asset: string; offset: [number, number]; size: number; opacity: number;
    depth: string; locked: boolean; visible: boolean }[];
  /** B7 */
  blobs(): { resident: number; residentBytes: number; historyBytes: number; journalBytes: number };
  /** INT (`m6a/integration.ts`; E2E-MOD-30) */
  setExpression(character: string, name: string, weight: number): void;
  /** INT (additive, M6A-INT-17): a page rectangle's RGBA after a render, rows top-down; null off the pane. */
  pixels(paneId: string, x: number, y: number, w: number, h: number): { width: number; height: number;
    data: number[] } | null;
  /** INT (additive, M6A-INT-17): a display-model node's world position as drawn (spring bones included). */
  displayNodeWorld(character: string, node: string): [number, number, number] | null;
  /** INT (additive, M6A-INT-17): the character's display model as drawn (a rebuild shows as new counts); `drawn`:
   *  its meshes on the mesh layer (M6A-INT-50: Model hides the made-editable ones). */
  displayModel(character: string): { meshes: number; vertices: number; drawn: number } | null;
}
