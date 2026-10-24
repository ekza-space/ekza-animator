// The Rig & Skin skin runtime of a viewport (M6B-SPEC §5.11, §5.12, §8.3; C6; lazy, loaded on the first Rig & Skin
// entry by ./index.ts): it
// - mounts C1's skinned display (`attachSkinnedDisplay`: the active character's bound meshes through
//   `SkinnedSurface`, posed by the evaluation) and, on each shown surface, a `WeightDisplay` (mesh-view) whose mode and
//   active influence follow Skin mode, the panes' `weights` flag and `RigSessionState.activeInfluence` — uniforms only;
// - contributes the Paint Skin Weights tool (`paintSkinWeights`, ./tool.ts);
// - draws the brush ring, the partner ring and the readout chip while the pointer hovers a pane with the tool active;
// - turns the weight display on (greyscale) and the brush's mirror to the skeleton's symmetry when Skin mode is entered.
import type { Disposer } from '@ekza-studio/anim-core';
import type { CharacterId, ControlId, MeshId } from '@ekza-studio/doc';
import {
  boundMeshesOf,
  type EditorApp,
  jointName,
  influencesOf,
  meshKernel,
  setBrush,
  skinCharacter,
  skinTargets,
  skinTestRotate,
  subscribeSkinTestRotate,
  weightInputsNow,
} from '@ekza-studio/editor-core';
import type { SkinGeometry, SkinWeights } from '@ekza-studio/mesh-core';
import type { SkinnedSurface, WeightDisplay } from '@ekza-studio/mesh-view';
import type { ViewportManager } from '../../../manager/ViewportManager';
import { loadMeshView, type MeshView } from '../../../mesh';
import { BrushRing } from '../../../rig/brush';
import { loadViewportRig } from '../../../rig/load';
import type { SkinnedCharacterDisplay } from '../../../rig/skinned';
import { paletteToBoneOf } from '../../../rig/skinned';
import {
  metresPerPx,
  type PaintSurface,
  paneRay,
  pickSurfaces,
  projectToPane,
  ROTATE_RING_PX,
  type SurfaceHit,
  worldPositions,
} from './pick';
import { paintSkinToolDef } from './tool';

export type WeightMode = 'off' | 'greyscale' | 'ramp' | 'influences';

interface SurfaceCache {
  readonly version: number;
  readonly pose: number;
  readonly data: unknown;
  readonly surface: PaintSurface;
  readonly world: Float64Array;
}

export class RigSkinRuntime {
  readonly ring = new BrushRing();
  /** The test-rotate ring on the active influence's joint (`E` in Skin mode). */
  readonly rotateRing = new BrushRing(document.body, 'test-rotate');
  private display: SkinnedCharacterDisplay | null = null;
  private mod: MeshView | null = null;
  private readonly weights = new Map<MeshId, { readonly surface: SkinnedSurface; readonly display: WeightDisplay }>();
  private readonly cache = new Map<MeshId, SurfaceCache>();
  private readonly disposers: Disposer[] = [];
  private disposed = false;
  private lastMode: string | null = null;
  private pickPending = false;
  /** True while a stroke owns the brush ring. */
  stroking = false;
  /** Bytes the weight display's last refresh uploaded (the §5.25 gate: 0 on an active-influence switch). */
  lastUploadBytes = 0;

  constructor(
    readonly app: EditorApp,
    readonly vm: ViewportManager,
  ) {}

  async start(): Promise<void> {
    const [mod, rig] = await Promise.all([loadMeshView(), loadViewportRig()]);
    if (this.disposed) return;
    this.mod = mod;
    this.display = rig.attachSkinnedDisplay(this.app, this.vm, mod, {
      theme: mod.readMeshViewTheme(this.vm.renderer.domElement),
    });
    const refresh = (): void => this.refresh();
    this.disposers.push(
      this.app.contribute({ kind: 'tool', def: paintSkinToolDef(this) }),
      this.app.session.subscribe(refresh),
      this.app.store.subscribe(refresh),
      this.app.meshes.subscribe(refresh),
      this.app.characters.subscribe(refresh),
      this.vm.subscribePanes(refresh),
      this.hover(),
      subscribeSkinTestRotate(this.app, () => this.showRotateRing(this.vm.activePaneId())),
    );
    this.refresh();
  }

