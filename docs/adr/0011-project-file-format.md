# ADR 0011 — Project file format `.ekzanim`

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [02](../research/02-formats-gltf-vrm.md) §11, [06](../research/06-collaboration.md) R11, §10.5–10.6,
  [08](../research/08-extensibility-modeling.md) §3.1, §3.7, [05](../research/05-landscape.md) §5(c) (`.eza` is taken).

## Context

The project file is the only lossless source of truth (curves, tangents, rotate orders, rig, IDs, provenance). It
must be self-contained offline, deterministic, migratable, tolerant of data written by newer apps or missing
extensions, and later mergeable into a CRDT store.

## Decision

1. **`.ekzanim` is a ZIP container** (written with `fflate` 0.8.3, store-only for already-compressed blobs, deflate
   for JSON):

   ```
   manifest.json          { "format": "ekza-animator-project", "schemaVersion": 1, "minWriterVersion": 1,
                            "app": { "name": "Ekza Studio", "version": "0.1.0" },
                            "assets": [{ "sha256": "...", "size": 123, "mime": "model/gltf-binary", "ext": "vrm", "path": "assets/<sha256>.vrm" }] }
   project.json           the document snapshot (below)
   assets/<sha256>.<ext>  source models, byte-identical to what the user opened
   ```

2. **`project.json`** = `DocSnapshot`: `{ format, schemaVersion, minWriterVersion, tableVersions, tables: {
   <table>: { <id>: record } } }` with **sorted keys at every level**, no timestamps, numbers as shortest
   round-trip JSON. Records are exactly the `@ekza-studio/doc` record types. Session state (selection, time,
   view cameras, layout) is not included. Tables without a registered `TableDef` (missing extensions, newer apps)
   are preserved verbatim and written back unchanged; unknown fields of known records likewise.
3. **Plain JSON debug variant** `*.ekzanim.json`: the same `DocSnapshot` plus `"assets"` entries without bytes
   (`{sha256, size, mime, ext, name}`); opening it requires the referenced models to be supplied or already cached.
4. **Loading**: verify `format`; run pure, idempotent migrations `v(n) → v(n+1)` per table up to the registered
   table versions (new IDs derived as `hash(oldId + ':' + purpose)`, origin `migration`); verify each asset's
   SHA-256 and size (`AssetStore.get` throws `asset-missing` / `asset-corrupt`); then `store.load(snapshot)`
   (origin `load`, clears undo and history). The project opens **read-only** with an "update the app" banner when
   `minWriterVersion` exceeds the app's `SCHEMA_VERSION` or a known table's version is newer than supported.
5. **Content addressing**: asset IDs are lowercase SHA-256 hex of the exact bytes (WebCrypto). Two projects
   referencing the same avatar share one blob.
6. **Opening always replaces.** Schema-1 JSON snapshots omit soft-deleted records (determinism), so they carry no
   deletion history; merging two of them would resurrect deletions. A `.ekzanim` without CRDT updates therefore
   always opens as a new project and never merges.
7. **Future**: a `docs/<partition>.yupd` entry set (Yjs V2 updates) is added under a new `schemaVersion` when the
   Yjs store becomes the production adapter (M3); only files that contain `docs/*.yupd` merge on open (06 §10.5).
   Embedding an editable copy in exported GLBs (`extras.ekza_animator_curves_v1`) is V1 and optional.

## Alternatives

An "authoring GLB" carrying an `EKZA_animator` extension (08 Q2) opens in any glTF viewer but needs a registered
vendor prefix and mixes authoring data into runtime-like files; rejected for the MVP. `.eza` is used by
EZ-Animator and is avoided. Merging JSON snapshots on open was rejected (no deletion history).

## Consequences

- Saving is "download `.ekzanim`" in the MVP (File System Access API handle reuse where available, V1 autosave to
  IndexedDB).
- Golden tests: snapshot → zip → unzip → snapshot is deep-equal; zip bytes are deterministic for identical input
  (fixed entry order and zeroed timestamps); an unknown table and an unknown field survive a round trip.
