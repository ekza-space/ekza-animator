# ADR 0002 — Document store and collaboration readiness

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [06](../research/06-collaboration.md) (D1–D11, R1–R12, measured hazards H1–H8, §7.2 interfaces,
  §7.4 contract tests), [04](../research/04-web-stack.md) §6, [08](../research/08-extensibility-modeling.md) §3,
  §5, §10, [01](../research/01-maya-animation-features.md) §1.2 (D/U/P scopes), coordinator brief.

## Context

Collaboration (two people on two characters, "four hands" on one) is a stated goal but is not in the MVP.
Research disagrees on *when* the CRDT enters:

- **06 (D2)**: ship a Yjs-backed `DocumentStore` locally from day one (no network), so phase P1 "only adds a
  provider". Domain code never imports `yjs` (one package does). Own patch-based undo instead of
  `Y.UndoManager` (H4), flat ID-keyed maps (H1), soft deletes (H2), preview-then-commit drags (D5, H6).
- **04 / 08**: plain in-house store now, Yjs binding later through the same transaction API.
- Coordinator lean: plain store behind a `DocumentStore` interface plus a conformance suite that a future Yjs
  store must pass; decide on evidence.

### Evidence weighed

1. Every *data-loss* hazard 06 measured (H1, H2, H4, H6, H7) is fixed by **data shape and API rules**, not by
   the backing library: flat ID-keyed records, soft-deleted structural records, store-agnostic
   compare-before-restore undo, preview overlays committed once, blobs outside the document. These rules cost the
   same in a plain store.
2. 06's own interfaces (`transact`, `ChangeBatch{origin}`, `PreviewSession`, `UndoManager` with skip reports,
   `PresenceChannel`) are store-agnostic by design; 06 chose its own undo precisely so that the adapter is
   swappable.
3. The MVP has no network. The only day-one benefit of Yjs that 06 lists beyond "a smaller later change" is
   merge-on-open of `.ekzanim` files, which is not an MVP requirement.
4. **The real trade-off.** 06 already confines `yjs` to one package (D2) and keeps drags as local previews (D5),
   so a Yjs store from day one would *not* touch every package or put graph drags through CRDT transactions (the
   v0.1 text of this ADR said so; that was a misreading). What it does cost: an asynchronous `open()` per
   partition at every call site that loads data (import, clip switching, export, project save), snapshots that
   need a projection to be deterministic, Yjs-specific debugging in the one package that owns it, and the
   pending v14 migration (`yjs@13.6.33` is current; v14 is RC). What the plain store buys: a synchronous,
   deterministic, easily debugged MVP. The async-`open` ripple is avoided by putting the partition lifecycle
   into the interface **now** and awaiting it at call sites even though the memory store resolves at once.
5. The risk 06 raises — "swapping the store later is bigger than adding a provider" — is only bounded if a
   replicating store runs the same contract **during M1**, while the contracts can still change cheaply.
   v0.1 deferred that to a spike at the start of M3, after seven packages had been built against frozen
   contracts. That control is now part of M1.

## Decision

