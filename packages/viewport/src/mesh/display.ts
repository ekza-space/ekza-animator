// The mesh display of the viewport (M6A-SPEC §4.4, §4.7, §5.6, §5.23; B6, lazy with mesh-view): one host per mesh
// runtime, registered through `target.addMeshLayer` (B9's `ViewportManager.addMeshLayer`). A mesh shows as a
// `MeshSurface` (props in every workspace, meshes outside the hilite set) or, while a component mode is active and
// the mesh is hilited and open, as an `EditMeshView` with a `ComponentPicker`. The host follows the runtimes
// (incremental `changed` events, rebuilds), the component selection service (selection, hidden sets, symmetry
// partners), the session (mode, hilite, hidden objects, per-pane isolate) and the document (placements, palettes),
// and applies each pane's display before the pane renders ("Dim unhilited", hidden and isolated objects).
// Hover, soft weights, Mesh Check problems and face isolate sets are pushed by their owners (B10, B12a).
import type { Disposer } from '@ekza-animator/anim-core';
import { batchTables, type CharacterId, type MeshId, type MeshRecord, type PaletteId } from '@ekza-animator/doc';
import type { EditorApp, MeshRuntime } from '@ekza-animator/editor-core';
import type { BitSet, ComponentKind, ComponentSelection, HiddenSet, MeshProblem } from '@ekza-animator/mesh-core';
import type * as MeshViewModule from '@ekza-animator/mesh-view';
import type {
  ComponentPicker,
  EditMeshView,
  MeshPaneDisplay,
  MeshSurface,
  MeshViewLayers,
  MeshViewThemeInput,
  PickHit,
  PickOptions,
} from '@ekza-animator/mesh-view';
import { type Camera, Group, type Object3D, Vector3 } from 'three';
import { MESH_LAYERS } from './layers';
import { inSubtree, meshWorld } from './world';

/** What `ViewportManager.addMeshLayer` takes (§4.7). */
export interface MeshLayerHost {
  readonly root: Object3D;
  applyPane(display: MeshPaneDisplay, paneId: string): void;
  dispose(): void;
}

/** The part of the viewport the display needs: B9's `addMeshLayer` and a redraw request. */
export interface MeshLayerTarget {
  addMeshLayer(host: MeshLayerHost): Disposer;
  invalidate(): void;
}

export interface MeshDisplayOptions {
  readonly app: EditorApp;
  readonly target: MeshLayerTarget;
  /** Theme colours, or an element whose computed style holds the tokens (the canvas); default: tokens.json values. */
  readonly theme?: MeshViewThemeInput | Element;
  readonly layers?: MeshViewLayers;
  /** World matrix of a character's root, for meshes owned by a character (null or absent = identity). */
  readonly characterWorld?: (character: CharacterId) => Float64Array | null;
}

/** A pick across the hilited meshes. */
export interface MeshDisplayPick extends PickHit {
  readonly mesh: MeshId;
}

type Hover = { readonly kind: ComponentKind; readonly index: number };

interface Entry {
  readonly id: MeshId;
  readonly root: Group;
  readonly host: MeshLayerHost;
  dispose: Disposer;
  surface: MeshSurface | null;
  edit: EditMeshView | null;
  picker: ComponentPicker | null;
  /** Runtime version the view shows (−1 = nothing yet). */
  version: number;
  /** The edit mesh the edit view shows (runtimes rebuild their edit links on reopen). */
  mesh: MeshRuntime['mesh'];
  world: Float64Array;
  hover: Hover | null;
  soft: Float32Array | null;
  lints: readonly MeshProblem[];
  faceIsolate: Map<string, BitSet | null>;
  hilited: boolean;
}

function isEmptySet(h: HiddenSet): boolean {
  return h.verts.isEmpty() && h.edges.isEmpty() && h.faces.isEmpty();
}

const scratch = new Vector3();

export class MeshDisplay {
  private readonly mod: typeof MeshViewModule;
  private readonly app: EditorApp;
  private readonly target: MeshLayerTarget;
  private readonly theme: MeshViewThemeInput;
  private readonly layers: MeshViewLayers;
  private readonly characterWorld: ((character: CharacterId) => Float64Array | null) | null;
  private readonly entries = new Map<MeshId, Entry>();
  private readonly disposers: Disposer[] = [];
  private disposed = false;

