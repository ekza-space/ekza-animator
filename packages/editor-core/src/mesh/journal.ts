// The mesh journal (M6A-SPEC §5.5 rules 2, 4, 5; §5.20 journal cap): per mesh, the edges `from → to` between two
// revisions, each holding the kernel deltas that turn the one into the other on one EditMesh instance (its
// **lineage**: deltas may carry edit-link writes, so they apply only to the instance they were recorded on). Undo and
// redo follow an edge in O(|delta|); without one the runtime rebuilds from chunks.
//
// - Journal bytes count against `prefs.modeling.journalBudgetMB`: the oldest edges are dropped first, **except the
//   edges of the last op** (pinned), so `edit.adjustLast` always finds them.
// - Edges whose lineage is gone (a rebuild replaced the EditMesh) are useless and dropped with it.
// - Each edge also keeps what its op read (`input`: kind and selection) and the selection it left (`output`): a
//   'before-last' session re-reads the input (§5.7), and until B10 stores selections the runtime's fallback restores
//   them across undo and redo as `TxMeta.selectionBefore/After` will. Their bytes count with the deltas.
// - Pins are reported (`pinned`/`unpinned`) whenever they change, a dropped pinned edge included, so the registry's
//   ledger roots for the last op's revisions (§5.20 root 3) never outlive the edge.
import type { MeshId } from '@ekza-animator/doc';
import type { ComponentSelection, EditMesh, MeshDelta } from '@ekza-animator/mesh-core';
import { type OpInput, selectionBytes } from './input';

export interface JournalEdge {
  readonly mesh: MeshId;
  readonly from: string;
  readonly to: string;
  /** Applied in order for `from → to`, in reverse order backwards for `to → from`. */
  readonly deltas: readonly MeshDelta[];
  readonly lineage: EditMesh;
  readonly bytes: number;
  /** Commit order (older edges are evicted first). */
  readonly seq: number;
  /** What the op read on this mesh (a copy; null when unknown). */
  readonly input: OpInput | null;
  /** The selection the op left on this mesh (a copy; null when unknown). */
  readonly output: ComponentSelection | null;
}

/** Called when an edge becomes, or stops being, one of the last op's (pinned) edges. */
export interface JournalPinHooks {
  pinned?(edge: JournalEdge): void;
  unpinned?(edge: JournalEdge): void;
}

export class MeshJournal {
  private readonly edges = new Map<MeshId, JournalEdge[]>();
  private pinned = new Set<JournalEdge>();
  private total = 0;
  private seq = 0;

  constructor(private readonly hooks: JournalPinHooks = {}) {}

  get bytes(): number {
    return this.total;
  }

  /** Records an edge (the newest of its mesh). */
  add(
    mesh: MeshId,
    from: string,
    to: string,
    deltas: readonly MeshDelta[],
    lineage: EditMesh,
    selections?: { readonly input: OpInput | null; readonly output: ComponentSelection | null },
  ): JournalEdge {
    const input = selections?.input ?? null;
    const output = selections?.output ?? null;
    let bytes = selectionBytes(input?.selection ?? null) + selectionBytes(output);
    for (const delta of deltas) bytes += delta.bytes;
    const edge: JournalEdge = { mesh, from, to, deltas, lineage, bytes, seq: this.seq++, input, output };
    let list = this.edges.get(mesh);
    if (list === undefined) {
      list = [];
      this.edges.set(mesh, list);
    }
    list.push(edge);
    this.total += bytes;
    return edge;
  }

  /** The edge joining `a` and `b` (either direction) on `lineage`, newest first; null when none. */
  find(mesh: MeshId, a: string, b: string, lineage: EditMesh): JournalEdge | null {
    const list = this.edges.get(mesh);
    if (list === undefined) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const edge = list[i] as JournalEdge;
      if (edge.lineage !== lineage) continue;
      if ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)) return edge;
    }
    return null;
  }

  /** The newest edge joining `a` and `b` (either direction) on any lineage; null when none. */
  between(mesh: MeshId, a: string, b: string): JournalEdge | null {
    const list = this.edges.get(mesh);
    if (list === undefined) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const edge = list[i] as JournalEdge;
      if ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)) return edge;
    }
    return null;
  }

  /** Edges of a mesh, oldest first. */
  of(mesh: MeshId): readonly JournalEdge[] {
    return this.edges.get(mesh) ?? [];
  }

  /** True when an edge of `mesh` was recorded on `lineage`. */
  holds(mesh: MeshId, lineage: EditMesh): boolean {
    return this.of(mesh).some((edge) => edge.lineage === lineage);
  }

  /** The edges of the last op (never evicted by the cap); replaces the previous pins. */
  pin(edges: readonly JournalEdge[]): void {
    const previous = this.pinned;
    this.pinned = new Set(edges);
    // New pins first: a revision both pins share never drops to zero references in between.
    for (const edge of this.pinned) if (!previous.has(edge)) this.hooks.pinned?.(edge);
    for (const edge of previous) if (!this.pinned.has(edge)) this.hooks.unpinned?.(edge);
  }

  isPinned(edge: JournalEdge): boolean {
    return this.pinned.has(edge);
  }

  pinnedEdges(): readonly JournalEdge[] {
    return [...this.pinned];
  }

  /** Drops edges of `mesh` that `keep` rejects (pinned edges included: their lineage or revisions are gone). */
  retain(mesh: MeshId, keep: (edge: JournalEdge) => boolean): void {
    const list = this.edges.get(mesh);
    if (list === undefined) return;
    const unpinned: JournalEdge[] = [];
    const kept = list.filter((edge) => {
      if (keep(edge)) return true;
      this.total -= edge.bytes;
      if (this.pinned.delete(edge)) unpinned.push(edge);
      return false;
    });
    if (kept.length === 0) this.edges.delete(mesh);
    else this.edges.set(mesh, kept);
    for (const edge of unpinned) this.hooks.unpinned?.(edge);
  }

  /** Drops every edge of `mesh` (runtime disposed, rebuilt from chunks or loaded). */
  drop(mesh: MeshId): void {
    this.retain(mesh, () => false);
  }

  /** Drops the oldest unpinned edges until the journal holds at most `limit` bytes; returns how many went. */
  cap(limit: number): number {
    if (this.total <= limit) return 0;
    const all: JournalEdge[] = [];
    for (const list of this.edges.values()) for (const edge of list) if (!this.pinned.has(edge)) all.push(edge);
    all.sort((a, b) => a.seq - b.seq);
    const evict = new Set<JournalEdge>();
    let total = this.total;
    for (const edge of all) {
      if (total <= limit) break;
      evict.add(edge);
      total -= edge.bytes;
    }
    for (const mesh of this.edges.keys()) this.retain(mesh, (edge) => !evict.has(edge));
    return evict.size;
  }

  clear(): void {
    const previous = this.pinned;
    this.edges.clear();
    this.pinned = new Set();
    this.total = 0;
    for (const edge of previous) this.hooks.unpinned?.(edge);
  }
}
