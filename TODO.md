# TODO — next iterations

Ordered queue of what to do next. The plans behind it: [ROADMAP](docs/ROADMAP.md#recommended-order) and
[MODELING-PLAN](docs/MODELING-PLAN.md) (v0.2, revised after its design review, §12); owner decisions with defaults:
[DECISIONS-OPEN](docs/DECISIONS-OPEN.md). Sizes are agent-days; "day N" counts working days from the start of B0a.
Updated 2026-10-19 (M6a build spec written).

## Now — release M2a

1. [ ] Owner reviews the M2a deviations and owner items ([DECISIONS-OPEN §F](docs/DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18)) and runs the demo script ([M2A-SPEC §10.3](docs/M2A-SPEC.md#103-owner-demo-script-10-minutes)).
2. [ ] Tag `v0.2.0` from `dev` → `main` (owner's call); `v0.1.0` if still pending.

## Next — modeling base (M6a, ≈ 108 + a fix round; critical path ≈ 31.5 days, ≈ 35.5 with the fix round — [M6A-SPEC §9](docs/M6A-SPEC.md#9-work-packages))

3. [ ] Owner reviews the modeling decisions ([DECISIONS-OPEN §G](docs/DECISIONS-OPEN.md#g-modeling-iteration-m6am7-defaults-chosen-2026-10-18)) and the design-review record ([MODELING-PLAN §12](docs/MODELING-PLAN.md#12-design-review-2026-10-19-decisions)); calibrates the RMB/Shift+RMB compass positions on a real Maya (Q-MOD-UI-1; the slots are provisional until then). Defaults stand until overridden.
4. [x] Write `docs/M6A-SPEC.md` from [MODELING-PLAN §3–§4](docs/MODELING-PLAN.md#4-m6a--modeling-base): TypeScript contracts (incl. `ParamDef` with `bound`, `MeshSetOp`, `EditorHistory` selection parts, `UndoManager.entries()`/`onEvict`), normative behaviours (extrude session §3.4, per-tool symmetry table §3.14, hard-flag rule §3.2, numeric capture window), the operator table (`repeatable`, `bound` per argument), E2E-MOD-01…32 with owners, the shared-file table (§4.3); ADRs 0014–0016 → Accepted; ARCHITECTURE decision 23 amended (selection undoable in Model, ADR 0016 D12); REQUIREMENTS FR-MOD rows rewritten. **Done 2026-10-19: [M6A-SPEC](docs/M6A-SPEC.md) v1.0** (refinements of the plan in its §12.2).
5. [ ] B0a contracts, schema v3, mesh-core interfaces + reference stub, undo eviction API (3.5) — [M6A-SPEC §9 B0a](docs/M6A-SPEC.md#b0a--contracts-schema-v3-mesh-core-interfaces--stub-undo-eviction-integration-agent-first).
6. [ ] Right after B0a, in parallel: B0b keymap rows + menus (2), **B1 mesh kernel (7)**, B6 mesh-view (6.5), B7 runtime + blobs + undo budget (7), B8 io + marker v2 (10), **B9 shell: workspaces, marking menus, command palette, Scale tool, shading modes (5.5)**. B6, B7 and B8 build on the B0a stub and switch to B1 through READY gates.
7. [ ] When B1 merges (day ≈ 10.5): B2 selection + symmetry maps + hide (4), B3 core ops + extrude (8), B4 shape ops + Multi-Cut + slide + average + MeshSetOps (10), B5 bevel + Mesh Check + UV projections (8.5). When B9/B6/B0b and B9/B7 merge: B10 modes + selection UI + selection undo + hide/isolate (6.5), B11 operators UI + Last-op + capture window (5.5). Then B12a transform tools (after B10, B11, B2) and B12b topology tools (after B10, B11, B2, B3, B4), 5 + 5; B13 Outliner, palette, templates, image planes (7.5; after B1, B7, B8, B9).
8. [ ] Owner feel check (30 min, Chrome) when B12a merges: component W/E/R, MMB-drag, snapping, pivot, soft select, symmetry.
9. [ ] M6a integration (6) + one fix round (≈ 4): E2E-MOD-01…32, AS-LP-A (from a cube, every base tool) and AS-LP-B by the owner, budgets ([M6A-SPEC §10–§11](docs/M6A-SPEC.md#10-acceptance-tests-e2e-scenarios-and-as-lp)); tag `v0.3.0`.

## Then — characters from own models (M6b, ≈ 43.5; starts when B1, B7, B8, B9 have merged, day ≈ 13.5)

10. [ ] Write `docs/M6B-SPEC.md` from [MODELING-PLAN §5](docs/MODELING-PLAN.md#5-m6b--characters-from-own-models-turnkey).
11. [ ] C0 contracts + minimal character writer + synthesized container (4.5) → C1 skeleton + Quick Rig, C2 auto-skin, C5 VRM/GLB writer, C6 Rig & Skin UI → C3 weights (also needs B6, B10, B12a/B12b) → C4 test loop → C7 imports + T0.
12. [ ] Turnkey acceptance: E2E-SKIN-01…08 and AS-LP "Lowpoly Lad and his sword" end to end ([§8](docs/MODELING-PLAN.md#8-end-to-end-acceptance-as-lp--lowpoly-lad-and-his-sword)); tag `v0.4.0` — estimated ≈ 40–45 working days after B0a starts.

## After the turnkey release

13. [ ] "Publish avatar to Ekza" — the T3 slice of M4a (≈ 2 here + the `studio-upload` scope in the registry repository) ([ROADMAP M4a](docs/ROADMAP.md#m4a--ekza-t1t3--1520-agent-days-in-this-repo--ecosystem-work)).
14. [ ] M7 G1 AI generation (≈ 22): intake ops, gateway (default deny, auth, server-side caps, the app's first CSP), Tripo + Meshy adapters with a mock server, Generate panel with paid-tier attestation ([§7](docs/MODELING-PLAN.md#7-m7--ai-3d-generation)); re-verify provider prices and models first; written provider confirmations (Q-GEN-4) before BYO on a hosted gateway.
15. [ ] M7 G2 (≈ 14): self-hosted GPU worker, fal/Hunyuan adapters, OBJ import, voxel binding; M6c UV editor + texturing (≈ 18) in parallel if wanted ([§6](docs/MODELING-PLAN.md#6-m6c--uv-editor-and-texturing-basics-optional)).
16. [ ] M2b adoption (FBX/BVH/Mixamo) and the rest of M2c → **V1** release ([ROADMAP](docs/ROADMAP.md#m2c--breadth-and-polish--v1-release--3040-agent-days)).
17. [ ] M4a T1 typed animation assets, then M3 collaboration (incl. mesh-chunk transport, mesh claims and the conflicted-copy flow on `data.base`), M4b, M5, M8 splines ([ROADMAP §Recommended order](docs/ROADMAP.md#recommended-order)).