  constructor(mod: typeof MeshViewModule, opts: MeshDisplayOptions) {
    this.mod = mod;
    this.app = opts.app;
    this.target = opts.target;
    const theme = opts.theme;
    this.theme =
      theme === undefined ? mod.DEFAULT_MESH_VIEW_THEME : 'halo' in theme ? theme : mod.readMeshViewTheme(theme);
    this.layers = opts.layers ?? MESH_LAYERS;
    this.characterWorld = opts.characterWorld ?? null;
    const app = this.app;
    this.disposers.push(
      app.meshes.subscribe((id, e) => {
        if (e.type === 'changed') this.changed(id, e.dirty);
        else this.sync();
      }),
      app.components.subscribe(() => this.refreshStates()),
      app.session.subscribe((state, previous) => {
        const a = state.model;
        const b = previous.model;
        if (a.componentMode !== b.componentMode || a.hilite !== b.hilite) this.sync();
        else if (a.symmetry !== b.symmetry) this.refreshStates();
        if (a.hiddenObjects !== b.hiddenObjects || a.isolate !== b.isolate) this.target.invalidate();
      }),
      app.store.subscribe((batch) => {
        const tables = batchTables(batch);
        if (batch.origin === 'load' || tables.has('meshes') || tables.has('groups') || tables.has('characters')) {
          this.sync();
        } else if (tables.has('palettes') || tables.has('swatches')) {
          for (const entry of this.entries.values()) this.applyPaint(entry);
          this.target.invalidate();
        }
      }),
    );
    this.sync();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // reconciliation

  /** Creates, switches and drops hosts to match the live runtimes and the component mode. */
  sync(): void {
    if (this.disposed) return;
    const live = new Set<MeshId>();
    for (const runtime of this.app.meshes.list()) {
      if (runtime.state !== 'ready' || runtime.data() === null) continue;
      const record = this.app.store.get('meshes', runtime.id);
      if (record === undefined) continue;
      live.add(runtime.id);
      this.syncEntry(this.entryOf(runtime.id), runtime, record);
    }
    for (const [id, entry] of this.entries) {
      if (!live.has(id)) this.drop(entry);
    }
    this.target.invalidate();
  }

  private entryOf(id: MeshId): Entry {
    const existing = this.entries.get(id);
    if (existing !== undefined) return existing;
    const root = new Group();
    root.name = `mesh:${id}`;
    const entry: Entry = {
      id,
      root,
      host: { root, applyPane: (display, paneId) => this.applyPane(entry, display, paneId), dispose: () => {} },
      dispose: () => {},
      surface: null,
      edit: null,
      picker: null,
      version: -1,
      mesh: null,
      world: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      hover: null,
      soft: null,
      lints: [],
      faceIsolate: new Map(),
      hilited: false,
    };
    entry.dispose = this.target.addMeshLayer(entry.host);
    this.entries.set(id, entry);
    return entry;
  }

  private componentMode(): ComponentKind | null {
    const mode = this.app.session.getState().model.componentMode;
    return mode === 'object' ? null : mode;
  }

  private editing(entry: Entry, runtime: MeshRuntime): boolean {
    return this.componentMode() !== null && entry.hilited && runtime.isOpen && runtime.mesh !== null;
  }

  /** A change no event reported (a runtime opened or closed, a missed version): the next pane render resyncs. */
  private stale(entry: Entry, runtime: MeshRuntime): boolean {
    if (runtime.state !== 'ready') return false;
    const editing = this.editing(entry, runtime);
    return (
      editing !== (entry.edit !== null) || entry.version !== runtime.version || (editing && entry.mesh !== runtime.mesh)
    );
  }

  private syncEntry(entry: Entry, runtime: MeshRuntime, record: MeshRecord): void {
    const model = this.app.session.getState().model;
    entry.hilited = model.hilite.includes(entry.id);
    meshWorld(this.app.store, record, this.characterWorld, entry.world);
    const editMesh = this.editing(entry, runtime) ? runtime.mesh : null;
    if (editMesh !== null) {
      if (entry.surface !== null) {
        entry.surface.dispose();
        entry.surface = null;
        entry.version = -1;
      }
      if (entry.edit === null) {
        entry.edit = new this.mod.EditMeshView({ theme: this.theme, layers: this.layers });
        entry.root.add(entry.edit.root);
        entry.picker = new this.mod.ComponentPicker();
        entry.version = -1;
      }
      const mesh = editMesh;
      if (entry.version !== runtime.version || entry.mesh !== mesh) {
        const tri = runtime.triangulation();
        entry.edit.setMesh(mesh, tri, runtime.normals());
        entry.mesh = mesh;
        entry.picker?.setMesh(mesh, tri, entry.world, true);
        entry.version = runtime.version;
      } else {
        entry.picker?.setMesh(mesh, runtime.triangulation(), entry.world, false);
      }
      entry.edit.setWorld(entry.world);
      this.applyPaint(entry);
      entry.edit.setSoftWeights(entry.soft);
      entry.edit.setLints(entry.lints);
      this.applyState(entry, runtime);
    } else {
      if (entry.edit !== null) {
        entry.edit.dispose();
        entry.edit = null;
        entry.picker?.dispose();
        entry.picker = null;
        entry.mesh = null;
        entry.version = -1;
      }
      if (entry.surface === null) {
        entry.surface = new this.mod.MeshSurface({ theme: this.theme, layers: this.layers });
        entry.root.add(entry.surface.root);
        entry.version = -1;
      }
      const data = runtime.data();
      if (data !== null && entry.version !== runtime.version) {
        entry.surface.setData(data, runtime.triangulation(), runtime.normals(), this.paletteColours(record.palette));
        entry.version = runtime.version;
      }
      entry.surface.setWorld(entry.world);
    }
  }

  private changed(id: MeshId, dirty: Parameters<EditMeshView['update']>[1]): void {
    const entry = this.entries.get(id);
    const runtime = this.app.meshes.get(id);
    if (entry === undefined || runtime === undefined || runtime.state !== 'ready') {
      this.sync();
      return;
    }
    if (entry.edit !== null && runtime.mesh !== null) {
      const tri = runtime.triangulation();
      entry.edit.update(runtime.mesh, dirty, tri, runtime.normals());
      entry.picker?.setMesh(runtime.mesh, tri, entry.world, dirty.topology);
      entry.mesh = runtime.mesh;
      entry.version = runtime.version;
      if (dirty.topology) this.applyState(entry, runtime);
    } else if (entry.surface !== null) {
      const data = runtime.data();
      const record = this.app.store.get('meshes', id);
      if (data !== null) {
        entry.surface.setData(
          data,
          runtime.triangulation(),
          runtime.normals(),
          this.paletteColours(record?.palette ?? null),
        );
        entry.version = runtime.version;
      }
    }
    this.target.invalidate();
  }

  private drop(entry: Entry): void {
    entry.surface?.dispose();
    entry.edit?.dispose();
    entry.picker?.dispose();
    entry.dispose();
    entry.root.removeFromParent();
    this.entries.delete(entry.id);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // state, paint

  /** Selection, hidden set, hover and mirrored partners of every edit view (after a selection change). */
  refreshStates(): void {
    for (const entry of this.entries.values()) {
      const runtime = this.app.meshes.get(entry.id);
      if (entry.edit !== null && runtime !== undefined) this.applyState(entry, runtime);
    }
    this.target.invalidate();
  }

  private selection(id: MeshId, kind: ComponentKind): ComponentSelection | null {
    try {
      return this.app.components.get(id, kind);
    } catch {
      return null;
    }
  }

  private hiddenOf(id: MeshId): HiddenSet | null {
    try {
      const hidden = this.app.components.hidden(id);
      return isEmptySet(hidden) ? null : hidden;
    } catch {
      return null;
    }
  }

  private applyState(entry: Entry, runtime: MeshRuntime): void {
    const kind = this.componentMode();
    const edit = entry.edit;
    if (edit === null || kind === null) return;
    const sel =
      this.selection(entry.id, kind) ?? this.mod.emptySelection(kind, runtime.mesh?.counts ?? storedCounts(runtime));
    const map = runtime.symmetry();
    const hover = entry.hover;
    const hoverState =
      hover === null
        ? null
        : { kind: hover.kind, index: hover.index, partner: this.mod.partnerOf(map, hover.kind, hover.index) };
    edit.setState(sel, this.hiddenOf(entry.id), hoverState, this.mod.mirroredOf(sel, map));
    const plane = this.symmetryPlane(entry.id, runtime);
    edit.setSymmetryPlane(plane);
  }

  private symmetryPlane(
    id: MeshId,
    runtime: MeshRuntime,
  ): { readonly axis: 'x' | 'y' | 'z'; readonly offset: number } | null {
    const settings = this.app.session.getState().model.symmetry.get(id);
    if (settings === undefined || settings.mode === 'off') return null;
    const map = runtime.symmetry();
    if (map !== null) return { axis: map.axis, offset: map.plane };
    const axis = settings.mode.slice(-1) as 'x' | 'y' | 'z';
    return { axis, offset: 0 };
  }

  private paletteColours(palette: PaletteId | null): ReadonlyMap<number, readonly [number, number, number]> | null {
    if (palette === null) return null;
    const out = new Map<number, readonly [number, number, number]>();
    for (const swatch of this.app.store.query.swatchesOfPalette(palette)) {
      if (!out.has(swatch.slot)) out.set(swatch.slot, swatch.srgb);
    }
    return out;
  }

  private applyPaint(entry: Entry): void {
    const record = this.app.store.get('meshes', entry.id);
    const colours = this.paletteColours(record?.palette ?? null);
    if (entry.edit !== null) entry.edit.setPaint(colours);
    else if (entry.surface !== null) {
      const runtime = this.app.meshes.get(entry.id);
      const data = runtime?.data() ?? null;
      if (runtime !== undefined && data !== null && entry.surface.colours !== colours) {
        entry.surface.setData(data, runtime.triangulation(), runtime.normals(), colours);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per pane

  private applyPane(entry: Entry, display: MeshPaneDisplay, paneId: string): void {
    const model = this.app.session.getState().model;
    const record = this.app.store.get('meshes', entry.id);
    const runtime = this.app.meshes.get(entry.id);
    entry.hilited = model.hilite.includes(entry.id);
    if (record !== undefined && runtime !== undefined && this.stale(entry, runtime))
      this.syncEntry(entry, runtime, record);
    let shown = record !== undefined;
    if (shown && model.hiddenObjects.size > 0)
      shown = !inSubtree(this.app.store, record as MeshRecord, model.hiddenObjects);
    const isolate = model.isolate[paneId];
    if (shown && isolate !== undefined && isolate !== null) {
      shown = inSubtree(this.app.store, record as MeshRecord, new Set<string>(isolate));
    }
    entry.root.visible = shown;
    if (!shown) return;
    const componentMode = model.componentMode !== 'object';
    const pane: MeshPaneDisplay = {
      ...display,
      dimmed: display.dimmed && componentMode && !entry.hilited,
    };
    if (entry.edit !== null) {
      entry.edit.setIsolate(entry.faceIsolate.get(paneId) ?? null);
      entry.edit.applyPane(pane);
    } else {
      entry.surface?.applyPane(pane);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // inputs from tools and panels

  /** The hovered component of a hilited mesh (B10's select tool); its symmetry partner is pre-highlighted. */
  setHover(mesh: MeshId | null, hover: Hover | null): void {
    for (const entry of this.entries.values()) {
      const next = entry.id === mesh ? hover : null;
      if (entry.hover?.kind === next?.kind && entry.hover?.index === next?.index) continue;
      entry.hover = next;
      const runtime = this.app.meshes.get(entry.id);
      if (entry.edit !== null && runtime !== undefined) this.applyState(entry, runtime);
    }
    this.target.invalidate();
  }

  /** Soft-selection weights per vertex of a mesh (B12a), null clears them. */
  setSoftWeights(mesh: MeshId, weights: Float32Array | null): void {
    const entry = this.entries.get(mesh);
    if (entry === undefined) return;
    entry.soft = weights;
    entry.edit?.setSoftWeights(weights);
    this.target.invalidate();
  }

  /** Mesh Check problems of a mesh (B10's overlay, shown in panes with `meshCheck`). */
  setLints(mesh: MeshId, problems: readonly MeshProblem[]): void {
    const entry = this.entries.get(mesh);
    if (entry === undefined) return;
    entry.lints = problems;
    entry.edit?.setLints(problems);
    this.target.invalidate();
  }

  /** Face-mode isolate of a pane (`view.isolate`, §5.6): only `faces` of the mesh are drawn there; null ends it. */
  setFaceIsolate(paneId: string, mesh: MeshId, faces: BitSet | null): void {
    const entry = this.entries.get(mesh);
    if (entry === undefined) return;
    if (faces === null) entry.faceIsolate.delete(paneId);
    else entry.faceIsolate.set(paneId, faces);
    this.target.invalidate();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // picking

  /** The picker of a hilited mesh in component mode (null otherwise). */
  picker(mesh: MeshId): ComponentPicker | null {
    return this.entries.get(mesh)?.picker ?? null;
  }

  /** The column-major world matrix the mesh is drawn with. */
  worldOf(mesh: MeshId): Float64Array | null {
    return this.entries.get(mesh)?.world ?? null;
  }

  /** Meshes with a picker (hilited and open in component mode). */
  editable(): readonly MeshId[] {
    return [...this.entries.values()].filter((e) => e.picker !== null).map((e) => e.id);
  }

  /**
   * The hover candidate over every hilited mesh: vertices and edges by screen distance (then the nearer point), faces
   * by the nearest ray hit. `opts.hidden` is replaced per mesh by its hidden set.
   */
  pick(
    camera: Camera,
    ndc: readonly [number, number],
    viewport: { readonly w: number; readonly h: number },
    kind: ComponentKind,
    opts: Omit<PickOptions, 'hidden'>,
  ): MeshDisplayPick | null {
    let best: MeshDisplayPick | null = null;
    let bestDepth = Number.POSITIVE_INFINITY;
    const eye = scratch.setFromMatrixPosition(camera.matrixWorld);
    for (const entry of this.entries.values()) {
      if (entry.picker === null) continue;
      const hit = entry.picker.hover(camera, ndc, viewport, kind, { ...opts, hidden: this.hiddenOf(entry.id) });
      if (hit === null) continue;
      const depth = Math.hypot(hit.point[0] - eye.x, hit.point[1] - eye.y, hit.point[2] - eye.z);
      const better =
        best === null ||
        (kind === 'face'
          ? depth < bestDepth
          : hit.distancePx < best.distancePx - 1e-9 ||
            (Math.abs(hit.distancePx - best.distancePx) <= 1e-9 && depth < bestDepth));
      if (better) {
        best = { ...hit, mesh: entry.id };
        bestDepth = depth;
      }
    }
    return best;
  }

  /** Marquee over every hilited mesh: the components of `kind` inside the rectangle, per mesh (empty ones left out). */
  marquee(
    camera: Camera,
    rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
    viewport: { readonly w: number; readonly h: number },
    kind: ComponentKind,
    opts: Omit<PickOptions, 'hidden'>,
  ): ReadonlyMap<MeshId, Uint32Array> {
    const out = new Map<MeshId, Uint32Array>();
    for (const entry of this.entries.values()) {
      if (entry.picker === null) continue;
      const found = entry.picker.marquee(camera, rect, viewport, kind, { ...opts, hidden: this.hiddenOf(entry.id) });
      if (found.length > 0) out.set(entry.id, found);
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
    for (const entry of this.entries.values()) this.drop(entry);
    this.target.invalidate();
  }
}

/** Counts of a runtime without edit links (the stored form). */
function storedCounts(runtime: MeshRuntime): { points: number; edges: number; faces: number } {
  const counts = runtime.data()?.counts;
  return { points: counts?.points ?? 0, edges: counts?.edges ?? 0, faces: counts?.faces ?? 0 };
}