  /** The active character of Skin mode (a model character), or null. */
  character(): CharacterId | null {
    return skinCharacter(this.app);
  }

  /** The skinned surface of a shown bound mesh. */
  surfaceOf(mesh: MeshId): SkinnedSurface | null {
    return this.display?.surfaceOf(mesh) ?? null;
  }

  /** The paintable surfaces (posed, cached per mesh revision and pose version) of the active character. */
  surfaces(): PaintSurface[] {
    const character = this.character();
    if (character === null || this.display === null) return [];
    const runtime = this.app.characters.get(character);
    const record = this.app.store.get('characters', character);
    const hidden = this.app.session.getState().model.hiddenObjects;
    const out: PaintSurface[] = [];
    for (const mesh of boundMeshesOf(this.app, character)) {
      if (hidden.has(mesh)) continue;
      const cached = this.surfaceCache(mesh, runtime?.pose.version ?? -1, record?.placement ?? null);
      if (cached !== null) out.push(cached.surface);
    }
    return out;
  }

  /** World positions of a surface (cached with it). */
  worldOf(surface: PaintSurface): Float64Array {
    return this.cache.get(surface.mesh as MeshId)?.world ?? worldPositions(surface);
  }

  private surfaceCache(
    mesh: MeshId,
    pose: number,
    placement: { readonly t: readonly number[]; readonly q: readonly number[]; readonly s: readonly number[] } | null,
  ): SurfaceCache | null {
    const runtime = this.app.meshes.get(mesh);
    const data = runtime?.data() ?? null;
    if (runtime === undefined || data === null) return null;
    // Refit once per revision and pose (never per stamp, §5.11): the weights a stroke previews do not move it.
    const hit = this.cache.get(mesh);
    if (hit !== undefined && hit.version === runtime.version && hit.pose === pose && hit.data === data) return hit;
    const inputs = weightInputsNow(this.app, mesh);
    const posed = this.display?.posedPoints(mesh) ?? null;
    if (inputs === null || posed === null) return null;
    const surface: PaintSurface = {
      mesh,
      positions: posed,
      tris: inputs.geometry.tris,
      graph: pointGraphCached(inputs.geometry),
      pointTris: pointTrianglesCached(inputs.geometry),
      placement: {
        t: (placement?.t ?? [0, 0, 0]) as [number, number, number],
        q: (placement?.q ?? [0, 0, 0, 1]) as [number, number, number, number],
        s: (placement?.s ?? [1, 1, 1]) as [number, number, number],
      },
    };
    const entry: SurfaceCache = { version: runtime.version, pose, data, surface, world: worldPositions(surface) };
    this.cache.set(mesh, entry);
    return entry;
  }

  /** The hit under a pane point (pane CSS px) among the paintable surfaces, or null. */
  hitAt(paneId: string, x: number, y: number, only?: MeshId): SurfaceHit | null {
    const ray = paneRay(this.vm, paneId, x, y);
    if (ray === null) return null;
    const surfaces = this.surfaces().filter((surface) => only === undefined || surface.mesh === only);
    const world = new Map(surfaces.map((surface) => [surface, this.worldOf(surface)] as const));
    return pickSurfaces(surfaces, ray, world);
  }

  /** The SkeletonDesc node of a joint (palette key) of the active character, or −1. */
  boneOf(joint: string): number {
    const character = this.character();
    const runtime = character === null ? undefined : this.app.characters.get(character);
    const record = this.app.store.get('joints', joint as never);
    if (runtime === undefined || record === undefined) return -1;
    return runtime.skeleton.jointKeys?.indexOf(record.key) ?? -1;
  }

