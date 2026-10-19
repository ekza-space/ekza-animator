// The mesh journal (M6A-SPEC §5.5 rules 2, 4, 5; §5.20 journal cap): per mesh, the edges `from → to` between two
// revisions, each holding the kernel deltas that turn the one into the other on one EditMesh instance (its
// **lineage**: deltas may carry edit-link writes, so they apply only to the instance they were recorded on). Undo and
// redo follow an edge in O(|delta|); without one the runtime rebuilds from chunks.
//
// - Journal bytes count against `prefs.modeling.journalBudgetMB`: the oldest edges are dropped first, **except the
//   edges of the last op** (pinned), so `edit.adjustLast` always finds them.
// - Edges whose lineage is gone (a rebuild replaced the EditMesh) are useless and dropped with it.
import type { MeshId } from '@ekza-animator/doc';
import type { EditMesh, MeshDelta } from '@ekza-animator/mesh-core';

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
}

export class MeshJournal {
  private readonly edges = new Map<MeshId, JournalEdge[]>();
  private pinned = new Set<JournalEdge>();
  private total = 0;
  private seq = 0;

  get bytes(): number {
    return this.total;
  }

  /** Records an edge (the newest of its mesh). */
  add(mesh: MeshId, from: string, to: string, deltas: readonly MeshDelta[], lineage: EditMesh): JournalEdge {
    let bytes = 0;
    for (const delta of deltas) bytes += delta.bytes;
    const edge: JournalEdge = { mesh, from, to, deltas, lineage, bytes, seq: this.seq++ };
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
    this.pinned = new Set(edges);
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
    const kept = list.filter((edge) => {
      if (keep(edge)) return true;
      this.total -= edge.bytes;
      this.pinned.delete(edge);
      return false;
    });
    if (kept.length === 0) this.edges.delete(mesh);
    else this.edges.set(mesh, kept);
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
    this.edges.clear();
    this.pinned.clear();
    this.total = 0;
  }
}
