// Per-mesh component state of the selection service (M6A-SPEC §4.6, §5.6; B10): the selection of every kind (per-mode
// memory: each kind keeps its bitset, pick order and active component across mode switches), the explicitly hidden
// components, the revision the indices belong to and a small cache of the state seen at earlier revisions (undo and
// redo of a topology commit bring the selection of that revision back). Kernel values (BitSet) come from the lazy
// kernel chunk; nothing here imports kernel code.
import type { BitSet, ComponentKind, ComponentSelection, HiddenSet } from '@ekza-animator/mesh-core';
import type { MeshKernel } from '../../mesh';
import type { MeshRuntime } from '../../types';

export const KINDS: readonly ComponentKind[] = ['vertex', 'edge', 'face'];

/** Element counts per component kind. */
export interface Sizes {
  readonly vertex: number;
  readonly edge: number;
  readonly face: number;
}

export const NO_SIZES: Sizes = { vertex: 0, edge: 0, face: 0 };

export function sizesOf(counts: { readonly points: number; readonly edges: number; readonly faces: number }): Sizes {
  return { vertex: counts.points, edge: counts.edges, face: counts.faces };
}

export function sameSizes(a: Sizes, b: Sizes): boolean {
  return a.vertex === b.vertex && a.edge === b.edge && a.face === b.face;
}

/** The counts the mesh shows now: its edit mesh while open (a commit changes it first), else its stored revision. */
export function liveSizes(runtime: MeshRuntime): Sizes | null {
  const counts = runtime.mesh?.counts ?? runtime.data()?.counts;
  return counts === undefined ? null : sizesOf(counts);
}

/** The counts of the committed revision (its stored form), or null before it is ready. */
export function committedSizes(runtime: MeshRuntime): Sizes | null {
  const counts = runtime.data()?.counts;
  return counts === undefined ? null : sizesOf(counts);
}

export interface KindState {
  set: BitSet;
  /** Pick order (Bridge, Target Weld, partial loops); every member of `set` once, oldest first. */
  order: number[];
  /** The lead (last picked) component, −1 = none. */
  active: number;
}

/** The state of one mesh at one revision, frozen (copies). */
export interface Frozen {
  readonly sizes: Sizes;
  readonly sel: Readonly<
    Record<ComponentKind, { readonly set: BitSet; readonly order: readonly number[]; readonly active: number }>
  >;
  readonly hidden: Readonly<Record<ComponentKind, BitSet>>;
}

export interface MeshState {
  /** The runtime the indices belong to; a new runtime for the id (a document load) starts a fresh state. */
  readonly runtime: MeshRuntime;
  /** Manifest of the revision the indices are known to index. */
  rev: string | null;
  /** True after `set`/`remap` wrote indices of a revision that is not committed yet (inside a commit, §5.5). */
  pending: boolean;
  sizes: Sizes;
  readonly sel: Record<ComponentKind, KindState>;
  /** Explicitly hidden components; edges and vertices only hidden faces use are derived (`hiddenClosure`). */
  readonly hidden: Record<ComponentKind, BitSet>;
  /** The state last seen at earlier revisions (most recent last), for undo and redo across commits. */
  readonly revs: Map<string, Frozen>;
  /** Bumps on every change (closure cache key). */
  version: number;
  closure: { readonly version: number; readonly value: HiddenSet } | null;
}

/** How many earlier revisions a mesh remembers its selection for. */
export const REVISION_MEMORY = 24;

export function emptyKind(kernel: MeshKernel, size: number): KindState {
  return { set: new kernel.BitSet(size), order: [], active: -1 };
}

export function freshState(kernel: MeshKernel, runtime: MeshRuntime, sizes: Sizes): MeshState {
  return {
    runtime,
    rev: runtime.ref?.manifest ?? null,
    pending: false,
    sizes,
    sel: {
      vertex: emptyKind(kernel, sizes.vertex),
      edge: emptyKind(kernel, sizes.edge),
      face: emptyKind(kernel, sizes.face),
    },
    hidden: {
      vertex: new kernel.BitSet(sizes.vertex),
      edge: new kernel.BitSet(sizes.edge),
      face: new kernel.BitSet(sizes.face),
    },
    revs: new Map(),
    version: 0,
    closure: null,
  };
}