  /** The weight display mode the panes ask for in Skin mode ('off' outside it). */
  weightMode(): WeightMode {
    const state = this.app.session.getState();
    if (state.workspace !== 'rig' || state.rig.mode !== 'skin') return 'off';
    for (const pane of this.vm.paneIds()) {
      const mode = this.vm.paneState(pane)?.display.weights;
      if (mode !== undefined && mode !== 'off') return mode;
    }
    return 'off';
  }

  /** Toggles the weight display of every pane between off and greyscale (Alt+C in Skin mode, §7). */
  toggleWeights(): void {
    const on = this.weightMode() !== 'off';
    for (const pane of this.vm.paneIds()) {
      const state = this.vm.paneState(pane);
      if (state === null) continue;
      this.vm.updatePane(pane, { display: { ...state.display, weights: on ? 'off' : 'greyscale' } });
    }
  }

  /** Brings the weight displays in line with the shown surfaces, the mode and the active influence. */
  refresh(): void {
    if (this.disposed || this.display === null || this.mod === null) return;
    const state = this.app.session.getState();
    const mode = state.workspace === 'rig' ? state.rig.mode : null;
    if (mode !== this.lastMode) {
      const entering = mode === 'skin';
      this.lastMode = mode;
      if (entering) this.enterSkin();
      else {
        this.pickPending = false;
        this.ring.hide();
        this.rotateRing.hide();
      }
    }
    if (this.pickPending) this.pickFirstInfluence();
    const character = this.character();
    const meshes = character === null ? [] : boundMeshesOf(this.app, character);
    const keep = new Set<MeshId>();
    const weightMode = this.weightMode();
    const active = state.rig.activeInfluence;
    const bone = active === null ? -1 : this.boneOf(active.joint);
    let bytes = 0;
    for (const mesh of meshes) {
      const surface = this.display.surfaceOf(mesh);
      if (surface === null) continue;
      keep.add(mesh);
      let entry = this.weights.get(mesh);
      if (entry === undefined || entry.surface !== surface) {
        entry?.display.dispose();
        entry = { surface, display: new this.mod.WeightDisplay(surface.root) };
        this.weights.set(mesh, entry);
      }
      if (entry.display.set(weightMode, bone)) this.vm.invalidate();
      bytes += surface.uploadedBytes;
    }
    for (const [mesh, entry] of this.weights) {
      if (keep.has(mesh)) continue;
      entry.display.dispose();
      this.weights.delete(mesh);
    }
    this.lastUploadBytes = bytes;
  }

  /** Skin mode entered: weights shown (greyscale where off), the brush mirror follows the skeleton's symmetry. */
  private enterSkin(): void {
    for (const pane of this.vm.paneIds()) {
      const state = this.vm.paneState(pane);
      if (state !== null && state.display.weights === 'off') {
        this.vm.updatePane(pane, { display: { ...state.display, weights: 'greyscale' } });
      }
    }
    const character = this.character();
    const skeleton = character === null ? undefined : this.app.store.query.skeletonOfCharacter(character);
    if (skeleton !== undefined) setBrush(this.app, { mirror: skeleton.symmetry });
    this.pickPending = true;
    this.pickFirstInfluence();
  }

  /**
   * The paint tool starts with an influence picked: the first weighted joint of the first target mesh (skeleton
   * order). Bind Skin enters Skin mode inside its own transaction, before the mesh is bound, so the pick waits for the
   * bound mesh (`refresh` retries while pending; M6b acceptance fix M6B-AF-1).
   */
  private pickFirstInfluence(): void {
    const character = this.character();
    if (!this.pickPending || this.app.session.getState().rig.activeInfluence !== null || character === null) return;
    const mesh = skinTargets(this.app)[0];
    const first = mesh === undefined ? undefined : influencesOf(this.app, [mesh])[0];
    if (mesh === undefined || first === undefined) return;
    this.pickPending = false;
    // U state written after the mode switch's run (an operator never runs inside another one's apply).
    queueMicrotask(() => {
      const rig = this.app.session.getState().rig;
      if (rig.activeInfluence === null && rig.mode === 'skin') {
        this.app.session.setState({ rig: { ...rig, activeInfluence: { mesh, joint: first } } });
      }
    });
  }

