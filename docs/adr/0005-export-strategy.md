# ADR 0005 — Export strategy: surgeon bake, LINEAR resampling, VRMA and animation-only GLB writers

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [02](../research/02-formats-gltf-vrm.md) D3–D9, §5–§8, §10; [03](../research/03-ekza-reuse-audit.md)
  §5.1, §6; [07](../research/07-rig-controls-math.md) §13, §15; [05](../research/05-landscape.md) §3.6;
  [04](../research/04-web-stack.md) §7.

## Context

Three exports are required: (1) bake clips into the original GLB/VRM, (2) animation-only GLB, (3) VRMA, one clip
per file. glTF Transform 4.5.1 drops unregistered VRM extensions on read/write (verified in research 03); three's
`GLTFExporter` loses MToon, VRM metadata, compression and indices. Research disagrees on reduction in the MVP
(02: yes; 01: V1), constant-track length (02: 1 key; 07: 2 keys) and threading (04: IO worker with a document
replica in the MVP). The design review found undefined container rules (padding, external buffers, `matrix`
nodes), a rollback that could leave dangling accessor indices, ambiguous STEP and in-place rules, and gates that
demanded impossible byte identity of re-serialized JSON.

## Decision

1. **Exports are derived artifacts.** The `.ekzanim` project is the only lossless source (ADR 0011).
2. **Sampling**: evaluate the rig at **integer clip frames** over the clip range (inclusive), convert to unit
   quaternions with **hemisphere continuity**, write **`LINEAR`** samplers. A track is **`STEP`** only if every
   curve influencing it (its driving control and that control's ancestors, plus the parent bone's driving control
   and its ancestors) is stepped throughout the range; its times are `{start} ∪ influencing key times (after
   infinity mapping, inside the range) ∪ {end}`, keyed by output track. Mixed stepped/smooth tracks are LINEAR,
   with a documented 1-frame blend at steps. Never `CUBICSPLINE` in the MVP. Times: float64 `i·den/num` stored as
   float32, strictly increasing after `Math.fround`, `min/max` from the float32 values, last sample exactly at the
   clip end. A warning lint fires when two consecutive samples differ by more than 90° (slerp would take the other
   way); per-track sub-frame refinement (07 §15.3) is V1.
3. **Self-contained clips**: every `(node, path)` animated by **any clip in the output file** — including the
   pre-existing animations a surgeon bake keeps — gets a track in every clip we write; constant tracks collapse to
   **2 keys**. Pre-existing clips are never edited; when they lack a track our clips add, a warning lint names
   them.
4. **Loop closure**: for clips with `loop: true` the exporter writes the first pose at the last sample when
   `closeLoop` is set (default on), and makes that pair hemisphere-consistent.
5. **Root motion** per clip: `hips` (default; root folded into hips) or `in-place`: X/Z of the hips (humanoid) or
   of the topmost driven joint with translation keys (generic; otherwise the option is disabled) locked to rest
   **in canonical character space** before conversion to raw locals. Translation is never written to the scene or
   armature root.
6. **(1) Bake into original = append-only "surgeon"** (02 §5.2), with these container rules (normative list in
   MVP-SPEC §4.11.11):
   - `baseBinLength` = original `buffers[0].byteLength`; appended data starts at `align4(baseBinLength)`; the
     original BIN bytes up to there are kept verbatim; appended bufferViews are 4-aligned, without `byteStride` or
     `target`; BIN padded with `0x00`, JSON with `0x20`.
   - `buffers[0]` with a `uri` is refused; `buffers[0]` is created only when `buffers` is absent or empty.
   - Driven nodes that use `matrix` are refused (`surgeon.matrix-node`); decomposition into TRS is V1.
   - Same-named clips (trimmed, case-insensitive) are replaced **in place** (stable index).
   - The marker `asset.extras.ekza_animator_bake_v1` records baseline counts, `baseBinLength`,
     **`baseBinSha256`** (sha256 of the original BIN prefix — the rollback check), `baseSha256` (pre-bake file;
     provenance only) and **`replaced`**: the original JSON of every pre-baseline animation replaced in place,
     written once.
   - Rollback before a re-bake requires a matching `baseBinSha256`, arrays at least as long as the baseline and no
     later foreign marker; it restores `replaced` entries first, then truncates animations, accessors,
     bufferViews and BIN. Otherwise the bake appends and warns.
   - Never rename nodes, never touch `extensionsUsed/Required`, never prune, never re-serialize the original BIN.
     Output is a concatenation (no copy of large originals).
   - **Preservation is defined as JSON-value equality** (deep-equal after parse, key order kept) for every original
     JSON value except the appended tails, replaced animations and `asset.extras` markers, and **byte identity of
     the BIN prefix**. Re-baking identical input is byte-identical (the writer is deterministic).
   - Channels: rotation for every bone the rig drives (raw local), translation on hips (and on generic bones with
     animated translation), scale only where animated and never on humanoid bones. Spring-bone joints,
     `VRMC_node_constraint` destinations and morph weights: none (MVP).
