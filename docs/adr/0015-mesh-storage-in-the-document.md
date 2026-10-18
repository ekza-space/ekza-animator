# ADR 0015 — Mesh storage in the document: revision refs, content-addressed chunks, claims, undo

- Status: Proposed (2026-10-18, revised 2026-10-19 after the design review, MODELING-PLAN §12); becomes Accepted
  when the M6a spec freezes (package B0a)
- Inputs: research [13](../research/13-mesh-kernel.md) §9 (Yjs measurements §9.6), [06](../research/06-collaboration.md)
  D6–D8, R1–R12, §8.2, §10.1, P3, [14](../research/14-skinning-own-models.md) §3, [12](../research/12-lowpoly-workflow.md)
  §4.2, [15](../research/15-ai-3d-generation.md) §5.10, [16](../research/16-model-workspace-ui.md) §21, §24;
  [MODELING-PLAN](../MODELING-PLAN.md) §3.3; ADRs 0002, 0008, 0011, 0013, 0014.

## Context

ADR 0002 fixed the document rules: flat ID-keyed records, per-field merge units, partitions with a lifecycle, preview
then commit, per-user patch undo with compare-before-restore, binary data by content hash only, and a test-only Yjs
store that runs the full conformance suite. Meshes are the first large, structured, frequently edited data in the
document. Measured on a 50k-triangle mesh with Yjs 13.6.33 (13 §9.6): one `Y.Map` entry per vertex and face puts
1.83 MB into the CRDT document and takes 67 ms to load per mesh, and concurrent merges can produce invalid meshes (a
face pointing at a concurrently deleted vertex, two users splitting the same edge). A whole mesh as one CRDT binary is
0.7 MB per commit. A hash-ref record is 132 bytes after 21 revisions. Research 13 and 14 also disagree on where skin
weights live (mesh layers vs a separate skin blob), and research 13 proposes a new `mesh:<id>` partition.

## Decision

1. **Granularity: one record per mesh, one geometry field.** A `meshes` table (registered through `TableDef`, merge
   unit per field, soft delete) holds name, owner, parent and order, placement and pivot, source asset reference,
   primitive generator parameters, palette, material preset, colour output, skin binding, the `faceted` flag, budget
   target, and **`data: { manifest: sha256, rev, base: sha256 | null, joints: JointId[] } | null`** — the revision
   ref (`null` = asset-backed, not made editable yet), its parent revision and a copy of the revision's skin joint
   palette, all in **one field value, hence one merge unit**. Morph target names and order are **not** a record field:
   they live only in the manifest's layer order (one source of truth). No per-vertex, per-edge or per-face records;
   **no per-component CRDT**. Groups (`groups`), palettes (`palettes`), swatches (`swatches`, each with a never-reused
   `slot` that face layers store) and reference image planes (`imagePlanes`, an image asset by hash, per ortho
   camera) are ordinary flat records.
2. **Revisions are content-addressed.** A revision is a deterministic JSON manifest (`format: 'ekza-mesh'`, version,
   counts, bounds, per array and per layer: name, domain, type, components, rules, metadata, elements per chunk, chunk
   hashes) whose SHA-256 is the revision id. Each stored array and layer is cut into ~32 KiB chunks of raw
   little-endian bytes, identified by their SHA-256. Swap-remove and append keep edits local, so a commit rewrites
   the chunks its edited indices span. Hashing is synchronous (in-repo SHA-256), so `transact` stays synchronous.
   A layer's chunk list may end before its element count; the missing tail reads as the layer's default (zero), so
   appending points does not rewrite the tail chunk of every morph or weight layer that is zero there. Readers refuse
   unknown newer manifest versions (read-only, "update the app") and keep unknown layers.
3. **`BlobStore`** (editor-core service, beside `AssetStore`): `put(bytes) → sha256` (sync, dedupe, in memory first),
   `get(id)` (async, hash-verified, `blob-missing`/`blob-corrupt`), `peek`, `persist()`. Implementations: memory;
   IndexedDB for autosave (a DB version upgrade adds a `blobs` store; only changed chunks are written; each slot's
   roots are its manifests, chunks resolved through them inside the existing "still there" transaction); `.ekzanim`
   entries `blobs/<sha256>` for every chunk and manifest reachable from current records (ADR 0011 extended under the
   next `schemaVersion`); presigned HTTP in M3 (research 06 §10.1). Chunks are not `AssetRecord`s. **Garbage
   collection derives its roots instead of tracking pins**: mark-and-sweep from current records, every `meshes.data`
   value in the before/after patches of the doc undo and redo entries, the revisions held by open `MeshRuntime`s and
   the autosave slots. This needs two small additions to shipped code: `UndoManager.entries()` and an
   `onEvict(entries)` callback on `PatchUndoManager` (today it evicts with `splice` and exposes only `subscribe`,
   `peekUndo`, `peekRedo`), and a step-drop event on `EditorHistory`.