  /** Live preview of a stroke: the surface's partial weight upload (a grown palette rebuilds its bone map). */
  previewWeights(mesh: MeshId, skin: SkinWeights, changed: Uint32Array | 'all', base: SkinWeights): void {
    const surface = this.surfaceOf(mesh);
    const character = this.character();
    const runtime = character === null ? undefined : this.app.characters.get(character);
    if (surface === null || runtime === undefined) return;
    if (skin.palette.length !== base.palette.length && surface.current !== null) {
      const meshRuntime = this.app.meshes.get(mesh);
      const data = surface.current;
      if (meshRuntime === undefined) return;
      surface.setData(
        data,
        meshRuntime.triangulation(),
        meshRuntime.normals(),
        skin,
        null,
        paletteToBoneOf(this.app, runtime.skeleton, skin.palette),
      );
    } else {
      surface.updateWeights(skin, changed);
    }
    this.vm.invalidate();
  }

  /** The hover ring: follows the pointer over the panes while the tool is active in Skin mode. */
  private hover(): Disposer {
    const onMove = (event: PointerEvent): void => {
      if (this.stroking) return;
      if (!this.toolActive()) {
        if (this.ring.state !== null) this.ring.hide();
        return;
      }
      const pane = this.vm.paneAt(event.clientX, event.clientY);
      const rect = pane === null ? null : this.vm.paneRect(pane);
      if (pane === null || rect === null) {
        this.ring.hide();
        return;
      }
      this.showRing(pane, event.clientX - rect.x, event.clientY - rect.y, event.altKey);
      this.showRotateRing(pane);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }

  /** Whether the Paint Skin Weights tool is the active viewport tool in Skin mode. */
  toolActive(): boolean {
    const state = this.app.session.getState();
    return state.workspace === 'rig' && state.rig.mode === 'skin' && state.tools.viewport === 'paintSkinWeights';
  }

  /** Draws the ring (and the partner ring, the readout) at a pane point. */
  showRing(paneId: string, x: number, y: number, alt: boolean): SurfaceHit | null {
    const rect = this.vm.paneRect(paneId);
    if (rect === null) return null;
    const state = this.app.session.getState();
    const brush = state.rig.paint.brush;
    const hit = this.hitAt(paneId, x, y);
    let partner: { x: number; y: number; radius: number } | null = null;
    const readout: string[] = [];
    if (hit !== null) {
      const camera = this.vm.camera(paneId);
      const mpp = metresPerPx(camera, rect.h, hit.point);
      if (brush.mirror) {
        const mirrored = projectToPane(camera, rect.w, rect.h, [-hit.point[0], hit.point[1], hit.point[2]]);
        if (mirrored !== null && mpp > 0) {
          const mppPartner = metresPerPx(camera, rect.h, [-hit.point[0], hit.point[1], hit.point[2]]);
          partner = {
            x: rect.x + mirrored.x,
            y: rect.y + mirrored.y,
            radius: mppPartner > 0 ? (brush.radiusPx * mpp) / mppPartner : brush.radiusPx,
          };
          if (Math.hypot(partner.x - (rect.x + x), partner.y - (rect.y + y)) < 2) partner = null;
        }
      }
      readout.push(...this.readout(hit, alt));
    }
    this.ring.show({
      x: rect.x + x,
      y: rect.y + y,
      radius: brush.radiusPx,
      volume: brush.reach === 'volume',
      partner,
      readout,
      idle: hit === null,
    });
    return hit;
  }

  /** The stored skin of a bound mesh's current revision (read once per revision). */
  skinOf(mesh: MeshId): SkinWeights | null {
    const data = this.app.meshes.get(mesh)?.data() ?? null;
    if (data === null) return null;
    const cached = skins.get(data);
    if (cached !== undefined) return cached;
    const skin = meshKernel()?.readSkin(data) ?? null;
    if (skin !== null) skins.set(data, skin);
    return skin;
  }

  /** The active influence's joint on screen (pane px) and the control that drives it, or null. */
  rotateTarget(
    paneId: string,
  ): { readonly x: number; readonly y: number; readonly control: ControlId; readonly character: CharacterId } | null {
    const active = this.app.session.getState().rig.activeInfluence;
    const character = this.character();
    const rect = this.vm.paneRect(paneId);
    if (active === null || character === null || rect === null) return null;
    const node = this.boneOf(active.joint);
    const runtime = this.app.characters.get(character);
    if (node < 0 || runtime === undefined) return null;
    const control = this.vm.toolHost.controlForJoint(character, node);
    if (control === null) return null;
    const m = runtime.pose.boneWorld;
    const t = this.app.store.get('characters', character)?.placement.t ?? [0, 0, 0];
    const world: [number, number, number] = [
      (m[16 * node + 12] ?? 0) + t[0],
      (m[16 * node + 13] ?? 0) + t[1],
      (m[16 * node + 14] ?? 0) + t[2],
    ];
    const screen = projectToPane(this.vm.camera(paneId), rect.w, rect.h, world);
    return screen === null ? null : { ...screen, control, character };
  }

  /** Draws the test-rotate ring in a pane while it is on (hidden otherwise). */
  showRotateRing(paneId: string | null): void {
    const rect = paneId === null ? null : this.vm.paneRect(paneId);
    const target =
      paneId === null || !skinTestRotate(this.app) || !this.toolActive() ? null : this.rotateTarget(paneId);
    if (target === null || rect === null) {
      if (this.rotateRing.state !== null) this.rotateRing.hide();
      return;
    }
    this.rotateRing.show({
      x: rect.x + target.x,
      y: rect.y + target.y,
      radius: ROTATE_RING_PX,
      volume: true,
      partner: null,
      readout: ['Test rotate'],
      idle: false,
    });
  }

  /** `0.62 · leftLowerArm`; with Alt the point's full list (≤ 4 rows). */
  private readout(hit: SurfaceHit, alt: boolean): string[] {
    const skin = this.skinOf(hit.surface.mesh as MeshId);
    if (skin === null) return [];
    const w = this.worldOf(hit.surface);
    let v = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 3; k++) {
      const p = hit.surface.tris[3 * hit.tri + k] as number;
      const d = Math.hypot(
        (w[3 * p] as number) - hit.point[0],
        (w[3 * p + 1] as number) - hit.point[1],
        (w[3 * p + 2] as number) - hit.point[2],
      );
      if (d < best) {
        best = d;
        v = p;
      }
    }
    const rows: [string, number][] = [];
    for (let k = 0; k < 4; k++) {
      const weight = skin.weights[4 * v + k] as number;
      const key = skin.palette[skin.joints[4 * v + k] as number]?.key;
      if (weight > 0 && key !== undefined) rows.push([key, weight]);
    }
    if (alt) return rows.map(([key, weight]) => `${weight.toFixed(2)} · ${jointName(this.app, key)}`);
    const active = this.app.session.getState().rig.activeInfluence?.joint ?? null;
    if (active === null) return ['Pick an influence (Paint Weights)'];
    const weight = rows.find(([key]) => key === active)?.[1] ?? 0;
    return [`${weight.toFixed(2)} · ${jointName(this.app, active)}`];
  }