/** Keeps `order` and `active` consistent with `set` (members only, in order; the active one a member). */
export function tidyKind(kind: KindState): void {
  const seen = new Set<number>();
  const order: number[] = [];
  for (const i of kind.order) {
    if (!kind.set.has(i) || seen.has(i)) continue;
    seen.add(i);
    order.push(i);
  }
  if (order.length !== kind.set.count()) {
    kind.set.forEach((i) => {
      if (!seen.has(i)) order.push(i);
    });
  }
  kind.order = order;
  if (!kind.set.has(kind.active)) kind.active = order.length === 0 ? -1 : (order.at(-1) as number);
}

/** Resizes every set to `sizes` (indices below the new size are kept, the rest dropped). */
export function fitState(state: MeshState, sizes: Sizes): boolean {
  if (sameSizes(state.sizes, sizes)) return false;
  for (const kind of KINDS) {
    const k = state.sel[kind];
    if (k.set.size !== sizes[kind]) {
      k.set.resize(sizes[kind]);
      tidyKind(k);
    }
    const h = state.hidden[kind];
    if (h.size !== sizes[kind]) h.resize(sizes[kind]);
  }
  state.sizes = sizes;
  state.version++;
  return true;
}

/** Clears every selection (hidden sets stay). */
export function clearSelections(state: MeshState): void {
  for (const kind of KINDS) {
    const k = state.sel[kind];
    k.set.clear();
    k.order = [];
    k.active = -1;
  }
  state.version++;
}

export function freeze(state: MeshState): Frozen {
  const sel = {} as Record<ComponentKind, { set: BitSet; order: readonly number[]; active: number }>;
  const hidden = {} as Record<ComponentKind, BitSet>;
  for (const kind of KINDS) {
    const k = state.sel[kind];
    sel[kind] = { set: k.set.clone(), order: [...k.order], active: k.active };
    hidden[kind] = state.hidden[kind].clone();
  }
  return { sizes: state.sizes, sel, hidden };
}

export function thaw(state: MeshState, frozen: Frozen): void {
  for (const kind of KINDS) {
    const k = state.sel[kind];
    const f = frozen.sel[kind];
    k.set = f.set.clone();
    k.order = [...f.order];
    k.active = f.active;
    state.hidden[kind] = frozen.hidden[kind].clone();
  }
  state.sizes = frozen.sizes;
  state.version++;
}

/** Records the state as the one of its revision (most recent last, bounded). */
export function remember(state: MeshState): void {
  if (state.rev === null || state.pending) return;
  state.revs.delete(state.rev);
  state.revs.set(state.rev, freeze(state));
  while (state.revs.size > REVISION_MEMORY) {
    const oldest = state.revs.keys().next().value;
    if (oldest === undefined) break;
    state.revs.delete(oldest);
  }
}

/** `set` minus `minus` (a copy). */
export function without(set: BitSet, minus: BitSet | null): BitSet {
  const out = set.clone();
  if (minus === null || minus.size !== set.size) return out;
  const a = out.words;
  const b = minus.words;
  for (let w = 0; w < a.length; w++) a[w] = (a[w] as number) & ~(b[w] as number);
  return out;
}

/** The selection a kind state describes, as the kernel value object (copies; hidden members left out). */
export function selectionValue(state: MeshState, kind: ComponentKind, hidden: HiddenSet | null): ComponentSelection {
  const hiddenOf = (k: ComponentKind): BitSet | null =>
    hidden === null ? null : k === 'vertex' ? hidden.verts : k === 'edge' ? hidden.edges : hidden.faces;
  const verts = without(state.sel.vertex.set, hiddenOf('vertex'));
  const edges = without(state.sel.edge.set, hiddenOf('edge'));
  const faces = without(state.sel.face.set, hiddenOf('face'));
  const target = kind === 'vertex' ? verts : kind === 'edge' ? edges : faces;
  const order = state.sel[kind].order.filter((i) => target.has(i));
  const active = target.has(state.sel[kind].active) ? state.sel[kind].active : (order.at(-1) ?? -1);
  return { kind, verts, edges, faces, order: order.length === 0 ? null : Uint32Array.from(order), active };
}

/** The bitset of `kind` in a selection or hidden set. */
export function setOf(
  value: { readonly verts: BitSet; readonly edges: BitSet; readonly faces: BitSet },
  kind: ComponentKind,
): BitSet {
  return kind === 'vertex' ? value.verts : kind === 'edge' ? value.edges : value.faces;
}
