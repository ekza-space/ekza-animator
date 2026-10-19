// The component selection service (M6A-SPEC §4.6 `ComponentSelectionService`, §5.6; B10).
//
// - Per mesh and per kind: a bitset, the pick order and the active component (per-mode memory: switching modes keeps
//   every kind's set). Reads are copies; hidden members are left out of what `get` returns, so walkers and ops never
//   see them (the stored picks keep them, so undoing a hide brings the selection back as it was).
// - Hidden components: faces are the primary hide (component hides convert to faces, as Maya does); `hidden()` adds
//   every edge whose faces are all hidden and every vertex whose edges are all hidden (mesh-view's rule, M6A-B6-6).
// - Revisions: the indices belong to the mesh's committed revision (`MeshRuntime.ref`). A `set`/`remap` whose sizes
//   differ from the committed ones (inside a commit, before its batch) is pending and becomes the new revision's state
//   when the runtime follows the commit. When the runtime moves to another revision (undo, redo, a peer's change), the
//   state remembered for that revision comes back; without one the selection stays when the sizes are unchanged and
//   is cleared otherwise (hidden sets are resized: new elements visible).
// - Symmetry (§5.6 mirrored selection): the stored set holds the picks; `expanded` adds the partners of the mesh's
//   symmetry map (`MeshRuntime.symmetry()`), `mirrored` is what the expansion adds (HUD "+N sym", the 60 % glyphs).
//   Removal gestures on either side remove the pick and its partner.
// - `session.model.components` (counts over the hilited meshes) and the runtimes' edit links follow the session: the
//   hilited meshes are open while a component mode is active in Model and closed otherwise (§5.5 rule 8).
import { type Disposer, EkzaError } from '@ekza-animator/anim-core';
import type { MeshId } from '@ekza-animator/doc';
import type {
  BitSet,
  ComponentKind,
  ComponentSelection,
  ElementRemap,
  HiddenSet,
  SymmetryMap,
} from '@ekza-animator/mesh-core';
import { type MeshKernel, meshKernel } from '../../mesh';
import type {
  ComponentCounts,
  ComponentSelectionService,
  HideSnapshot,
  MeshRuntimeRegistry,
  MeshSelectionSnapshot,
  SelectMode,
  SelectionSnapshot,
  SessionState,
  SessionStore,
} from '../../types';
import {
  clearSelections,
  committedSizes,
  fitState,
  freshState,
  type Frozen,
  freeze,
  KINDS,
  liveSizes,
  type MeshState,
  noteRevision,
  remember,
  sameSizes,
  selectionValue,
  setOf,
  type Sizes,
  thaw,
  tidyKind,
} from './state';
import { facesTouching, hiddenClosure } from './topology';

export interface ComponentSelectionDeps {
  readonly session: SessionStore;
  readonly meshes: () => MeshRuntimeRegistry;
}

/** The last click of a selection gesture (the first click of a double-click, §5.6 loop table). */
export interface ClickRecord {
  readonly mesh: MeshId;
  readonly kind: ComponentKind;
  readonly index: number;
  /** The mesh's state before the click (what a loop gesture on the same component reads). */
  readonly before: Frozen;
  /** `serial` when the click was applied: nothing else changed the selection since while it still equals it. */
  readonly serial: number;
}