  /**
   * The active influence's weight of every visible point of the shown bound meshes in a pane (page CSS px; text with
   * 2 decimals, '0.00' included) — the numbers overlay's labels (§5.12; the overlay itself arrives after the MVP) and the
   * posed screen positions tests paint at. A point is visible when it is in the pane, one of its triangles faces the
   * camera and the pane ray through it hits it first.
   */
  weightLabels(paneId: string): { mesh: string; point: number; text: string; x: number; y: number }[] {
    const rect = this.vm.paneRect(paneId);
    if (rect === null) return [];
    const camera = this.vm.camera(paneId);
    const active = this.app.session.getState().rig.activeInfluence?.joint ?? null;
    const surfaces = this.surfaces();
    const world = new Map(surfaces.map((surface) => [surface, this.worldOf(surface)] as const));
    const out: { mesh: string; point: number; text: string; x: number; y: number }[] = [];
    for (const surface of surfaces) {
      const skin = this.skinOf(surface.mesh as MeshId);
      const w = world.get(surface) as Float64Array;
      if (skin === null) continue;
      const P = Math.floor(w.length / 3);
      for (let v = 0; v < P; v++) {
        const point: [number, number, number] = [w[3 * v] as number, w[3 * v + 1] as number, w[3 * v + 2] as number];
        const screen = projectToPane(camera, rect.w, rect.h, point);
        if (screen === null || screen.x < 0 || screen.y < 0 || screen.x > rect.w || screen.y > rect.h) continue;
        const ray = paneRay(this.vm, paneId, screen.x, screen.y);
        const hit = ray === null ? null : pickSurfaces(surfaces, ray, world);
        if (hit === null || hit.surface !== surface) continue;
        const corners = [0, 1, 2].map((k) => surface.tris[3 * hit.tri + k] as number);
        const near = Math.hypot(hit.point[0] - point[0], hit.point[1] - point[1], hit.point[2] - point[2]);
        if (!corners.includes(v) && near > 1e-4) continue;
        let weight = 0;
        for (let k = 0; k < 4; k++) {
          if (skin.palette[skin.joints[4 * v + k] as number]?.key === active)
            weight += skin.weights[4 * v + k] as number;
        }
        out.push({ mesh: surface.mesh, point: v, text: weight.toFixed(2), x: rect.x + screen.x, y: rect.y + screen.y });
      }
    }
    return out;
  }