4. **Partition: the owner's.** Character meshes live in `char:<characterId>`, scene meshes (props) and groups in
   `scene`. **No new `Partition` kind.** A character's skeleton, joints, meshes and rig therefore share one document,
   so "delete a joint and move its weights to the parent" is one atomic transaction even under the CRDT.
5. **Commit.** A tool gesture mutates the in-memory `EditMesh` in place; no `PreviewSession` is opened and nothing is
   written to the document while dragging (06 D5). Commit = hash dirty chunks, `BlobStore.put`, then **one
   transaction** patching `data` with `selectionBefore/After`; one gesture = one undo step (ADR 0013). The commit is
   **two-phase**: if the op's `apply` throws or the transaction aborts, `MeshRuntime` applies the delta backward
   before rethrowing, so the runtime never diverges from the ref. `MeshSetOp`s create or delete records and patch N
   refs in the same single transaction.
6. **Undo and redo.** `PatchUndoManager` restores the `data` field as for any field (compare-before-restore, per user).
   `MeshRuntime` follows ref changes from batch listeners: through its journal (`applyDelta` backward/forward, ≤ 5 ms)
   when it holds the edge between the two revisions, otherwise by loading the chunks and rebuilding (≤ 40 ms at 50k
   triangles); while that asynchronous rebuild is pending the runtime is `loading` and every `mesh.*` poll fails
   with the reason. **Undo memory is bounded in bytes**: chunks and journals reachable only from history count
   against a budget (default 256 MB, preference; journals 64 MB); above it the oldest steps are dropped through
   `onEvict` with a toast, and a step whose journal was dropped undoes through the chunk rebuild. The 500-entry cap
   alone does not bound memory: whole-layer ops (Mirror, Freeze, Conform, Merge by Distance, Make editable) on a
   mesh with many morph layers rewrite megabytes per step. **Adjust Last Operation** is `edit.undo` followed by a
   re-run with amended arguments (a dispatcher operator, ADR 0008 §1); its poll requires the step to be on top of the
   history and no store write since, and it always takes the journal path (the journal edge to the last op is never
   evicted); dragging a value previews from the pre-op mesh without document writes. **No amend option is added to
   the store or to `PatchUndoManager`.**
7. **Selection** of components is per-user session state (bitsets per mesh per mode in the `ComponentSelection`
   service, plus hide bitsets); history steps carry run-length-encoded snapshots in `TxMeta.selectionBefore/After`.
   In the Model workspace selection changes are also undo steps of their own, through a session-only selection part
   of `EditorHistory` (ADR 0016 D12), never through the document. Component modes, hilite, hiding, soft-select
   settings and symmetry are U state; nothing of it enters the document.
8. **Attributes travel with the geometry.** UVs, colours, custom normals, **skin weights**, morph deltas, groups and
   the palette slot are layers inside the revision (ADR 0014 §4). The skin joint palette is layer metadata in the
   manifest (each entry with the joint's parent at commit time), so a revision is self-describing, and it is copied
   into `data.joints` in the same field value, so `referencesOf` and `dependantOf` see which joints a mesh needs and
   the copy can never drift from the ref. If a joint no longer exists (a peer's per-user undo of "add joint" after
   another peer painted on it), readers fold its weights onto the nearest existing ancestor from the manifest and
   raise `skin.dangling-joint`. The binding (skeleton, last bind arguments) is a field of the mesh record. There is
   **no separate skin record or skin blob**; research 14's `ekza.skin.v1` byte layout survives as the layer encoding
   and the export codec.
9. **Schema v3**, one atomic change in M6a's first package (as M2a's schema v2): tables `meshes`, `groups`, `palettes`,
   `swatches`, `skeletons`, `joints`, `imagePlanes`; `CharacterRecord.source = { kind: 'asset', asset } | { kind: 'model', skeleton }`
   (the migration rewrites every v2 character to `asset`); `AssetRecord.provenance` (null by default, ADR 0017).
   Projects that contain v3-only data carry `minWriterVersion` 3, so older apps open them read-only.
