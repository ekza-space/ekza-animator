# TODO — next iterations

Ordered queue of what to do next. The plans behind it: [ROADMAP](docs/ROADMAP.md#recommended-order) and
[MODELING-PLAN](docs/MODELING-PLAN.md) (v0.2, revised after its design review, §12); owner decisions with defaults:
[DECISIONS-OPEN](docs/DECISIONS-OPEN.md). Sizes are agent-days; "day N" counts working days from the start of B0a.
Updated 2026-10-20 (M6a built, integrated and merged into `dev`).

## Parked — specs ready, build later (owner decision, 2026-10-20)

Focus is the modeling base (M6a) first. These tracks are fully specified and parked; their code branches are kept.

- [ ] **M6b — Rig & Skin workspace** (joint tool, orient/mirror joints, templates + Quick Rig, bind + auto weights,
      Paint Skin Weights, Component Editor, constraints, control-shape editing, VRM/GLB export of own models):
      [M6B-SPEC](docs/M6B-SPEC.md) v1.1, research 17–19. Spec branch `m6b/spec` (also carries plan updates to
      MODELING-PLAN §5, ROADMAP, REQUIREMENTS — merge them when M6b starts). ≈ 70 agent-days.
- [ ] **M-AI — Agent bridge (MCP)**: headless tool layer, `ekza-animator-mcp` server, live bridge with pairing,
      see-tools, analysis, evals: [MCP-SPEC](docs/MCP-SPEC.md) v0.2, [ADR 0018](docs/adr/0018-agent-bridge-mcp.md),
      research 20–22. Spec branch `mcp/spec`; started code branches `mcp/contracts-foundation` (D0),
      `mcp/operators-scope` (P1), `mcp/tools-core` (P2) — not verified, resume from them. ≈ 55 agent-days.
- [x] **Layout presets for focused work** (owner request, 2026-10-20; right after M6a, inside its workspace/layout
      system): Animate (default) Alt+1; Blocking — one big viewport + time slider only, Alt+2; Polish — viewport over a
      large Graph Editor + time slider, Alt+3; Review — viewport full window + playback only, Alt+4; Maya-style
      "hide UI" toggle Ctrl+Space (panels around the viewport); browser fullscreen button + Shift+F; user presets
      saved in prefs. ≈ 0.5 day. Done on `feat/focus-presets`: Windows › Tool Strip / Help Line / Time Slider
      check-box items per workspace, focus mode also on Alt+0 (macOS takes Ctrl+Space for the input source), Windows ›
      Presets with Save Current Layout as… / Rename or Delete; [docs/LAYOUT-PRESETS.md](docs/LAYOUT-PRESETS.md).
- [x] **Basic shading without UVs** (after M6a): Lambert and Blinn materials (Maya Hypershade-lite), assign to
      objects or selected faces, flat/smooth; export Lambert → roughness 1/metallic 0, Blinn → roughness from
      glossiness (+ `KHR_materials_specular`). ≈ 0.5 day. Done on `feat/shading`: every palette swatch is a shader
      (swatches table v2, core schema stays 3 for M6b — [ADR 0019](docs/adr/0019-swatch-shaders.md)); Palette panel
      Shader section and New Lambert/Blinn, Edit Mesh › Assign New Material (`palette.assignMaterial`, one undo step);
      Blinn highlight in Colours/Lit; export applies shaders on `lit` meshes (Assign New Material switches its targets
      to lit; unlit + Blinn warns `material.unlit-shader`); [docs/SHADING-SPEC.md](docs/SHADING-SPEC.md).

## Rename — Ekza Animator becomes Ekza Studio (owner decision, 2026-10-19)

The editor grew from an animator into a full 3D package (modeling, rigging, animation, AI agent), so it takes the
name **Ekza Studio**. The publishing site that is called "Ekza Studio" today (`studio.ekza.io`, in `ekza-registry`)
becomes **Ekza Hub**: create in Studio, publish in Hub. Record: [DECISIONS-OPEN §H](docs/DECISIONS-OPEN.md#h-naming-ekza-studio-and-ekza-hub-2026-10-19).

- [x] GitHub repository renamed `ekza-space/ekza-animator` → `ekza-space/ekza-studio` (the old URL redirects).
- [x] Code rename (branch `chore/rename-studio`, 2026-10-22): package scope `@ekza-animator/*` → `@ekza-studio/*`,
      root package `ekza-studio`, app title, About/welcome dialogs, console prefixes, glTF `asset.generator` and the
      `.ekzanim` manifest `app.name` (Ekza Studio), e2e hook `window.__EKZA_STUDIO_TEST__`, `STUDIO_STATIC_EXPORT` /
      `STUDIO_SOURCE_MAPS` (the `ANIMATOR_*` names still work), README/ARCHITECTURE/specs/ADRs (registry site → Ekza
      Hub). Persisted identifiers keep the old name so existing data loads: `ekza-animator-doc`/`-project` formats,
      `ekza_animator_bake_v*` extras, provenance `tool: 'ekza-animator'`, the `ekza-animator:` localStorage keys and
      the autosave IndexedDB database ([GLOSSARY](docs/GLOSSARY.md)). Research notes, wp-notes and DECISIONS-OPEN keep
      the old names as history. Full local gate green.
- [x] Local folder `ekza-animator` → `ekza-studio` with `git worktree repair` (2026-10-22; `ekza/ekza-animator` stays as a symlink for old paths).
- [ ] MCP server name (`ekza-animator-mcp` bin, server info, MCP-SPEC/ADR 0018 snippets) → Ekza Studio on the `mcp/*`
      branches when they land (not on `dev` yet); those branches also take the scope and e2e-hook rename.
- [ ] Ekza Hub (separate task, production — deploy only with the owner's OK): Hub branding in `ekza-registry/web`,
      `hub.ekza.io` with `studio.ekza.io` redirecting (keep old links working), public docs in `doc`, links from
      Space and OMOBA, typed-asset docs.

## Now — release M2a

1. [ ] Owner reviews the M2a deviations and owner items ([DECISIONS-OPEN §F](docs/DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18)) and runs the demo script ([M2A-SPEC §10.3](docs/M2A-SPEC.md#103-owner-demo-script-10-minutes)).
2. [ ] Tag `v0.2.0` from `dev` → `main` (owner's call); `v0.1.0` if still pending.

## Done — modeling base (M6a, merged into `dev` 2026-10-20 — [M6A-SPEC §9](docs/M6A-SPEC.md#9-work-packages), [ROADMAP status](docs/ROADMAP.md#m6a-work-package-status))

Built in sixteen packages and integrated on `m6a/integration`, merged into `dev` with the full local gate green. Owner
items (eager allowance, marquee budget miss, bevel limits, feel check, demo script): [DECISIONS-OPEN §I](docs/DECISIONS-OPEN.md#i-m6a-build-deviations-2026-10-20).

3. [ ] Owner reviews the modeling decisions ([DECISIONS-OPEN §G](docs/DECISIONS-OPEN.md#g-modeling-iteration-m6am7-defaults-chosen-2026-10-18)) and the design-review record ([MODELING-PLAN §12](docs/MODELING-PLAN.md#12-design-review-2026-10-19-decisions)); calibrates the RMB/Shift+RMB compass positions on a real Maya (Q-MOD-UI-1; the slots are provisional until then). Defaults stand until overridden.
4. [x] Write `docs/M6A-SPEC.md` from [MODELING-PLAN §3–§4](docs/MODELING-PLAN.md#4-m6a--modeling-base): TypeScript contracts (incl. `ParamDef` with `bound`, `MeshSetOp`, `EditorHistory` selection parts, `UndoManager.entries()`/`onEvict`), normative behaviours (extrude session §3.4, per-tool symmetry table §3.14, hard-flag rule §3.2, numeric capture window), the operator table (`repeatable`, `bound` per argument), E2E-MOD-01…32 with owners, the shared-file table (§4.3); ADRs 0014–0016 → Accepted; ARCHITECTURE decision 23 amended (selection undoable in Model, ADR 0016 D12); REQUIREMENTS FR-MOD rows rewritten. **Done 2026-10-19: [M6A-SPEC](docs/M6A-SPEC.md) v1.0** (refinements of the plan in its §12.2).
5. [x] B0a contracts, schema v3, mesh-core interfaces + reference stub, undo eviction API (3.5) — [M6A-SPEC §9 B0a](docs/M6A-SPEC.md#b0a--contracts-schema-v3-mesh-core-interfaces--stub-undo-eviction-integration-agent-first).
6. [x] Right after B0a, in parallel: B0b keymap rows + menus (2), **B1 mesh kernel (7)**, B6 mesh-view (6.5), B7 runtime + blobs + undo budget (7), B8 io + marker v2 (10), **B9 shell: workspaces, marking menus, command palette, Scale tool, shading modes (5.5)**. B6, B7 and B8 build on the B0a stub and switch to B1 through READY gates.
7. [x] When B1 merges (day ≈ 10.5): B2 selection + symmetry maps + hide (4), B3 core ops + extrude (8), B4 shape ops + Multi-Cut + slide + average + MeshSetOps (10), B5 bevel + Mesh Check + UV projections (8.5). When B9/B6/B0b and B9/B7 merge: B10 modes + selection UI + selection undo + hide/isolate (6.5), B11 operators UI + Last-op + capture window (5.5). Then B12a transform tools (after B10, B11, B2) and B12b topology tools (after B10, B11, B2, B3, B4), 5 + 5; B13 Outliner, palette, templates, image planes (7.5; after B1, B7, B8, B9).
8. [ ] Owner feel check (30 min, Chrome) when B12a merges: component W/E/R, MMB-drag, snapping, pivot, soft select, symmetry.
9. [x] M6a integration (6) + one fix round (≈ 4): E2E-MOD-01…32, AS-LP-S (parts A and B scripted), budgets ([M6A-SPEC §10–§11](docs/M6A-SPEC.md#10-acceptance-tests-e2e-scenarios-and-as-lp)). **Done 2026-10-20**, merged into `dev`.
9b. [x] M6a acceptance fix round 1 on `dev` (2026-10-20): display of moved meshes (blocker), Combine origin, W/E/R double-click loops, status-line Symmetry, one-sided Bridge under symmetry, Channel Box lead, Mesh Check dock, template symmetry after a load, Last-op card fields — [DECISIONS-OPEN §J](docs/DECISIONS-OPEN.md#j-m6a-acceptance-fix-round-1-on-dev-2026-10-20).
9c. [ ] M6a deferred UI items (§J M6A-INT-44…47): Offset Edge Loop as a drag tool; in-app glTF validator for static exports; `F` after Bevel; compact quad HUD.
9d. [ ] M6a owner decisions from fix round 2 (§K M6A-INT-55, 56): Shift+double-click adds the edge's loop (Maya) or keeps the §5.6 toggle; whole character display at bind pose in Model.
9a. [ ] Owner: AS-LP-A/B by hand, the demo script ([M6A-SPEC §11.3](docs/M6A-SPEC.md#113-owner-demo-script-10-minutes)), the §I review; then tag `v0.3.0` (owner's call).

## Then — Rig & Skin workspace (M6b, ≈ 70.5 + a fix round; C0 starts after M6a's B0a, on the staging branch `m6b/dev` — [M6B-SPEC §9](docs/M6B-SPEC.md#9-work-packages))

10. [x] Write `docs/M6B-SPEC.md` from [MODELING-PLAN §5](docs/MODELING-PLAN.md#5-m6b--rig--skin-workspace-turnkey), expanded on the owner's request into the full Rig & Skin workspace (joint tools, Orient/Mirror Joint, Quick Rig, Bind Skin, Paint Skin Weights, Component Editor, weight utilities, constraints and control-shape editing from M2c, test poses, Validation, VRM 1.0/GLB writer) from research [17](docs/research/17-maya-rigging-basics.md), [18](docs/research/18-constraints-control-shapes.md), [19](docs/research/19-rig-workspace-ui.md). **Done 2026-10-19: [M6B-SPEC](docs/M6B-SPEC.md) v1.1** after its design review (45 issues; the record is its §12.5: joint roles and sockets, rename-proof control keys, the A-pose Quick Rig, IK test poses, Auto Weights for Selected Joints, contract requests CR-1…CR-10 on `dev`; refinements in its §12.2; MODELING-PLAN §5, ROADMAP and REQUIREMENTS updated).
11. [ ] Owner reviews the M6b owner questions ([M6B-SPEC §12.4](docs/M6B-SPEC.md#124-owner-questions-defaults-chosen-the-build-starts-on-them): staging branch + schema v4, the grown scope, Attach Prop for the sword, rig regenerated inside skeleton edits, the eager allowance) and calibrates the rig marking menus together with Q-MOD-UI-1. Defaults stand until overridden.
12. [ ] C0 contracts, schema v4, stubs, lazy chunks, Polybot-unskinned fixtures (4.5) right after M6a's B0a; it creates `m6b/dev` and files the contract requests CR-1…CR-10 as M6A-SPEC contract PRs on `dev` ([M6B-SPEC §2.4](docs/M6B-SPEC.md#24-contract-requests-to-m6a-small-land-on-dev-through-m6a-spec-contract-prs)).
13. [ ] After C0: C8a constraint kernel (5); after M6a's B1: C2 skeleton kernel (5.5); after B1 + B7: C4 auto-skin (6); after B1, B7, B8, B9: C1 character runtime (6); after C4 + B2: C5 weights kernel (4.5); after B0b, B9, B10, B11: C7 rig shell (6.5); after C1: C10 character writer (5). Then C3 skeleton UI (5.5), C6 skin UI (6), C8b constraint UI (3), C9 control shapes (3.5), C11 imports and recovery (4.5) — M6b's work ends ≈ day 32.
14. [ ] Owner feel check (30 min, Chrome) when C3 and C6 merge: Joint tool, `D`-held moves, the `E` test pose, brush keys, the Component Editor.
15. [ ] M6b integration (5) + one fix round (≈ 4) after M6a's fix round and the `release/0.3.0` cut: `m6b/dev` → `dev`, E2E-SKIN-01…14, E2E-RIG-01…10, E2E-CNS-01…04, AS-LP-T "Lowpoly Lad and his sword" end to end by the owner ([M6B-SPEC §10.3](docs/M6B-SPEC.md#103-as-lp-t--lowpoly-lad-and-his-sword-turnkey-owner-run-replaces-modeling-plan-8-parts-ce)); tag `v0.4.0` — estimated ≈ 46–47 working days after B0a starts.

## After the turnkey release

16. [ ] "Publish avatar to Ekza" — the T3 slice of M4a (≈ 2 here + the `studio-upload` scope in the registry repository) ([ROADMAP M4a](docs/ROADMAP.md#m4a--ekza-t1t3--1520-agent-days-in-this-repo--ecosystem-work)).
17. [ ] M7 G1 AI generation (≈ 22): intake ops, gateway (default deny, auth, server-side caps, the app's first CSP), Tripo + Meshy adapters with a mock server, Generate panel with paid-tier attestation ([§7](docs/MODELING-PLAN.md#7-m7--ai-3d-generation)); re-verify provider prices and models first; written provider confirmations (Q-GEN-4) before BYO on a hosted gateway.
18. [ ] M7 G2 (≈ 14): self-hosted GPU worker, fal/Hunyuan adapters, OBJ import, voxel binding; M6c UV editor + texturing (≈ 18) in parallel if wanted ([§6](docs/MODELING-PLAN.md#6-m6c--uv-editor-and-texturing-basics-optional)).
19. [ ] M2b adoption (FBX/BVH/Mixamo) and the rest of M2c → **V1** release ([ROADMAP](docs/ROADMAP.md#m2c--breadth-and-polish--v1-release--3040-agent-days)).
20. [ ] M4a T1 typed animation assets, then M3 collaboration (incl. mesh-chunk transport, mesh claims and the conflicted-copy flow on `data.base`), M4b, M5, M8 splines ([ROADMAP §Recommended order](docs/ROADMAP.md#recommended-order)).