/** B10's service beyond the §4.6 contract (operators, the viewport runtime, the HUD and the test API use it). */
export interface ComponentServiceInternals {
  /** Reconciles every mesh with its runtime (deleted meshes leave, other revisions restore or clear). */
  reconcileAll(): void;
  /** The stored picks of `kind` plus their symmetry partners (hidden left out); null for an unknown mesh. */
  expanded(mesh: MeshId, kind: ComponentKind): ComponentSelection | null;
  /** What the expansion adds (expanded minus the picks); null without a symmetry map. */
  mirrored(mesh: MeshId, kind: ComponentKind): ComponentSelection | null;
  /** The symmetry partner of a component (−1: none, or no map). */
  partnerOf(mesh: MeshId, kind: ComponentKind, index: number): number;
  /** Stores a walker or op result for `kind` (the other kinds unchanged); a stable change of the current revision. */
  store(mesh: MeshId, sel: ComponentSelection, kind: ComponentKind): void;
  /** Clears the selection of `kind` (the other kinds kept). */
  clearKind(mesh: MeshId, kind: ComponentKind): void;
  /** Hides the faces a set of `kind` touches (`selected`) or every other visible face (`unselected`). */
  hide(mesh: MeshId, kind: ComponentKind, set: BitSet, target: 'selected' | 'unselected'): void;
  /** Clears the hidden components of a mesh. */
  show(mesh: MeshId): void;
  /** The hidden-component part of a hide snapshot (`objects` filled by the caller). */
  hiddenSnapshot(meshes: readonly MeshId[]): HideSnapshot['meshes'];
  /** Selected (visible picks), mirrored and hidden counts over `meshes`. */
  counts(meshes: readonly MeshId[]): {
    readonly selected: ComponentCounts;
    readonly mirrored: ComponentCounts;
    readonly hidden: ComponentCounts;
  };
  /** Per-pane face isolate sets (`view.isolate` in face mode). */
  faceIsolate(paneId: string): ReadonlyMap<MeshId, BitSet> | null;
  setFaceIsolate(paneId: string, faces: ReadonlyMap<MeshId, BitSet> | null): void;
  /** The click the last `select.components` click applied (null after any other change). */
  lastClick(): ClickRecord | null;
  noteClick(record: Omit<ClickRecord, 'serial'>): void;
  /** Freezes a mesh's state (null for an unknown mesh). */
  freeze(mesh: MeshId): Frozen | null;
  /** Brings back a frozen state of the mesh's current revision (selections and hidden sets). */
  restoreFrozen(mesh: MeshId, frozen: Frozen): void;
  /** Runs `fn` with one publication at the end (session counts, listeners). */
  batch<T>(fn: () => T): T;
  /** The sizes the mesh's indices refer to now (null before it is ready). */
  sizes(mesh: MeshId): Sizes | null;
}

const INTERNALS = Symbol.for('ekza.componentSelection.internals');

/** The B10 internals of a selection service (null for another implementation). */
export function componentInternals(service: ComponentSelectionService): ComponentServiceInternals | null {
  const value = (service as unknown as Record<symbol, unknown>)[INTERNALS];
  return value === undefined ? null : (value as ComponentServiceInternals);
}

const ZERO: ComponentCounts = { vertex: 0, edge: 0, face: 0 };

/** The component tools that hilite in object mode (§5.6): Multi-Cut, Insert Edge Loop, Target Weld, Slide, Paint. */
export const COMPONENT_TOOLS: ReadonlySet<string> = new Set(['multiCut', 'insertLoop', 'targetWeld', 'slide', 'paint']);

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function sameCounts(a: ComponentCounts, b: ComponentCounts): boolean {
  return a.vertex === b.vertex && a.edge === b.edge && a.face === b.face;
}

/** The partner array of a kind in a symmetry map. */
function partners(map: SymmetryMap, kind: ComponentKind): Int32Array {
  return kind === 'vertex' ? map.vertex : kind === 'edge' ? map.edge : map.face;
}

/** `expandSelection` (B2); a local union of the partners while the kernel's is not available. */
function expand(kernel: MeshKernel, sel: ComponentSelection, map: SymmetryMap): ComponentSelection {
  try {
    return kernel.expandSelection(sel, map);
  } catch (error) {
    if (!(error instanceof EkzaError) || error.code !== 'not-implemented') throw error;
  }
  const add = (set: BitSet, partner: Int32Array): BitSet => {
    const out = set.clone();
    set.forEach((i) => {
      const p = partner[i] ?? -1;
      if (p >= 0 && p < out.size) out.add(p);
    });
    return out;
  };
  return {
    ...sel,
    verts: add(sel.verts, map.vertex),
    edges: add(sel.edges, map.edge),
    faces: add(sel.faces, map.face),
  };
}