1. **The MVP production store is `MemoryDocumentStore`**, an in-house, synchronous, in-memory record store in
   `@ekza-studio/doc` behind the `DocumentStore` interface of
   [MVP-SPEC §4.2](../MVP-SPEC.md#42-doc--records-partitions-store-transactions-undo-replication). No app package
   imports `yjs`.
2. **The interface follows 06 §7.2**, adapted to typed tables:
   - `transact(meta, fn)` with `put/patch/remove/softDelete/restore/annotate`; synchronous; nested calls join the
     outer transaction; throws `preview-active` while a preview is open.
   - `ChangeBatch { txId, origin, label, user, version, changes }`, where each change carries `before/after` and,
     for updates of field-merge tables, the changed top-level `fields` (06 §9 `prop`).
   - **Merge units** (`MERGE_UNIT`, 06 R3): `keys` and `assets` merge and undo as whole records; every other table
     per top-level field, nested objects (`shape`, `keyable`, `range`, `placement`, …) as atomic values. `put`
     inserts; updates use `patch`; `put` over an existing record records the diffed fields and throws `use-patch`
     in strict mode.
   - **Partition lifecycle**: `open(partition): Promise<void>`, `close`, `isOpen`, `openPartitions`; reads of
     unopened partitions are absent; `query.missingPartitions()`.
   - `beginPreview()` overlays committed as one transaction (optionally `undoable: false`), with
     `PreviewSession.conflicts` (always empty in the MVP).
   - `applyChanges(changes, origin)` for external writes (import, remote, agents, cleanup).
   - **Store-agnostic `PatchUndoManager`**: local origin only, coalescing, compare-before-restore **per merge
     unit**, skip reasons `changed-by-other` and `missing-partition`.
   - Content-addressed assets live outside the document; `AssetStore.get/has` are **async** and verify SHA-256
     and size (editor-core service, 06 §7.2 `AssetStore`).
3. **Partitions** (06 D6, adjusted): `scene` (project, assets, characters, cameras), `char:<characterId>` (rigs,
   controls, constraints, solvers **and clip metadata**, so clip lists work without opening clip documents),
   `clip:<clipId>` (layers, curves, keys).
4. **CRDT rules R1–R12 of research 06 are mandatory now**: client-generated random IDs (deterministic only where
   06/07 require: auto-rig control IDs `<rigId>:<templateKey>`, imported nodes); flat tables, no nested child
   arrays; one key = one record; parent pointers + fractional `order`; soft delete for structural records, hard
   delete for keys; store intent, not derived data (the shape-preserving insert is the one documented exception,
   ADR 0003); no U state in the document; binary data by content hash only; `schemaVersion` **and
   `minWriterVersion`** on the project and in snapshots; migrations are pure, idempotent, use origin `migration`,
   and derive new IDs as `hash(oldId + ':' + purpose)` so concurrent migrations write identical records;
   per-table versions (`DocSnapshot.tableVersions`, `TableDef.version`).
5. **Conformance suite** in `@ekza-studio/doc/testing`:
   `runDocumentStoreConformance(label, factory, caps: { replicating: boolean; harness?: ReplicaHarness })`.
   The non-replicating part covers transactions, nested joins, batches, preview/commit/cancel, undo/redo/coalescing,
   per-field compare-before-restore with simulated external writes, partition lifecycle, snapshot/load round trip,
   migrations and unknown tables. The replicating part uses `createTestNetwork(n, factory)` (06 §7.4: in-memory
   bus with delay, drop, reorder and partitions) and fast-check fuzzing to assert convergence, projection
   invariants (unique key times per curve, no hierarchy cycles), per-user undo isolation ("undo never touches
   another user's write"), per-field undo (a concurrent edit to a different field does not block undo; to the same
   field it is skipped and reported), application of one batch partition by partition in random order, golden
   regressions for H1–H5, and a golden documenting the outcome of "fps change concurrent with a key edit".
6. **`packages/doc-yjs` exists in M1 as a private, test-only package** (dependency `yjs@13.6.33`, exact): a
   minimal `ReplicatingStore` over one `Y.Doc` per partition (record-merge tables as plain values in a `Y.Map`;
   field-merge tables as one nested `Y.Map` of fields per record, created by the record's single creator, 06 R2).
   CI runs the **full** suite against it from M1. `check-deps` forbids any dependency on it from app packages.
   Any contract change it forces lands before the operator freeze (MVP-SPEC §8.1 step 5).
7. **Undo is per user from day one**: only `origin: 'local'` batches with `undoable !== false` enter the stack;
   `remote`, `load`, `import`, `migration`, `cleanup` never do. Unkeyed session edits are undone by the editor
   history (ADR 0013) without changing the store contract.
8. **Structural clip operations** (fps change in either mode, rotate-order change) rewrite many key records. They
   are flagged `structural`; from M3 they require an exclusive claim on the clip (06 §8.2's exclusive `rig` scope
   pattern) and are refused while another peer holds one.
9. **Collaboration (M3)** turns `doc-yjs` into the production adapter (tuple key codec 06 §6.5, providers,
   persistence), adds awareness-backed presence and a Hocuspocus 4 service. The data-shape, interface and
   suite work is already done and exercised.

## Alternatives

| Alternative | Why not |
|---|---|
| Yjs-backed production store from day one (06 D2) | Async `open` everywhere, projection-only determinism and Yjs debugging for no MVP user value. The decisive evidence 06 wanted (does Yjs meet the contract?) is gathered in M1 by `doc-yjs`; revisit at M3 start with that data. |
| Defer the Yjs spike to M3 (v0.1 of this ADR) | Leaves the replicating half of the suite untested while contracts freeze; rejected in the design review. |
| immer/mutative patches, valtio, jotai | Path/index patches lose intent and do not merge; per-key atoms explode at 50k keys (04 §6.2). |
| Per-curve typed-array key blocks as the stored unit (04, 08) | Channel-level LWW loses concurrent edits on the same curve (06 R3). Typed arrays remain the **compiled cache** format (ADR 0003). |
| Whole-record undo for every table (v0.1) | Under per-field LWW a concurrent edit of a different field would block undo; `put` over existing records would clobber concurrent field writes. |
| `Y.UndoManager` | Measured to drop contested keys (06 H4); single-doc scope. |

## Consequences

- `transact` stays synchronous; `Y.Doc.transact` is synchronous too, so call sites do not change in M3.
- Every loader awaits `store.open(...)`; the memory store resolves immediately, so the MVP pays nothing at
  runtime and M3 changes no call pattern.
- Projection invariants (duplicate key times, duplicate curves for one channel) are resolved deterministically at
  read time in `doc` queries, so the adapter adds no reader semantics.
- WP-2 is about 6 agent-days (store, undo per merge unit, suite with network and fuzzing, `doc-yjs`).
- Schema-1 `.ekzanim` JSON snapshots carry no deletion history and therefore always open as a new project; merge
  on open applies only to files that contain CRDT updates (ADR 0011).
- Deterministic auto-rig control IDs mean that concurrent re-runs of auto-rig on **one** rig agree; two independent
  imports of the same avatar create different rigs and never merge.
- M3 estimate: 1–1.5 weeks for adapter hardening, server and presence, since the suite already passes.
