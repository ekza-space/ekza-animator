# TODO — next iterations

Ordered queue of what to do next. The plans behind it: [ROADMAP](docs/ROADMAP.md#recommended-order) and
[MODELING-PLAN](docs/MODELING-PLAN.md) (v0.2, revised after its design review, §12) and, for the agent bridge,
[MCP-SPEC](docs/MCP-SPEC.md); owner decisions with defaults:
[DECISIONS-OPEN](docs/DECISIONS-OPEN.md). Sizes are agent-days; "day N" counts working days from the start of B0a.
Updated 2026-10-22 (Auto-Rig integrated; M6b MVP released as `v0.4.0`; M6a released as `v0.3.0`, basic shading as `v0.3.1`).

## Now — M6b MVP: Rig & Skin owner flow (integrated 2026-10-22; owner run and tag open)

Binding scope: [M6B-SPEC §0](docs/M6B-SPEC.md#0-mvp-cut-owner-flow-2026-10-22) v1.2, [ADR 0020](docs/adr/0020-m6b-mvp-cut.md).
Model → Quick Rig markers (front/side) → live VRM skeleton → Create Skeleton → fit joints → Bind Skin (one click) →
paint fixes → test pose → CC0 clip library preview → Use Clip → Graph Editor → shade → Export VRM 1.0 that OMOBA's
runtime admits. Integration branch `m6b/mvp` (from `dev`); ≈ 48.5 agent-days + a fix round, critical path ≈ 22 days.

- [x] MVP cut written: M6B-SPEC v1.2 §0 and §9.0, ADR 0020 (2026-10-22).
- [x] C0 contracts, schema v4 (swatches table stays 2), stubs, lazy chunks incl. `clip-library`, Cube Lad and Polybot fixtures (4.5).
- [x] After C0, in parallel: C1 character runtime (5), C2 templates + Quick Rig v2 kernel + joint edits (5), C4 auto-skin (4.5), C7 rig shell (5.5), C12 clip library — CC0 UAL starter pack as VRMA, preview, Use Clip (5).
- [x] Then: C10 VRM 1.0 writer with the OMOBA runtime lints (5, after C1); C3 Quick Rig UI + joint UI (5, after C2 + C7); C6 weights kernel + skin UI (6, after C1 + C4 + C7).
- [x] INT (3 + fix round): every package merged on `m6b/integration`, every READY/`test.fixme` gate a failure, AS-MVP-1 "Cube Lad comes alive" scripted (E2E-MVP-01) green and OMOBA's `validate-runtime-vrm` admits its export, E2E-RIG-10, budgets ([ROADMAP](docs/ROADMAP.md#m6b-mvp-budgets)), docs, the integration fixes ([wp-notes](docs/wp-notes/m6b-integration.md)).
- [ ] Owner: AS-MVP-1 by hand in Chrome ([M6B-SPEC §0.7](docs/M6B-SPEC.md#07-acceptance-as-mvp-1-and-the-mvp-e2e-scenarios), times recorded), step 12 with `node tooling/omoba-validate.mjs <file.vrm>`; review [DECISIONS-OPEN §L](docs/DECISIONS-OPEN.md#l-m6b-mvp-deviations-2026-10-22) (AS-MVP-1's elbow drag 0.02 m, `skel.tpose` hinge depth, info rows never gate).
- [x] `m6b/mvp` → `dev` (2026-10-22, `daec252`; the merged tree is the one the full gate passed on, `m6b/integration`).
- [x] Package review findings closed on `dev` (M6B-INT-19…25, [wp-notes](docs/wp-notes/m6b-integration.md#package-review-findings-closed-on-dev-m6b-int-1925)): C7's out-of-Dirs edits approved, P-S7 at exact ≥ 70 % (spec §0.11 I-6, owner review item), static character meshes kept in character space under a moved root (fix + test), merged `m6b-*` worktrees removed (branches kept).
- [ ] Owner reviews the MVP decisions Q-MVP-1…15 ([M6B-SPEC §0.8](docs/M6B-SPEC.md#08-owner-decisions-taken-for-the-mvp-defaults-the-owner-may-override-any)); release tag is the owner's call (proposed `v0.4.0`).

## Parked — specs ready, build later (owner decision, 2026-10-20)

Focus is the modeling base (M6a) first. These tracks are fully specified and parked; their code branches are kept.

- [ ] **M6b after the MVP** (deferred by the MVP cut, [M6B-SPEC §0.3](docs/M6B-SPEC.md#03-scope-in-and-deferred); spec
      text kept): C8a/C8b constraints (parent/point/orient/aim, Attach Prop, sockets, bake), C9 control-shape editing,
      C11 imports recovery (Make Character Editable, skin surgeon edits on imported avatars, fill missing weights by
      inpainting), the Joint tool / Insert / Split / Remove / Delete / Duplicate / Add Chain (the A-pose path — T-Stance,
      Apply Pose as Rest — was built by AUTORIG A0), Auto Weights for Selected Joints, the Component Editor (if not built in C6), numbers overlay,
      Lock-Relative, Copy/Move/Hammer weights, the ROM clip, Rig Outliner variant and marking menus (CR-3, CR-5),
      CR-1/CR-6/CR-8/CR-9/CR-10, §1.2 stretch items, AS-LP-T "Lowpoly Lad and his sword"; from the MVP integration:
      joint/constraint selection undo (`SelectionSnapshot` contract change, M6B-INT-22), auto-skin occluders from the
      character's other meshes and holds on full binds (M6B-INT-23), V/J snaps on joint moves, CR-AR-2 (library
      preview from in-memory clips, fallback owner D5).
- [ ] **M-AI — Agent bridge (MCP)**, MVP (owner request 2026-10-23: AI control of the editor through MCP, then
      release): [MCP-SPEC §0.4](docs/MCP-SPEC.md#04-mvp-cut-2026-10-23) v0.3, [ADR 0022](docs/adr/0022-m-ai-mvp-cut.md),
      [ADR 0018](docs/adr/0018-agent-bridge-mcp.md), research 20–22. D0, P1, P2 ported onto `dev` on `mai/port`
      (2026-10-23; needs the bundle decision M-AI-MVP-2 before it merges). Phase B: B1 server + headless, B2 bridge,
      B3 agent UI + live capture, B4 rig tools (rig a model, add a library walk, export VRM), optional B5 eager diet;
      INT with MVP-AC-1…5 (one recorded Claude Code session). ≈ 17.5 agent-days. Then P3–P5, full P9 (phase C).
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
becomes **Ekza Hub**: create in Studio, publish in Hub. Record: [DECISIONS-OPEN §N](docs/DECISIONS-OPEN.md#h-naming-ekza-studio-and-ekza-hub-2026-10-19).

- [x] GitHub repository renamed `ekza-space/ekza-animator` → `ekza-space/ekza-studio` (the old URL redirects).
- [x] Code rename (branch `chore/rename-studio`, 2026-10-22): package scope `@ekza-studio/*` → `@ekza-studio/*`,
      root package `ekza-studio`, app title, About/welcome dialogs, console prefixes, glTF `asset.generator` and the
      `.ekzanim` manifest `app.name` (Ekza Studio), e2e hook `window.__EKZA_STUDIO_TEST__`, `STUDIO_STATIC_EXPORT` /
      `STUDIO_SOURCE_MAPS` (the `ANIMATOR_*` names still work), README/ARCHITECTURE/specs/ADRs (registry site → Ekza
      Hub). Persisted identifiers keep the old name so existing data loads: `ekza-animator-doc`/`-project` formats,
      `ekza_animator_bake_v*` extras, provenance `tool: 'ekza-animator'`, the `ekza-animator:` localStorage keys and
      the autosave IndexedDB database ([GLOSSARY](docs/GLOSSARY.md)). Research notes, wp-notes and DECISIONS-OPEN keep
      the old names as history. Full local gate green.
- [x] Local folder `ekza-animator` → `ekza-studio` with `git worktree repair` (2026-10-22; `ekza/ekza-animator` stays as a symlink for old paths).
- [x] MCP server name (`ekza-animator-mcp` bin, server info, MCP-SPEC/ADR 0018 snippets) → `ekza-studio-mcp`,
      `ekza-studio` / `Ekza Studio`, with the scope rename, done by the M-AI port (`mai/port`, 2026-10-23).
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

## Then — M6b remainder (after the MVP; [M6B-SPEC §9.0b](docs/M6B-SPEC.md#90b-full-m6b-work-packages-reference-post-mvp))

10. [x] Write `docs/M6B-SPEC.md` from [MODELING-PLAN §5](docs/MODELING-PLAN.md#5-m6b--rig--skin-workspace-turnkey), expanded on the owner's request into the full Rig & Skin workspace (joint tools, Orient/Mirror Joint, Quick Rig, Bind Skin, Paint Skin Weights, Component Editor, weight utilities, constraints and control-shape editing from M2c, test poses, Validation, VRM 1.0/GLB writer) from research [17](docs/research/17-maya-rigging-basics.md), [18](docs/research/18-constraints-control-shapes.md), [19](docs/research/19-rig-workspace-ui.md). **Done 2026-10-19: [M6B-SPEC](docs/M6B-SPEC.md) v1.1** after its design review; **v1.2 (2026-10-22) adds the MVP cut (§0)**.
11. [ ] Owner reviews the remaining M6b owner questions ([M6B-SPEC §12.4](docs/M6B-SPEC.md#124-owner-questions-defaults-chosen-the-build-starts-on-them); Q-M6B-1 is superseded by Q-MVP-1) and calibrates the rig marking menus together with Q-MOD-UI-1 before they are built.
12. [ ] After the MVP: the deferred packages C8a, C8b, C9, C11 and the deferred parts of C2/C3/C5/C6/C7 (Parked list above), then AS-LP-T and the turnkey feel check.

## Now — Auto-Rig mode (integrated 2026-10-22; owner run and tag open)

A Mixamo-style simple mode next to the full Studio, chosen on opening: upload a model → markers → auto-rig → try
animations → export an OMOBA/Space VRM, built only from Studio's and M6b's operators (a second shell over the same app
and document). Spec: [AUTORIG-SPEC](docs/AUTORIG-SPEC.md) v0.3, [ADR 0021](docs/adr/0021-autorig-mode.md) (Proposed
until the owner accepts the spec). Integration branch `autorig/mvp` (from `dev`), merged into `dev` (`--no-ff`, with
fix round 1); the full gate is green on `dev` (`pnpm run ci`: 16/16 unit tasks, `/editor` 896,741 B, `/autorig`
658,181 B, e2e 343 passed / 24 skipped / 0 failed); the `ar-*` worktrees are removed, the branches kept.

- [x] D0 contracts, route-group-proof size tooling, AR-B1 re-baseline, the layout spike (shared layout kept).
- [x] A0 the A-pose path in Studio (T-Stance, Apply Pose as Rest, *Straighten to T-Pose*), D1 the studio host and
      route group (same-page handoff with undo, new-tab handoff records), D2 the chooser and the switches, D3 the wizard
      frame + ① Model, D4 ② Markers + ③ Rig, D5 ④ Animations, D6 ⑤ Export (each with its fix round).
- [x] D7 integration: every package merged on `autorig/integration`; AS-AR-1…12 scripted in full through the UI
      (`apps/web/e2e/ar-as-*.spec.ts`, E2E-AR-08…11, E2E-AR-13); OMOBA's validator admits the AS-AR-1 and AS-AR-2
      exports; `/autorig` 658,122 B under its enforced 660,000 B gate, `/editor` +1,055 B of AR-B1's +2,048 B; the
      bench ([ROADMAP](docs/ROADMAP.md#auto-rig-budgets)); docs; fix round 1 (AR-D7-1…19,
      [wp-notes](docs/wp-notes/ar-integration.md)): every §11 check green, none held as `test.fail` — the hands follow
      their forearms on *Adjust joints*' Done (AR-D4-T1 closed), the VRM keeps an imported model's image texture,
      *Center and Ground* centres z (AR-D3-15 closed).
- [ ] Owner: AS-AR-1 and AS-AR-2 by hand in Chrome (timed), the demo in the [D7 notes](docs/wp-notes/ar-integration.md#owner-demo--10-minutes);
      review [DECISIONS-OPEN §M](docs/DECISIONS-OPEN.md#m-auto-rig-2026-10-22) and §13 (Q-AR-1…20; defaults stand).
- [ ] For its owners: the shared placement helper (AR-D3-23); optionally a `vrm.*` lint on hips far from the origin
      (C11, AR-D7-14).
- [ ] Release tag: the owner's call (after `v0.4.0`).

## After the turnkey release

16. [ ] "Publish avatar to Ekza" — the T3 slice of M4a (≈ 2 here + the `studio-upload` scope in the registry repository) ([ROADMAP M4a](docs/ROADMAP.md#m4a--ekza-t1t3--1520-agent-days-in-this-repo--ecosystem-work)).
17. [ ] M7 G1 AI generation (≈ 22): intake ops, gateway (default deny, auth, server-side caps, the app's first CSP), Tripo + Meshy adapters with a mock server, Generate panel with paid-tier attestation ([§7](docs/MODELING-PLAN.md#7-m7--ai-3d-generation)); re-verify provider prices and models first; written provider confirmations (Q-GEN-4) before BYO on a hosted gateway.
18. [ ] M7 G2 (≈ 14): self-hosted GPU worker, fal/Hunyuan adapters, OBJ import, voxel binding; M6c UV editor + texturing (≈ 18) in parallel if wanted ([§6](docs/MODELING-PLAN.md#6-m6c--uv-editor-and-texturing-basics-optional)).
19. [ ] M2b adoption (FBX/BVH/Mixamo) and the rest of M2c → **V1** release ([ROADMAP](docs/ROADMAP.md#m2c--breadth-and-polish--v1-release--3040-agent-days)).
20. [ ] M4a T1 typed animation assets, then M3 collaboration (incl. mesh-chunk transport, mesh claims and the conflicted-copy flow on `data.base`), M4b, M5, M8 splines ([ROADMAP §Recommended order](docs/ROADMAP.md#recommended-order)).