7. **(2) Animation-only GLB**: a fresh glTF Transform `Document` with one node per skeleton node that is animated
   or an ancestor of an animated node (same names, rest TRS, hierarchy), no meshes/skins, raw channels, all
   selected clips.
8. **(3) VRMA**: a fresh glTF Transform `Document` with an Ekza-owned `VRMCVrmAnimation` extension class: one node
   per humanoid bone present in the source (never eyes), parented by the humanoid parent map over present bones,
   **no rest rotation or scale**, `node.translation = W⁰_b.t − W⁰_parent(b).t` (canonical, parent = nearest
   present humanoid ancestor; hips at its canonical rest world position under an identity root); tracks are `N_b`
   and the absolute hips position; `extensionsUsed: ["VRMC_vrm_animation"]`, `specVersion "1.0"`, exactly one
   animation, clip fps (30 default), LINEAR/STEP only. A test recomposes rest world positions from the file
   (≤ 1e-5 m). Expressions and lookAt are V1; a Blender VRM add-on import smoke test is V1.
9. **Validation**: fresh writers (2) and (3) produce **0 validator errors**; surgeon outputs must add **no
   error-severity issue whose `(code, pointer)` is absent from the source file's report** (sources may carry their
   own errors, which the surgeon must preserve). In the app, export validates by **read-back** (re-parse, compare
   channel counts and sampled poses); the in-app validator worker is M1-stretch. Ekza and VRMA lints run in the
   export dialog per export profile (ADR 0010).
10. **Threading (MVP)**: export runs on the main thread as an async pipeline that yields between clips. The
    research-04 IO worker with an op-stream document replica is **deferred to M2**. All IO functions are pure and
    worker-safe now.
11. **Key reduction of sampled export tracks** (02 §6.4) is **V1**; the MVP writes dense LINEAR (≈ 250 KB for
    52 bones × 10 s at 30 fps). Curve-level reduction for import and Graph Editor *Simplify* is in M1 (ADR 0003).

## Alternatives

| Alternative | Why not |
|---|---|
| Round-trip through glTF Transform with VRM extension classes | Needs full index-aware classes for 7+ VRM extensions; images referenced only from extensions are at risk (02 §3). |
| three `GLTFExporter` re-export | Loses MToon, VRM, compression, indices (02 §2.2). |
| CUBICSPLINE export | Breaks VRMA loaders; exact only for non-weighted, non-rotation channels. Opt-in "compact" mode post-MVP. |
| 1-key constant samplers | Valid but gives tracks no duration; 2 keys cost 32 bytes. |
| Byte identity of the original JSON chunk (v0.1 wording) | Impossible after re-serialization (`1.0`→`1`, escapes, whitespace); JSON-value equality is the meaningful invariant. |
| Roll back only by truncation (v0.1) | Leaves replaced pre-baseline animations pointing at removed accessors; the `replaced` map fixes it. |
| Decompose animated `matrix` nodes in the surgeon | An edit outside the preservation invariant; deferred to V1 with an explicit allowed-diff entry. |

## Consequences

- Exports are deterministic: stable JSON key order, no timestamps; identical input gives identical bytes and
  SHA-256 (needed for registry content addressing).
- Interop warnings shown in the export dialog: VRMA drops non-humanoid bones; embedding clips in a VRM makes the
  current Ekza Space renderer skip its shared idle/walk library (02 §5.5); plain/animation-only GLB consumers do
  not evaluate `VRMC_node_constraint`.
- Re-importing our own GLB yields dense keys (reduced on import by default) until the V1
  `extras.ekza_animator_curves_v1` option exists.