10. **Collaboration (M3).** Entering a component mode on a mesh takes an **exclusive mesh claim** on its record (the
    claim pattern of research 06 §8.2; claims are advisory presence state and never block offline peers); others see
    "Anna is modeling Hat" and can watch revisions. Object-level fields (name, placement) stay editable unless claimed.
    Skeleton and skin edits take the existing exclusive `rig` claim. Transport: upload dirty chunks first, then write
    the ref; peers fetch missing chunks by hash and verify them. Because claims never block offline peers, a plain
    last-writer-wins on `data` could silently discard hours of another user's revisions; `data.base` (the parent
    revision, in schema v3 from the start, so no later migration) lets a peer detect the fork: when it receives a
    remote ref whose `base` is not its last-synced ref while it holds unsynced local commits, it keeps its own head as
    a "conflicted copy" mesh record, keeps the losing chunks reachable and notifies; the remote ref wins the original
    record. Undo of a superseded step reports `changed-by-other`.
11. **Make-editable boundary.** Imported meshes stay asset-backed (`data: null`) until "Make editable"; the exporter
    re-encodes only meshes with `data` (ADR 0014 §16).

## Alternatives

| Alternative | Why not |
|---|---|
| Per-component records or `Y.Map` per vertex/face (Blockbench-like) | 1.83 MB and 67 ms per 50k-tri mesh in the CRDT on every peer; merges can create invalid topology; wire cost per commit is no better than chunks (13 §9.6) |
| Whole mesh as one CRDT binary | 0.7 MB per commit in the CRDT history |
| Whole-mesh blob per revision outside the CRDT (research 10 §8) | Workable at low poly, but autosave and M3 upload would rewrite the whole mesh each commit; chunking costs little and degrades to the same thing in the worst case |
| New `mesh:<id>` partition (research 13 K7, 06 P3 `model/<id>`) | Changes the closed `Partition` union through `doc` and `doc-yjs`; one CRDT document per prop (dozens per scene, all opened at load); joint deletion + weight move would span two documents and lose atomicity. Its benefit — per-document ACL that lets a modeler edit meshes but not the rig — is not needed now; moving meshes to their own partition later is a migration of one table |
| Separate `ekza.skin.v1` blob + topology hash (research 14 D8) | Two refs that can drift; topology edits become two undo steps or need a stale check; a paint stroke would rewrite the whole blob instead of the touched chunks |
| Amend-last option on `TxMeta` or `EditorHistory.amend` (research 13, 16) | A store contract change for what undo + re-run already gives; the history length is unchanged either way |
| Mesh edits through `PreviewSession` | Per-frame mesh writes into the store and, in M3, into collaboration traffic |
| Construction history records | ADR 0014 §8 |
| Undo steps pin their chunks (v0.1 of this ADR) | `PatchUndoManager` evicts silently and `EditorHistory` drops steps, so pins leak or are released early and the rebuild fallback fails with `blob-missing`; derived roots need no bookkeeping |
| Joint palette as a separate record field `skin.palette` | A separate field is a separate merge unit; per-field undo with compare-before-restore could restore one and skip the other, the drift the manifest copy avoids by living inside `data` |
| `MeshRecord.morphTargets` beside the manifest's layer order | Two sources of the same order; a remote edit to one lets undo revert only the other |
| Plain last-writer-wins on `data` with no parent link | A peer cannot even detect that an offline colleague's revision chain was discarded |

## Consequences

- ADR 0002 is extended, not superseded: new tables and the `BlobStore` service; partitions, merge units, undo and
  the conformance suite keep their rules. The suite gains mesh-ref undo, compare-before-restore on `data`, unknown
  layers, the schema v3 migration, the dangling-joint fold, morph names from one source and the `data.base` fork
  case, on the memory store and `doc-yjs`. `PatchUndoManager` gains `entries()` and `onEvict` (additive).
- ADR 0011 is extended: `.ekzanim` gains `blobs/<sha256>` entries under the next `schemaVersion`; the zip stays
  deterministic.
- M3 work grows by mesh-chunk transport in `HttpAssetStore`/`BlobStore` and the mesh claim UI; no CRDT schema work for
  meshes.
- Remote viewers see modeling at commit granularity (optionally a low-rate presence ghost later), not per drag frame.
- Undo memory is bounded by a byte budget over chunks and journals reachable only from history (with eviction and a
  toast), not by the 500-entry cap alone; giant operations fall back to snapshots (ADR 0014 §5).