export function createComponentSelectionService(deps: ComponentSelectionDeps): ComponentSelectionService {
  const states = new Map<MeshId, MeshState>();
  const listeners = new Set<(version: number) => void>();
  const isolates = new Map<string, Map<MeshId, BitSet>>();
  /** Meshes this service opened (§5.5 rule 8); only these are closed again. */
  const opened = new Set<MeshId>();
  let version = 0;
  let serial = 0;
  let click: ClickRecord | null = null;
  let batching = 0;
  let dirty = false;
  let subscribed: Disposer | null = null;

  const kernelOrThrow = (): MeshKernel => {
    const kernel = meshKernel();
    if (kernel === null) throw new EkzaError('mesh-not-ready', 'Mesh tools are loading');
    return kernel;
  };

  const modeKind = (): ComponentKind => {
    const model = deps.session.getState().model;
    return model.componentMode === 'object' ? model.lastComponentMode : model.componentMode;
  };

  // ---------- publication ----------

  const publish = (): void => {
    if (batching > 0) {
      dirty = true;
      return;
    }
    dirty = false;
    version++;
    const state = deps.session.getState();
    const counts = internals.counts(state.model.hilite);
    const current = state.model.components;
    if (
      !sameCounts(current.selected, counts.selected) ||
      !sameCounts(current.mirrored, counts.mirrored) ||
      !sameCounts(current.hidden, counts.hidden) ||
      current.version !== version
    ) {
      deps.session.setState({ model: { ...state.model, components: { version, ...counts } } });
    }
    for (const listener of Array.from(listeners)) listener(version);
  };

  /** The sizes of the mesh's committed revision (as first seen), else its stored form's. */
  const committedOf = (state: MeshState): Sizes | null => {
    const ref = state.runtime.ref?.manifest ?? null;
    return (ref === null ? undefined : state.revSizes.get(ref)) ?? committedSizes(state.runtime);
  };

  /**
   * Whether the state indexes the committed revision as it is (no pending result, no commit in flight: the edit mesh
   * has the committed sizes). Only such states are remembered for their revision.
   */
  const settled = (state: MeshState): boolean => {
    if (state.pending) return false;
    const committed = committedOf(state);
    return committed !== null && sameSizes(committed, state.sizes);
  };

  /** A change of a mesh's state: remembered for its revision when settled, then published. */
  const touched = (state: MeshState): void => {
    state.version++;
    state.closure = null;
    serial++;
    if (settled(state)) remember(state);
    publish();
  };

  // ---------- reconciliation with the runtimes ----------

  const reconcile = (mesh: MeshId): MeshState | null => {
    const kernel = meshKernel();
    const runtime = deps.meshes().get(mesh);
    let state = states.get(mesh);
    if (runtime === undefined) {
      if (state !== undefined) {
        states.delete(mesh);
        for (const map of isolates.values()) map.delete(mesh);
        if (click?.mesh === mesh) click = null;
        publish();
      }
      return null;
    }
    if (state !== undefined && state.runtime !== runtime) {
      // A new runtime for the id (the registry rebuilt it: a document load): nothing carries over.
      states.delete(mesh);
      state = undefined;
    }
    if (kernel === null || runtime.state !== 'ready') return state ?? null;
    const sizes = liveSizes(runtime);
    if (sizes === null) return state ?? null;
    const ref = runtime.ref?.manifest ?? null;
    if (state === undefined) {
      const fresh = freshState(kernel, runtime, sizes);
      states.set(mesh, fresh);
      if (settled(fresh)) remember(fresh);
      return fresh;
    }
    if (state.rev === ref) {
      // A pending result waits for its revision (the runtime may still show the committed one).
      if (state.pending) return state;
      if (fitState(state, sizes)) {
        state.closure = null;
        if (settled(state)) remember(state);
        publish();
      }
      return state;
    }
    // The committed revision moved.
    if (state.pending) {
      state.pending = false;
      fitState(state, sizes);
    } else {
      const cached = ref === null ? undefined : state.revs.get(ref);
      if (cached !== undefined && sameSizes(cached.sizes, sizes)) thaw(state, cached);
      else {
        const before = state.sizes;
        fitState(state, sizes);
        if (!sameSizes(before, sizes)) clearSelections(state);
      }
    }
    state.rev = ref;
    if (ref !== null && !state.revSizes.has(ref)) noteRevision(state, ref, sizes);
    state.closure = null;
    state.version++;
    if (click?.mesh === mesh) click = null;
    if (settled(state)) remember(state);
    publish();
    return state;
  };

  /**
   * A pending result whose commit was rolled back (§5.5 rule 3: the runtime applied the delta backward and reports a
   * change while its revision stayed): the state of the committed revision comes back.
   */
  const abandoned = (mesh: MeshId): void => {
    const state = states.get(mesh);
    const runtime = deps.meshes().get(mesh);
    if (state === undefined || runtime === undefined || !state.pending) return;
    if (state.rev !== (runtime.ref?.manifest ?? null)) return;
    const live = liveSizes(runtime);
    const committed = committedOf(state);
    if (live === null || committed === null || !sameSizes(live, committed) || sameSizes(state.sizes, committed)) return;
    state.pending = false;
    const cached = state.rev === null ? undefined : state.revs.get(state.rev);
    if (cached !== undefined && sameSizes(cached.sizes, committed)) thaw(state, cached);
    else {
      fitState(state, committed);
      clearSelections(state);
    }
    state.closure = null;
    publish();
  };

  const stateOf = (mesh: MeshId): MeshState | null => reconcile(mesh);

  const requireState = (mesh: MeshId): MeshState => {
    const state = stateOf(mesh);
    if (state === null) {
      const runtime = deps.meshes().get(mesh);
      if (runtime === undefined) throw new EkzaError('invalid-record', `No mesh runtime for ${mesh}`);
      throw new EkzaError('mesh-not-ready', `Mesh ${mesh} is ${runtime.state}`);
    }
    return state;
  };

  /** Opens the hilited meshes while a component mode is active in Model; closes what it opened otherwise. */
  /**
   * §5.6 "Component tools in object mode": activating one of them in object mode hilites the selected meshes (their
   * components are what the tool works on) without changing the mode; the hilite ends with the tool. `previous` is the
   * hilite list it replaced (kept for the Last-op card's comparison, §5.7).
   */
  let toolHilite: { readonly previous: readonly MeshId[] } | null = null;

  const followTool = (s: SessionState): void => {
    const tool = s.workspace === 'model' && s.model.componentMode === 'object' && COMPONENT_TOOLS.has(s.tools.viewport);
    if (s.model.componentMode !== 'object') {
      toolHilite = null; // a component mode took over the hilite
      return;
    }
    if (tool && toolHilite === null) {
      const registry = deps.meshes();
      const selected = s.selection.objects.filter((id) => registry.get(id as MeshId) !== undefined) as MeshId[];
      toolHilite = { previous: s.model.hilite };
      if (selected.length > 0 && !sameIds(selected, s.model.hilite)) {
        deps.session.setState({ model: { ...s.model, hilite: selected } });
      }
    } else if (!tool && toolHilite !== null) {
      const { previous } = toolHilite;
      toolHilite = null;
      const model = deps.session.getState().model;
      if (!sameIds(previous, model.hilite)) deps.session.setState({ model: { ...model, hilite: previous } });
    }
  };

  const followHilite = (): void => {
    const registry = deps.meshes();
    const s = deps.session.getState();
    const active = s.workspace === 'model' && (s.model.componentMode !== 'object' || toolHilite !== null);
    const wanted = new Set<MeshId>(active ? s.model.hilite : []);
    for (const id of Array.from(opened)) {
      if (wanted.has(id) && registry.get(id) !== undefined) continue;
      opened.delete(id);
      if (registry.get(id) !== undefined) registry.close(id);
    }
    for (const id of wanted) {
      const runtime = registry.get(id);
      if (runtime === undefined || runtime.state === 'error' || opened.has(id)) continue;
      if (!runtime.isOpen) {
        registry.open(id);
        opened.add(id);
      }
    }
  };

  function ensureSubscribed(): void {
    if (subscribed !== null) return;
    let registry: MeshRuntimeRegistry;
    try {
      registry = deps.meshes();
    } catch {
      return;
    }
    const offMeshes = registry.subscribe((id) => {
      abandoned(id);
      reconcile(id);
      followHilite();
    });
    const offSession = deps.session.subscribe((s: SessionState, previous: SessionState) => {
      if (
        s.workspace === previous.workspace &&
        s.model.componentMode === previous.model.componentMode &&
        s.model.hilite === previous.model.hilite &&
        s.tools.viewport === previous.tools.viewport
      ) {
        return;
      }
      followTool(s);
      followHilite();
      if (s.model.hilite !== previous.model.hilite) publish();
    });
    subscribed = () => {
      offMeshes();
      offSession();
    };
  }

  // ---------- reads ----------

  const hiddenOf = (state: MeshState): HiddenSet => {
    if (state.closure?.version === state.version) return state.closure.value;
    const value = hiddenClosure(state.runtime.mesh, state.hidden);
    state.closure = { version: state.version, value };
    return value;
  };

  const emptyOf = (kind: ComponentKind): ComponentSelection =>
    kernelOrThrow().selectionOf(kind, [], { points: 0, edges: 0, faces: 0, corners: 0 });

  const get = (mesh: MeshId, kind?: ComponentKind): ComponentSelection => {
    const k = kind ?? modeKind();
    kernelOrThrow();
    const state = stateOf(mesh);
    if (state === null) {
      const runtime = deps.meshes().get(mesh);
      if (runtime !== undefined && runtime.state === 'loading') {
        throw new EkzaError('mesh-not-ready', `Mesh ${mesh} is loading`);
      }
      return emptyOf(k);
    }
    return selectionValue(state, k, hiddenOf(state));
  };

  const symmetryOf = (state: MeshState): SymmetryMap | null => {
    try {
      const map = state.runtime.symmetry();
      if (map === null) return null;
      const sizes = state.sizes;
      return map.vertex.length === sizes.vertex && map.edge.length === sizes.edge && map.face.length === sizes.face
        ? map
        : null;
    } catch {
      return null;
    }
  };

  const expandedOf = (state: MeshState, kind: ComponentKind): ComponentSelection => {
    const sel = selectionValue(state, kind, hiddenOf(state));
    const map = symmetryOf(state);
    if (map === null) return sel;
    const out = expand(kernelOrThrow(), sel, map);
    // Partners never reveal hidden components.
    const hidden = hiddenOf(state);
    return selectionValue(
      {
        ...state,
        sel: {
          vertex: { set: out.verts, order: [...state.sel.vertex.order], active: state.sel.vertex.active },
          edge: { set: out.edges, order: [...state.sel.edge.order], active: state.sel.edge.active },
          face: { set: out.faces, order: [...state.sel.face.order], active: state.sel.face.active },
        },
      },
      kind,
      hidden,
    );
  };

  // ---------- writes ----------

  const toggleWithPartner = (
    target: BitSet,
    index: number,
    partner: number,
    turnOn: boolean,
    order: number[],
  ): void => {
    if (turnOn) {
      target.add(index);
      order.push(index);
      return;
    }
    target.delete(index);
    if (partner >= 0 && partner < target.size) target.delete(partner);
  };

  const applyIndices = (state: MeshState, kind: ComponentKind, indices: ArrayLike<number>, mode: SelectMode): void => {
    const k = state.sel[kind];
    const size = state.sizes[kind];
    const hidden = setOf(hiddenOf(state), kind);
    const map = symmetryOf(state);
    const partner = (i: number): number => (map === null ? -1 : (partners(map, kind)[i] ?? -1));
    const picks: number[] = [];
    const seen = new Set<number>();
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n] as number;
      if (!Number.isInteger(i) || i < 0 || i >= size) {
        throw new EkzaError('out-of-range', `${kind} ${String(i)} is outside 0…${size - 1}`);
      }
      if (hidden.has(i) || seen.has(i)) continue;
      seen.add(i);
      picks.push(i);
    }
    const order = [...k.order];
    switch (mode) {
      case 'replace':
        k.set.clear();
        order.length = 0;
        for (const i of picks) toggleWithPartner(k.set, i, -1, true, order);
        break;
      case 'add':
        for (const i of picks) if (!k.set.has(i)) toggleWithPartner(k.set, i, -1, true, order);
        break;
      case 'remove':
        for (const i of picks) toggleWithPartner(k.set, i, partner(i), false, order);
        break;
      case 'toggle':
        for (const i of picks) {
          const p = partner(i);
          // Selected on either side (the pick or its derived partner): the removal takes both (§5.6).
          const on = k.set.has(i) || (p >= 0 && k.set.has(p));
          toggleWithPartner(k.set, i, p, !on, order);
        }
        break;
    }
    k.order = order;
    const last = mode === 'remove' ? -1 : (picks.filter((i) => k.set.has(i)).at(-1) ?? -1);
    if (last >= 0) k.active = last;
    tidyKind(k);
  };

  // ---------- the service ----------

  const internals: ComponentServiceInternals = {
    reconcileAll(): void {
      for (const id of Array.from(states.keys())) reconcile(id);
      for (const runtime of deps.meshes().list()) reconcile(runtime.id);
    },
    expanded(mesh, kind) {
      const state = stateOf(mesh);
      return state === null ? null : expandedOf(state, kind);
    },
    mirrored(mesh, kind) {
      const state = stateOf(mesh);
      if (state === null || symmetryOf(state) === null) return null;
      const picks = selectionValue(state, kind, hiddenOf(state));
      const all = expandedOf(state, kind);
      const minus = (a: BitSet, b: BitSet): BitSet => {
        const out = a.clone();
        b.forEach((i) => {
          if (i < out.size) out.delete(i);
        });
        return out;
      };
      return {
        kind,
        verts: minus(all.verts, picks.verts),
        edges: minus(all.edges, picks.edges),
        faces: minus(all.faces, picks.faces),
        order: null,
        active: -1,
      };
    },
    partnerOf(mesh, kind, index) {
      const state = stateOf(mesh);
      const map = state === null ? null : symmetryOf(state);
      return map === null ? -1 : (partners(map, kind)[index] ?? -1);
    },
    store(mesh, sel, kind) {
      const state = requireState(mesh);
      const set = setOf(sel, kind);
      if (set.size !== state.sizes[kind]) {
        throw new EkzaError('invalid-selection', `A ${kind} selection of size ${set.size} for ${state.sizes[kind]}`);
      }
      const k = state.sel[kind];
      k.set = set.clone();
      k.order = sel.kind === kind && sel.order !== null ? [...sel.order] : [];
      k.active = sel.kind === kind ? sel.active : -1;
      tidyKind(k);
      touched(state);
    },
    clearKind(mesh, kind) {
      const state = stateOf(mesh);
      if (state === null) return;
      const k = state.sel[kind];
      if (k.set.isEmpty() && k.order.length === 0) return;
      k.set.clear();
      k.order = [];
      k.active = -1;
      touched(state);
    },
    hide(mesh, kind, set, target) {
      const state = requireState(mesh);
      const m = state.runtime.mesh;
      if (m === null) throw new EkzaError('mesh-not-ready', `Mesh ${mesh} is not open for component edits`);
      const kernel = kernelOrThrow();
      const touchedFaces = facesTouching(kernel, m, kind, set);
      const hidden = state.hidden.face;
      if (target === 'selected') {
        touchedFaces.forEach((f) => hidden.add(f));
      } else {
        for (let f = 0; f < hidden.size; f++) if (!touchedFaces.has(f)) hidden.add(f);
      }
      touched(state);
    },
    show(mesh) {
      const state = stateOf(mesh);
      if (state === null) return;
      if (KINDS.every((kind) => state.hidden[kind].isEmpty())) return;
      for (const kind of KINDS) state.hidden[kind].clear();
      touched(state);
    },
    hiddenSnapshot(meshes) {
      const out: Record<
        string,
        { manifest: string | null; verts: Uint32Array; edges: Uint32Array; faces: Uint32Array }
      > = {};
      for (const id of meshes) {
        const state = stateOf(id);
        if (state === null) continue;
        out[id] = {
          manifest: state.runtime.ref?.manifest ?? null,
          verts: state.hidden.vertex.encode(),
          edges: state.hidden.edge.encode(),
          faces: state.hidden.face.encode(),
        };
      }
      return out;
    },
    counts(meshes) {
      const selected = { vertex: 0, edge: 0, face: 0 };
      const mirrored = { vertex: 0, edge: 0, face: 0 };
      const hidden = { vertex: 0, edge: 0, face: 0 };
      if (meshKernel() === null) return { selected: ZERO, mirrored: ZERO, hidden: ZERO };
      for (const id of meshes) {
        const state = stateOf(id);
        if (state === null) continue;
        const h = hiddenOf(state);
        const map = symmetryOf(state);
        for (const kind of KINDS) {
          const picks = selectionValue(state, kind, h);
          const n = setOf(picks, kind).count();
          selected[kind] += n;
          hidden[kind] += setOf(h, kind).count();
          if (map !== null) mirrored[kind] += setOf(expandedOf(state, kind), kind).count() - n;
        }
      }
      return { selected, mirrored, hidden };
    },
    faceIsolate(paneId) {
      return isolates.get(paneId) ?? null;
    },
    setFaceIsolate(paneId, faces) {
      if (faces === null) {
        if (!isolates.delete(paneId)) return;
      } else {
        isolates.set(paneId, new Map([...faces].map(([mesh, set]) => [mesh, set.clone()])));
      }
      serial++;
      publish();
    },
    lastClick() {
      return click !== null && click.serial === serial ? click : null;
    },
    noteClick(record) {
      click = { ...record, serial };
    },
    freeze(mesh) {
      const state = stateOf(mesh);
      return state === null ? null : freeze(state);
    },
    restoreFrozen(mesh, frozen) {
      const state = stateOf(mesh);
      if (state === null || !sameSizes(state.sizes, frozen.sizes)) return;
      thaw(state, frozen);
      touched(state);
    },
    batch<T>(fn: () => T): T {
      batching++;
      try {
        return fn();
      } finally {
        batching--;
        if (batching === 0 && dirty) publish();
      }
    },
    sizes(mesh) {
      return stateOf(mesh)?.sizes ?? null;
    },
  };

  const service: ComponentSelectionService & { readonly [INTERNALS]: ComponentServiceInternals } = {
    get version() {
      return version;
    },
    get,
    set(mesh, sel) {
      if (deps.meshes().get(mesh) === undefined) throw new EkzaError('invalid-record', `No mesh runtime for ${mesh}`);
      kernelOrThrow();
      const state = requireState(mesh);
      const sizes: Sizes = { vertex: sel.verts.size, edge: sel.edges.size, face: sel.faces.size };
      const committed = committedOf(state);
      fitState(state, sizes);
      for (const kind of KINDS) {
        const k = state.sel[kind];
        k.set = setOf(sel, kind).clone();
        k.order = sel.kind === kind && sel.order !== null ? [...sel.order] : [];
        k.active = sel.kind === kind ? sel.active : -1;
        tidyKind(k);
      }
      // Sizes of another revision than the committed one: an op's result inside its commit (pending until the
      // runtime follows the commit, §5.5).
      state.pending = committed === null || !sameSizes(committed, sizes);
      if (!state.pending) state.rev = state.runtime.ref?.manifest ?? null;
      touched(state);
    },
    apply(mesh, kind, indices, mode) {
      const state = requireState(mesh);
      applyIndices(state, kind, indices, mode);
      touched(state);
    },
    clear(mesh) {
      const ids = mesh === undefined ? Array.from(states.keys()) : [mesh];
      internals.batch(() => {
        for (const id of ids) {
          const state = stateOf(id);
          if (state === null) continue;
          if (KINDS.every((kind) => state.sel[kind].set.isEmpty())) continue;
          clearSelections(state);
          touched(state);
        }
      });
    },
    hidden(mesh): HiddenSet {
      kernelOrThrow();
      const state = stateOf(mesh);
      if (state === null) {
        const empty = emptyOf('vertex');
        return { verts: empty.verts, edges: empty.edges, faces: empty.faces };
      }
      const value = hiddenOf(state);
      return { verts: value.verts.clone(), edges: value.edges.clone(), faces: value.faces.clone() };
    },
    setHidden(mesh, hidden) {
      const state = requireState(mesh);
      for (const kind of KINDS) {
        const set = setOf(hidden, kind);
        if (set.size !== state.sizes[kind]) {
          throw new EkzaError('invalid-selection', `A hidden ${kind} set of size ${set.size} for ${state.sizes[kind]}`);
        }
        state.hidden[kind] = set.clone();
      }
      touched(state);
    },
    snapshot(meshes?: readonly MeshId[]): SelectionSnapshot {
      const s = deps.session.getState();
      const kind = modeKind();
      const out: Record<string, MeshSelectionSnapshot> = {};
      if (meshKernel() !== null) {
        for (const id of meshes ?? s.model.hilite) {
          const state = stateOf(id);
          if (state === null) continue;
          const k = state.sel[kind];
          out[id] = {
            manifest: state.runtime.ref?.manifest ?? null,
            kind,
            verts: state.sel.vertex.set.encode(),
            edges: state.sel.edge.set.encode(),
            faces: state.sel.face.set.encode(),
            order: k.order.length === 0 ? null : Uint32Array.from(k.order),
            active: k.active,
          };
        }
      }
      return {
        controls: [...s.selection.controls],
        objects: [...s.selection.objects],
        componentMode: s.model.componentMode,
        hilite: [...s.model.hilite],
        meshes: out,
      };
    },
    restore(snapshot) {
      const skipped: MeshId[] = [];
      const kernel = meshKernel();
      internals.batch(() => {
        for (const [id, snap] of Object.entries(snapshot.meshes) as [MeshId, MeshSelectionSnapshot][]) {
          const state = kernel === null ? null : stateOf(id);
          if (kernel === null || state === null || (state.runtime.ref?.manifest ?? null) !== snap.manifest) {
            skipped.push(id);
            continue;
          }
          try {
            const sets = {
              vertex: kernel.BitSet.decode(snap.verts, state.sizes.vertex),
              edge: kernel.BitSet.decode(snap.edges, state.sizes.edge),
              face: kernel.BitSet.decode(snap.faces, state.sizes.face),
            };
            for (const kind of KINDS) {
              const k = state.sel[kind];
              k.set = sets[kind];
              k.order = kind === snap.kind && snap.order !== null ? [...snap.order] : [];
              k.active = kind === snap.kind ? snap.active : -1;
              tidyKind(k);
            }
          } catch {
            skipped.push(id);
            continue;
          }
          touched(state);
        }
      });
      return { skipped };
    },
    restoreHidden(snapshot) {
      const skipped: MeshId[] = [];
      const kernel = meshKernel();
      internals.batch(() => {
        for (const [id, snap] of Object.entries(snapshot.meshes) as [MeshId, HideSnapshot['meshes'][string]][]) {
          const state = kernel === null ? null : stateOf(id);
          if (kernel === null || state === null || (state.runtime.ref?.manifest ?? null) !== snap.manifest) {
            skipped.push(id);
            continue;
          }
          try {
            const decoded = {
              vertex: kernel.BitSet.decode(snap.verts, state.sizes.vertex),
              edge: kernel.BitSet.decode(snap.edges, state.sizes.edge),
              face: kernel.BitSet.decode(snap.faces, state.sizes.face),
            };
            for (const kind of KINDS) state.hidden[kind] = decoded[kind];
          } catch {
            skipped.push(id);
            continue;
          }
          touched(state);
        }
      });
      return { skipped };
    },
    remap(mesh, remap: ElementRemap) {
      const kernel = kernelOrThrow();
      const state = requireState(mesh);
      const sizes = liveSizes(state.runtime) ?? state.sizes;
      const domain = { vertex: remap.point, edge: remap.edge, face: remap.face } as const;
      const move = (set: BitSet, kind: ComponentKind): BitSet => {
        const forward = domain[kind].forward;
        const out = new kernel.BitSet(sizes[kind]);
        set.forEach((i) => {
          const j = forward === null ? i : (forward[i] ?? -1);
          if (j >= 0 && j < out.size) out.add(j);
        });
        return out;
      };
      for (const kind of KINDS) {
        const k = state.sel[kind];
        const forward = domain[kind].forward;
        k.set = move(k.set, kind);
        k.order = k.order.map((i) => (forward === null ? i : (forward[i] ?? -1))).filter((i) => i >= 0);
        k.active = k.active < 0 ? -1 : forward === null ? k.active : (forward[k.active] ?? -1);
        tidyKind(k);
        state.hidden[kind] = move(state.hidden[kind], kind);
      }
      state.sizes = sizes;
      const committed = committedOf(state);
      state.pending = committed === null || !sameSizes(committed, sizes);
      touched(state);
    },
    subscribe(listener: (version: number) => void): Disposer {
      ensureSubscribed();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [INTERNALS]: internals,
  };
  ensureSubscribed();
  return service;
}