  /** Test probe: the weight display state per shown mesh. */
  weightState(): {
    readonly mesh: MeshId;
    readonly mode: string;
    readonly active: number;
    readonly visible: boolean;
  }[] {
    return [...this.weights].map(([mesh, entry]) => ({ mesh, ...entry.display.state }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    for (const entry of this.weights.values()) entry.display.dispose();
    this.weights.clear();
    this.display?.dispose();
    this.display = null;
    this.ring.dispose();
    this.rotateRing.dispose();
  }
}

/** Stored skins per revision (MeshData is immutable). */
const skins = new WeakMap<object, SkinWeights>();

const graphs = new WeakMap<SkinGeometry, { readonly start: Int32Array; readonly next: Int32Array }>();
function pointGraphCached(geometry: SkinGeometry): { readonly start: Int32Array; readonly next: Int32Array } {
  let graph = graphs.get(geometry);
  const kernel = meshKernel();
  if (graph === undefined && kernel !== null) {
    graph = kernel.pointGraph(geometry);
    graphs.set(geometry, graph);
  }
  return graph ?? { start: new Int32Array(1), next: new Int32Array(0) };
}

const incident = new WeakMap<SkinGeometry, { readonly start: Int32Array; readonly tris: Int32Array }>();
function pointTrianglesCached(geometry: SkinGeometry): { readonly start: Int32Array; readonly tris: Int32Array } {
  let value = incident.get(geometry);
  const kernel = meshKernel();
  if (value === undefined && kernel !== null) {
    value = kernel.pointTriangles(geometry);
    incident.set(geometry, value);
  }
  return value ?? { start: new Int32Array(1), tris: new Int32Array(0) };
}

/** Starts the runtime of a viewport (./index.ts keeps it per app and disposes it). */
export function startRigSkin(app: EditorApp, vm: ViewportManager): RigSkinRuntime {
  const runtime = new RigSkinRuntime(app, vm);
  void runtime.start().catch((error: unknown) => {
    app.services.notify.toast({
      kind: 'error',
      text: `Skin mode could not load: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
  return runtime;
}
