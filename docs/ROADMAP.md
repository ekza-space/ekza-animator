# Ekza Studio — Roadmap

Status: v1.2 (2026-10-22: **M6b MVP integrated** — every §9.0 package merged, every gate a failure, AS-MVP-1 scripted
(E2E-MVP-01) green and admitted by OMOBA's `validate-runtime-vrm`, [MVP budgets](#m6b-mvp-budgets); the owner run of
AS-MVP-1 and the release tag are owner items, [DECISIONS-OPEN §L](DECISIONS-OPEN.md#l-m6b-mvp-deviations-2026-10-22));
v1.1 (2026-10-22: **M6b MVP in progress** — the owner flow cut, [M6B-SPEC §0](M6B-SPEC.md#0-mvp-cut-owner-flow-2026-10-22)
v1.2 and [ADR 0020](adr/0020-m6b-mvp-cut.md), [MVP packages](#m6b-mvp-work-package-status); M6a released as `v0.3.0`, basic shading
as `v0.3.1`); v1.0 (2026-10-19: **M6b expanded into the Rig & Skin workspace and its build spec written** —
[M6B-SPEC](M6B-SPEC.md) v1.1 (revised after its design review), [work-package status](#m6b-work-package-status); constraints and control-shape editing
moved from M2c to M6b; v0.9 2026-10-19: **the M6a build spec is written** — [M6A-SPEC](M6A-SPEC.md) v1.0, ADRs 0014–0016
accepted, [work-package status](#m6a-work-package-status) below; v0.8 2026-10-19, M1 released as `v0.1.0` on `main`; **M2a integrated and merged into `dev`** (M2A-SPEC v0.3)
with acceptance fix rounds 1–2 (M2A-INT-20…35), **released as `v0.2.0`**; **the modeling iteration
is planned**: the old M6 "splines first" is replaced by M6a/M6b/M6c/M7 in [MODELING-PLAN.md](MODELING-PLAN.md), splines
move to M8, and the [recommended order](#recommended-order) puts modeling before collaboration; v0.8 applies the plan's
design review, MODELING-PLAN v0.2). Keep the [status table](#status) current: every merged milestone task updates it. Requirement IDs refer to
[REQUIREMENTS.md](REQUIREMENTS.md); the MVP build plan is [MVP-SPEC.md](MVP-SPEC.md), the M2a build plan is
[M2A-SPEC.md](M2A-SPEC.md), the M6a build plan is [M6A-SPEC.md](M6A-SPEC.md), the M6b build plan is
[M6B-SPEC.md](M6B-SPEC.md). Sizes are rough
**agent-days** (one implementation agent working full time); calendar time depends on parallelism.

## Status

| Milestone | Scope | Status | Started | Done | Notes |
|---|---|---|---|---|---|
| D | Research + architecture + MVP spec + design review | **Done** | 2026-10-17 | 2026-10-17 | `docs/research`, `ARCHITECTURE.md`, ADRs 0001–0013, `MVP-SPEC.md` v0.2 |
| M0 | Scaffold, contracts, stubs, math, toolchain, test kit | **Done** (on `dev`) | 2026-10-17 | 2026-10-17 | WP-0a + WP-0b; local gates green, CI runs on the first push |
| M1 | MVP → public alpha `v0.1.0` | **Done**, released `v0.1.0` | 2026-10-17 | 2026-10-18 | WP-1…WP-10 done; E2E-00…E2E-27 green in Chrome and SwiftShader; owner demo script passes (acceptance round 3); [budgets](#m1-budgets-architecture-14) recorded, 3 misses with owners. The tag waits for the owner's review of [DECISIONS-OPEN](DECISIONS-OPEN.md) |
| M2a | Game-clip daily driver | **Done**, released `v0.2.0` | 2026-10-18 | 2026-10-18 | [M2A-SPEC](M2A-SPEC.md) v0.3: A0…A5 + integration with its fix round 1 ([status](#m2a-work-package-status)); E2E-00…27, E2E-M2A-01…25 and the owner demo script (scripted walkthrough) green in Chrome and SwiftShader on `dev`, the acceptance walk and attack authored without Plant Feet; the M2a-stretch items listed as `test.fixme`; M-1, M-2, M-3 [met on `dev`](#m2a-budgets-on-dev); one new report-only miss (M-4, Dope Sheet drag); FR-EXP-12 partial; acceptance fix round 1 on `dev` (2026-10-19): the 2 major and 12 minor defects of the acceptance round fixed with regression tests (M2A-INT-20…33: foot roll about the toes joint, "In place" removes only the travel, reduction never larger in bytes, …); owner items in [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18) |
| M2b | Adoption: FBX/BVH/Mixamo retarget | Planned | — | — | gated by provenance |
| M2c | Breadth and polish → V1 release | Planned | — | — | constraints (FR-RIG-10) and control-shape editing (FR-RIG-13) moved to M6b (2026-10-19) |
| M3 | Collaboration P1 | Planned | — | — | `doc-yjs` already passes the suite (M1) |
| M4a | Ekza T1/T3 (typed animation assets, publish, open from Ekza) | Planned | — | — | depends on M1 + other repos |
| M4b | Collaboration auth and permissions | Planned | — | — | after M3 |
| M5 | V2: layers, IK polish, power tools | Planned | — | — | |
| M6a | Modeling base: Model workspace, low-poly box modeling, palette colour, static GLB export | **Done**, merged into `dev` (2026-10-20); tag `v0.3.0` pending the owner review | 2026-10-19 | 2026-10-20 | [M6A-SPEC](M6A-SPEC.md) v1.1: B0a, B0b, B1…B13 (B12a/B12b) merged in the §11.1 order ([status](#m6a-work-package-status)); every READY/`test.fixme` gate is a failure; E2E-MOD-01…32, AS-LP-S (parts A and B) and the M1/M2a suites green in Chrome, full local gate green on `dev` after the merge; [budgets](#m6a-budgets) re-measured (one report-only miss: the marquee); the eager allowance, the owner feel check and the demo script are owner items in [DECISIONS-OPEN §I](DECISIONS-OPEN.md#i-m6a-build-deviations-2026-10-20); M6b, M6c and M7 stay planned |
| M6b | Rig & Skin workspace: **MVP** (owner flow: Quick Rig markers → VRM skeleton → Bind Skin → paint → CC0 clip library → VRM 1.0 for Space and OMOBA), then the full workspace (constraints, control shapes, joint tools, imports recovery) | **MVP integrated and merged into `dev`** (2026-10-22: every package merged through `m6b/integration`, full local gate green; owner run of AS-MVP-1 and the tag (proposed `v0.4.0`) open); full M6b after the MVP | 2026-10-22 | — | [M6B-SPEC §0](M6B-SPEC.md#0-mvp-cut-owner-flow-2026-10-22) (binding MVP cut, v1.2) → [§9.0](M6B-SPEC.md#90-mvp-work-packages-binding-for-the-mvp-0): C0, C1, C2, C3, C4, C6 (+ C5 subset), C7, C10, C12 (new: clip library), INT ([status](#m6b-mvp-work-package-status)); ≈ 48.5 agent-days + a fix round, critical path ≈ 22 working days; deferred: C8a, C8b, C9, C11 and parts of C2/C3/C5/C6/C7 (≈ 22 + AS-LP-T) |
| AR | **Auto-Rig mode**: a Mixamo-style five-step wizard (model → markers → auto-rig → animations → OMOBA/Space VRM) as a second shell over the same app, document and undo history, chosen on the landing page; the A-pose path (A0) in Studio | **Integrated** on `autorig/mvp` and **merged into `dev`** (2026-10-22: A0, D0…D7 merged, AS-AR-1…12 scripted green, OMOBA's validator admits the exports, full local gate green on `dev`); owner run of AS-AR-1/2 and the tag open | 2026-10-22 | — | [AUTORIG-SPEC](AUTORIG-SPEC.md) v0.3, [ADR 0021](adr/0021-autorig-mode.md) (Proposed); [status](#auto-rig-work-package-status), [budgets](#auto-rig-budgets); decisions [DECISIONS-OPEN §M](DECISIONS-OPEN.md#m-auto-rig-2026-10-22) |
| M6c | UV editor and texturing basics (optional) | Planned (plan v0.2) | — | — | [MODELING-PLAN §6](MODELING-PLAN.md#6-m6c--uv-editor-and-texturing-basics-optional); ≈ 18; by demand |
| M7 | AI 3D generation (server gateway, Tripo + Meshy, post chain, provenance) | Planned (plan v0.2) | — | — | [MODELING-PLAN §7](MODELING-PLAN.md#7-m7--ai-3d-generation); G1 ≈ 22, G2 ≈ 14, G3 with M4a/M4b; ADR 0017 proposed |
| M8 | Splines and generators (the old M6 "splines first") | Planned | — | — | after M7; output type is the M6 mesh kernel |

### M1 work-package status

| WP | Package(s) | Owner | Status | PR | Notes |
|---|---|---|---|---|---|
| WP-0a | scaffold, contracts, stubs, `anim-core/math`, toolchain, CI | Integration | Done (on `dev`) | — | build deviations: DECISIONS-OPEN §E |
| WP-0b | shared test kit | Integration | Done (on `dev`) | — | build deviations: DECISIONS-OPEN §E (B-14…) |
| WP-1 | `anim-core` curves, reduction, shapes, AnimX goldens | A1 | Done (on `dev`) | — | [notes](wp-notes/wp-1.md); deviations W1-* in DECISIONS-OPEN §E |
| WP-2 | `doc` + `doc-yjs` + conformance suite | A2 | Done (on `dev`) | — | [notes](wp-notes/wp-2.md); conformance suite green on memory and `doc-yjs` |
| WP-3 | `rig` | A3 | Done (on `dev`) | — | [notes](wp-notes/wp-3.md) |
| WP-4 | `io` | A4 | Done (on `dev`) | — | [notes](wp-notes/wp-4.md); meshopt fixture added |
| WP-5 | `viewport` + viewport panel | A5 | Done (on `dev`) | — | [notes](wp-notes/wp-5.md) |
| WP-6 | Graph Editor + graph panel | A6 | Done (on `dev`) | — | [notes](wp-notes/wp-6.md) |
| WP-6t | time slider + timeline panel | A2 | Done (on `dev`) | — | [notes](wp-notes/wp-6t.md) |
| WP-7a | `editor-core` kernel | A7 | Done (on `dev`) | — | [notes](wp-notes/wp-7a.md) |
| WP-7b | operator catalog + workflows | A7 | Done (on `dev`) | — | [notes](wp-notes/wp-7b.md); operator catalog frozen at the v0.3 integration |
| WP-8 | `editor` shell, `ui`, `apps/web` | Integration | Done (on `dev`) | — | [notes](wp-notes/wp-8.md) |
| WP-9 | data panels | A1 | Done (on `dev`) | — | [notes](wp-notes/wp-9.md) |
| WP-10 | integration + e2e | Integration | Done (on `dev`) | — | v0.3 integration (INT-1…INT-31), acceptance rounds 1–3 (INT-32…INT-52), E2E-02…E2E-27 in four groups and the §14 budget bench (INT-53…INT-58, [budgets](wp-notes/wp-10-budgets.md)) |

### M2a work-package status

Packages and ownership: [M2A-SPEC §8](M2A-SPEC.md#8-work-packages) (shared files in §8.1). A0 lands first; A1…A5
start together and build in parallel in their own worktrees (branches `m2a/<slug>`); cross-package tests are
`READY`/`test.fixme` gates that turn on when the package they need merges; preferred merge order in
[M2A-SPEC §10.1](M2A-SPEC.md#101-merge-order).

| WP | Slug | Scope | Owner | Size | Status | Notes |
|---|---|---|---|---|---|---|
| A0 | `contracts-foundation` | §4 contracts, stubs and working baselines, schema v2 (atomic), attribute channels in the compiler and kernel, frame scheduler, key gesture, cycle-aware loop clips, layout v2, keymap, menus, test API | Integration | 3.5 | Done (on `dev`, merged first) | [notes](wp-notes/m2a-contracts-foundation.md) |
| A1 | `rig-ik` | `ik2` op with foot roll in the foot frame, mesh-based foot pivots, limb IK records, hyperextension-safe matching, import to IK with fidelity fallback, Plant Feet on IK legs | A1 | 6.5 | Done (on `dev`; contract PR C-1…C-7 ratified) | FR-RIG-11; [notes](wp-notes/m2a-rig-ik.md) |
| A2 | `ik-editor` | IK operators and UI (Channel Box, Attributes with foot fields, viewport), visibility, pick-walk, virtual slider (rows and viewport MMB), body-part keying | A2 | 6 | Done (on `dev`; IK tests and E2E-M2A-01…07, 25 run ungated; the same-mode switch is refused, M2A-A2-23) | [notes](wp-notes/m2a-ik-editor.md) |
| A3 | `dopesheet-timing` | Dope Sheet, time-slider copy/ripple/MMB carry/nudge, insert/remove time, global-region ripple, breakdown retiming | A3 | 5.5 | Done (on `dev`; E2E-M2A-10b and -14 run ungated) | FR-DS-01..02, FR-TIME-10; [notes](wp-notes/m2a-dopesheet-timing.md) |
| A4 | `graph-posing` | Tween family (status line too), breakdown display, half-cycle mirror animation, buffer curves, normalized/stacked views, scale/region tool, M-1 (frame profile first) | A4 | 5.5 | Done (on `dev`; M-1 met, p95 3.2 ms on `dev`; E2E-M2A-15 ungated) | [notes](wp-notes/m2a-graph-posing.md); FR-KEY-08..09, FR-GE-18..20 |
| A5 | `platform-perf` | M-2 lazy loading + size gate, M-3 curve evaluation, autosave + recovery, export key reduction | A5 | 5 | Done (on `dev`; M-2 gate in CI, M-3 met) | FR-PROJ-05, FR-EXP-12; [notes](wp-notes/m2a-platform-perf.md) |
| INT | `integration` | Acceptance E2E-M2A-23/24 (walk and attack with leg IK), budgets, README/ROADMAP/REQUIREMENTS/DECISIONS, owner demo script | Integration | 3 | Done (on `dev`; branch `m2a/integration` with its fix round 1, merged last, M2A-INT-19; acceptance fix round 1 on `dev`, M2A-INT-20…33) | [notes](wp-notes/m2a-integration.md); gates turned into failures, M2A-INT-1…14; fix round 1 M2A-INT-15…18 (value scale, unit-aware Graph Editor fields, M2a-stretch fixmes and the mesh-pick hint, the demo walkthrough and the −0 handles it found); [acceptance fix round 1](wp-notes/m2a-integration.md#acceptance-fix-round-1-on-dev-m2a-int-2033) M2A-INT-20…33 |

### M6a work-package status

Packages, ownership and gates: [M6A-SPEC §9](M6A-SPEC.md#9-work-packages) (shared files in §9.1). B0a lands first;
then B0b, B1, B6, B7, B8 and B9 start together; B2…B5 when B1 merges; B10 after B9, B6, B0b; B11 after B9, B7; B12a
after B10, B11, B2; B12b after B10, B11, B2, B3, B4; B13 after B1, B7, B8, B9; INT after all. Branches `m6a/<slug>`;
cross-package tests are `READY`/`test.fixme` gates that turn on when the package they need merges; merge order in
[M6A-SPEC §11.1](M6A-SPEC.md#111-merge-order).

| WP | Slug | Scope | Size | Depends on | Status |
|---|---|---|---|---|---|
| B0a | `contracts-foundation` | §4 contracts and stubs, schema v3 (seven tables, `CharacterRecord.source`, `AssetRecord.provenance`), mesh-core interfaces + reference `editMeshFrom`, `UndoManager.entries()`/`onEvict`, history selection parts, `ParamDef`, memory `BlobStore`, operator stubs, test-API types, dependencies | 3.5 | — (M2a release) | **Done** (on `dev`) |
| B0b | `keymap-menus` | hierarchical key scopes, capture hook, every §7 keymap row, §8.3 menus, keymap conformance | 2 | B0a | **Done** (on `dev`) |
| B1 | `mesh-kernel` | SoA kernel, layers, write log, Euler operators, validation, revisions, triangulation, normals, hard-flag helpers, primitives, arbitraries, goldens | 7 | B0a | **Done** (on `dev`) |
| B2 | `mesh-select` | walkers and Maya's loop table, grow/shrink/convert, soft weights, symmetry partner maps, component transforms | 4 | B1 | **Done** (on `dev`) |
| B3 | `mesh-ops-core` | extrude, inset, insert/offset loop, connect, merge family, delete family, fill hole, bridge | 8 | B1 | **Done** (on `dev`) |
| B4 | `mesh-ops-shape` | mirror, symmetrize, normals ops, triangulate/quadrangulate, spin/flip, freeze, Multi-Cut, slide, average, MeshSetOps and remap helpers | 10 | B1 | **Done** (on `dev`) |
| B5 | `mesh-bevel-check-uv` | bevel (1–3 segments), Mesh Check diagnostics and fixes, UV projections | 8.5 | B1 | **Done** (on `dev`) |
| B6 | `mesh-view` | edit-mode overlays, static display, CPU picking, BVH lifecycle | 6.5 | B0a | **Done** (on `dev`) |
| B7 | `mesh-runtime-doc` | `MeshRuntime`, MeshSetOp runner, `BlobStore` (IndexedDB, `.ekzanim`), GC, undo byte budget, autosave, conformance cases | 7 | B0a | **Done** (on `dev`) |
| B8 | `mesh-io` | make editable, `meshToPrimitives`, surgeon "replace primitives" + marker v2, display rebuild, author writer, palette PNG, handheld profile, lints, provenance | 10 | B0a | **Done** (on `dev`) |
| B9 | `shell-workspaces` | workspace tabs, marking menus, command palette, Scale tool, shading modes, overlay slots, size gates | 5.5 | B0a | **Done** (on `dev`) |
| B10 | `model-select-ui` | modes and hilite, component selection UI, selection undo, hide/isolate, HUD, Mesh Check UI | 6.5 | B9, B6, B0b | **Done** (on `dev`) |
| B11 | `model-ops-ui` | operator registration, Toolkit, Last-op card, INPUTS, adjust/repeat, numeric capture | 5.5 | B9, B7 | **Done** (on `dev`) |
| B12a | `model-transform-tools` | component W/E/R, MMB-drag, Tweak, snapping, pivots, soft select, symmetry UI; owner feel check | 5 | B10, B11, B2 | **Done** (on `dev`) |
| B12b | `model-topology-tools` | extrude session, smart extrude, Multi-Cut, Insert Edge Loop, Target Weld, Slide, Bridge tools; symmetric pointer args | 5 | B10, B11, B2, B3, B4 | **Done** (on `dev`) |
| B13 | `model-content` | Outliner, palette and Paint Colour, primitives UI, templates, image planes, Make editable UI, Export dialog section | 7.5 | B1, B7, B8, B9 | **Done** (on `dev`) |
| INT | `integration` | E2E-MOD-01/15/16/30/31, AS-LP-S, budgets, docs, owner demo; one fix round (≈ 4) | 6 | all | **Done** (on `dev`; branch `m6a/integration` merged 2026-10-20) ([notes](wp-notes/m6a-integration.md), M6A-INT-1…33); the owner demo and feel check open |

### M6b MVP work-package status

Binding: [M6B-SPEC §0](M6B-SPEC.md#0-mvp-cut-owner-flow-2026-10-22) and [§9.0](M6B-SPEC.md#90-mvp-work-packages-binding-for-the-mvp-0).
Branches `m6b/<slug>` from and back into the integration branch **`m6b/mvp`** (from `dev`); INT merges `m6b/mvp` into
`dev` at the end. M6a is released, so no staging branch; CR-2, CR-4 and CR-7 are direct edits by C2, C7 and C1.

| WP | Slug | Scope | Size | Depends on | Status |
|---|---|---|---|---|---|
| C0 | `rig-contracts` | schema v4 (swatches stay 2), §4 + §0.5 contracts and stubs, four lazy chunks, Cube Lad and Polybot fixtures, e2e helpers | 4.5 | — | **Done** (merged by INT, 2026-10-22) |
| C1 | `character-runtime` | characters from scene meshes, `skeletonFromDoc`, container in the `character-runtime` chunk, skinned display, `rig.autoRig.update`, CR-7 | 5 | C0 | **Done** (merged by INT, 2026-10-22) |
| C2 | `skeleton-kernel` | templates (Standard 33 default), Quick Rig v2 fit + guess, BVH, MVP joint edits (move, rest rotate, orient, mirror, human bone), `skel.*` lints, CR-2 | 5 | C0 | **Done** (merged by INT, 2026-10-22) |
| C4 | `auto-skin` | Bind Skin (`auto-lowpoly`, heat, rigid islands, closest), worker, Bind/Unbind, sparse kit | 4.5 | C0 | **Done** (merged by INT, 2026-10-22) |
| C7 | `rig-shell` | tab, modes, test pose, channel sources incl. the `preview` hook, menus, Toolkit + MVP checklist, Validation as export gate, CR-4, eager gate | 5.5 | C0 | **Done** (merged by INT, 2026-10-22) |
| C12 | `clip-library` | CC0 UAL starter pack → VRMA (tooling + committed outputs + manifest + licence rows), Clip Library panel, preview, Use Clip | 5 | C0 | **Done** (merged by INT, 2026-10-22) |
| C10 | `character-writer` | VRM 1.0 writer (meta, thumbnail, shaders, clips), `vrm.*` = OMOBA runtime lints, plain GLB local only, export dialog | 5 | C1 | **Done** (merged by INT, 2026-10-22) |
| C3 | `skeleton-ui` | Quick Rig panel and markers (front x/y, side z/y), live preview, joint display and edits, Orient/Mirror boxes | 5 | C2, C7 | **Done** (merged by INT, 2026-10-22) |
| C6 | `skin-ui` | weights kernel (C5 subset) + Paint Skin Weights, display, Paint Weights panel, Toolkit Skin section | 6 | C1, C4, C7 | **Done** (merged by INT, 2026-10-22) |
| INT | `integration` | AS-MVP-1 scripted (E2E-MVP-01) + owner run, OMOBA validator on the export, E2E-RIG-10, budgets, docs; fix round (≈ 3) | 3 | all | **Done** ([notes](wp-notes/m6b-integration.md), M6B-INT-1…25; package review findings closed on `dev`); the owner run of AS-MVP-1 is open |

### Auto-Rig work-package status

Binding: [AUTORIG-SPEC §10](AUTORIG-SPEC.md#10-work-packages). Branches `autorig/<slug>` from and back into
**`autorig/mvp`** (from `dev`); D7 merged them on `autorig/integration` and merges `autorig/mvp` into `dev`.

| WP | Slug | Scope | Size | Depends on | Status |
|---|---|---|---|---|---|
| D0 | `contracts` | contracts, route-group-proof size tooling, AR-B1, gates, layout spike | 3 | — | **Done** |
| A0 | `a-pose` | the A-pose path in Studio: T-Stance, Apply Pose as Rest, *Straighten to T-Pose* | 5 | D0 | **Done** |
| D1 | `studio-host` | HostShell / StudioShell split, `(studio)` route group, navigation port, handoff records | 5 | D0 | **Done** |
| D2 | `entry-chooser` | landing chooser, remembered choice, Studio's switches | 1.5 | D1 | **Done** |
| D3 | `wizard-shell` | the frame, session, progress, Simple navigation, ① Model | 5 | D1 | **Done** |
| D4 | `rig-steps` | ② Markers, ③ Rig (`autorig.rig`, adjust, paint, motion test) | 5 | D3, A0 | **Done** |
| D5 | `animations` | ④ Animations (grid, preview, clip parameters, `autorig.clip.add`) | 4.5 | D3 | **Done** |
| D6 | `export` | ⑤ Export (targets, checklist, meta, OMOBA kit, `autorig.export`) | 4 | D3 | **Done** |
| D7 | `integration` | merges, AS-AR-1…12 in full, OMOBA runs, budgets, docs, fix round | 3 + ≈ 2 | all | **Done** ([notes](wp-notes/ar-integration.md), AR-D7-1…19, merged into `dev`); the owner run is open |

### M6b work-package status

*Full M6b, the reference for the work after the MVP; the MVP's packages are [above](#m6b-mvp-work-package-status).*

Packages, ownership and gates: [M6B-SPEC §9](M6B-SPEC.md#9-work-packages) (shared files in §9.1). Branches `m6b/<slug>`
merge into the staging branch `m6b/dev` until M6a's `release/0.3.0` is cut, then INT merges `m6b/dev` into `dev`
([M6B-SPEC §2.2](M6B-SPEC.md#22-branches-and-the-release-cut)). C0 lands first (after M6a's B0a); C8a needs only C0;
the other packages also wait for the M6a packages listed per row.

| WP | Slug | Scope | Size | Depends on (M6b; M6a) | Status |
|---|---|---|---|---|---|
| C0 | `rig-contracts` | schema v4, contracts and stubs, lazy chunks, Polybot-unskinned fixtures, contract requests CR-1…CR-10 filed on `dev` | 4.5 | —; B0a | Planned |
| C1 | `character-runtime` | characters from scene meshes, Import Static Model, `skeletonFromDoc`, synthesized container in the `character-runtime` chunk, skinned display, `rig.autoRig.update` with joint keys | 6 | C0; B1, B7, B8, B9 | Planned |
| C2 | `skeleton-kernel` | templates, joint edits and roles, sockets, Duplicate Joints, Orient/Mirror Joint, Attach Prop, Quick Rig fitter (T/A-pose), BVH, `skel.*` lints | 5.5 | C0; B1 | Planned |
| C3 | `skeleton-ui` | Joint tool (auto parent), Socket tool, joint display, move/rotate/test rule, Quick Rig stepper, joint panels | 5.5 | C2, C7; B6, B11, B12a | Planned |
| C4 | `auto-skin` | Bind Skin methods, Auto Weights for Selected Joints, worker, Bind/Unbind, sparse kit | 6 | C0; B1, B7 | Planned |
| C5 | `weights-kernel` | normalization and holds, strokes and the stroke session, utilities, mirror, inpainting (LDLᵀ) | 4.5 | C4; B2 | Planned |
| C6 | `skin-ui` | Paint Skin Weights, weight display and numbers, Paint Weights panel, Component Editor | 6 | C5, C7, C1; B6, B10, B12a | Planned |
| C7 | `rig-shell` | tab, modes, pose view, test pose, ROM, keymap, menus, Toolkit + checklist, Validation | 6.5 | C0; B0b, B9, B10, B11 | Planned |
| C8a | `constraint-kernel` | parent/point/orient/aim ops with per-target offsets, compiler rules, bake and mirror cores | 5 | C0 | Planned |
| C8b | `constraint-ui` | constraint operators and UI, Animate's Constrain menu | 3 | C8a, C7; B11 | Planned |
| C9 | `control-shapes` | shape library, `rig.shape.*`, Shapes mode with CV edit, shape edits without recompiles | 3.5 | C1, C7; B10, B12a | Planned |
| C10 | `character-writer` | VRM 1.0 / GLB writer, meta, thumbnail, profiles, export dialog | 5 | C1; B8 | Planned |
| C11 | `imports-recovery` | weight edits on imports, Make Character Editable, missing-weight fill | 4.5 | C5, C10; B8 | Planned |
| INT | `integration` | E2E-SKIN-08, E2E-RIG-10, AS-LP-S2, budgets, docs, owner demo; one fix round (≈ 4) | 5 | all; M6a INT + fix round | Planned |

## Recommended order

Set 2026-10-18 with the modeling plan; reasons per step in [MODELING-PLAN §9](MODELING-PLAN.md#9-ordering-relative-to-m2b-m2c-m3-and-m4).
The queue of next actions is [TODO.md](../TODO.md).

1. **M2a release**: owner review of [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18), demo
   script, tag `v0.2.0`.
2. **M6a modeling base**, with the M2c shell prerequisites (marking menus, command palette, workspaces, viewport Scale
   tool) pulled into its packages B0b and B9.
3. **M6b MVP** ([M6B-SPEC §0](M6B-SPEC.md#0-mvp-cut-owner-flow-2026-10-22), 2026-10-22): the owner flow from a
   box-modelled mesh to a VRM 1.0 for Space and OMOBA with a CC0 clip library, on `m6b/mvp` (≈ 48.5 agent-days,
   critical path ≈ 22 working days); release tag the owner's call (proposed `v0.4.0`). Then the **rest of M6b**
   (constraints, control shapes, joint tools, imports recovery, AS-LP-T) as the turnkey release.
4. **"Publish avatar to Ekza"** (the T3 slice of M4a: only the `studio-upload` scope is needed, the avatar kind exists)
   in parallel with **M7 G1**; then **M7 G2**, with **M6c** in parallel if wanted.
5. **M2b** and the rest of **M2c** → **V1** release.
6. **M4a T1** (typed animation assets), then **M3** collaboration (it now also carries mesh-chunk transport and mesh
   claims, ADR 0015), **M4b**, **M5**, **M8**.

---

## M0 — Scaffold and test kit (≈ 3 agent-days)

**Deliverables**: monorepo (pnpm 10.32.1, Turborepo, TS 6.0.3 with the per-package tsconfig matrix, oxlint +
tsgolint, Biome), final `package.json` files and lockfile, package skeletons with the MVP-SPEC §4 contracts and
stubs, implemented `anim-core/math` and `EkzaError`, ID helpers, `check-deps` / `check-fixtures` /
`check-licenses` tooling, DCO job, Next.js `/editor` placeholder with an R3F canvas, Playwright config, CI
workflow, LICENSE/CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/TRADEMARKS/REUSE, git `main` + `dev`; then the shared test
kit (fake `EditorApp`, synthetic fixtures, hooks, `/dev/panels` harness, Node GLTFLoader harness).

**Tasks**: [MVP-SPEC WP-0a](MVP-SPEC.md#wp-0a--scaffold-contracts-stubs-math-toolchain-integration-agent-first) and
[WP-0b](MVP-SPEC.md#wp-0b--shared-test-kit-integration-agent-right-after-wp-0a).

**Acceptance**: `pnpm install && pnpm ci` green on Node 24 (CI) and Node 25 (local); E2E-00 green in Chrome and in
SwiftShader CI; math tests green; every panel mounts in `/dev/panels` with the fake app.

**Depends on**: this design phase.

## M1 — MVP, public alpha `v0.1.0` (≈ 63 agent-days; ~3.5–4 calendar weeks with 7 agents + integration)

**Deliverables**: everything in [MVP-SPEC §1.1](MVP-SPEC.md#11-in-scope-m1-core): open GLB/VRM 0.x/1.0 and samples,
FK control rig (humanoid with `cog`/`fk.hips`, mesh-based sizes; generic), Plant Feet, node-constraint preview,
outliner, Channel Box, single/split/quad viewports with locked shot camera, Maya + trackpad navigation, W/E
manipulators with Gimbal mode, marquee and pick cycling, keying and auto-key, time slider with range editing,
scene clock, Canvas2D Graph Editor with the Maya tangent model and Simplify, multiple clips with provenance, pose
tools, editor history (unkeyed edits undoable), three exports (surgeon bake, animation-only GLB, VRMA), `.ekzanim`
projects, Ekza Tier-0 metadata, profiles and lints, contribution registries, the conformance suite on a test-only
Yjs store, licence and DCO checks. M1-stretch items ([MVP-SPEC §1.2](MVP-SPEC.md#12-m1-stretch-implement-only-if-time-remains-their-tests-are-testfixme-until-done))
ship only if time remains.

**Task list**: WP-1 … WP-10 in [MVP-SPEC §7](MVP-SPEC.md#7-work-packages); merge order and checkpoints in §8.1.
Early measurements in week 1: Graph Editor Canvas2D benchmark (ADR 0007), viewport 4-pane playback, kernel
evaluation bench (all reported, not gating).

**Acceptance**: [MVP-SPEC §8.2](MVP-SPEC.md#82-m1-definition-of-done): all unit/headless gates, E2E-00…E2E-27,
export policy §4.11.13, conformance suite on memory and `doc-yjs` stores, budgets recorded, owner demo script
(§8.3), tag `v0.1.0`.

**Status (2026-10-18)**: integrated and accepted on `dev`. All WP-1…WP-10 are merged; `pnpm run ci` is green with
E2E-00…E2E-27 (plus the acceptance-round, smoke and resilience specs) in real Chrome and in the `chromium-swiftshader`
CI project; the M1-stretch items that were not built are `test.fixme` in `apps/web/e2e/stretch.spec.ts`
(MVP-SPEC §1.2). The owner demo script (§8.3) passed in acceptance round 3. Open for the release: the owner's review
of [DECISIONS-OPEN](DECISIONS-OPEN.md) (§E lists every deviation and decision taken during the build), then the
`v0.1.0` tag, which is the owner's call.

### M1 budgets (ARCHITECTURE §14)

Measured 2026-10-18 on the integrated editor (production e2e build, real Chrome 155 with the GPU, 1440×900 at DPR 2)
on an Apple M4 Pro under shared load; method, raw numbers and caveats in
[wp-notes/wp-10-budgets.md](wp-notes/wp-10-budgets.md); rerun with `pnpm --filter web bench:budgets`. The §14
reference is an Apple M1-class laptop, roughly 1.5–2× slower per core, so a "Met" needs that headroom to hold there.
Report only: no budget gates CI except the idle check (E2E-00).

| §14 scenario | Budget | Measured | Verdict |
|---|---|---|---|
| Idle editor | 0 WebGL frames, 0 canvas redraws | 0 / 0 over 2 s (empty; Seed-san + wave in split and quad) | Met (gated by E2E-00) |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | 0.029 ms full pose in the app (Seed-san, 159 keyed curves); rig 0.016–0.028 ms | Met |
| Scrub: pointer move → pose visible | same animation frame | 40 / 40 moves in the same frame | Met |
| 1 VRM, 4 panes, shaded, playback at 30 fps | ≤ 8 ms CPU/frame | rAF work mean 0.95 ms, p95 2.0 ms; main-thread task time 1.73 ms per frame | Met |
| Graph Editor 50k keys / 10k visible, pan/zoom | ≤ 8 ms redraw | median 1.00 ms | Met |
| Graph Editor 50 curves × 200 keys, full redraw | ≤ 4 ms | median 1.30 ms | Met |
| Drag 1,000 selected keys | ≤ 4 ms per pointer frame | median 5.1 ms, p95 7.3 ms (≈ 2.9 ms pointermove handler + 2.5 ms frame) | **Miss** (M-1) |
| Undo/redo one gesture | ≤ 5 ms | 2.4 / 2.2 ms for the 1,000-key drag; 0.3 / 0.2 ms for a key step | Met (thin on the reference for 1,000 keys) |
| Open Seed-san (10.9 MB VRM) to interactive | ≤ 3 s | 109 ms median from the sample click; ≈ 0.5 s including the page load | Met |
| Bake + write VRMA, 1 humanoid × 10 s @ 30 fps | ≤ 200 ms | median 15.6 ms incl. lints and the read-back check | Met |
| Editor route JS (gzip, no fixtures) | ≤ 900 kB | 917.2 kB = 895.7 KiB (gzip -9, production build) | **At the limit** (M-2) |
| anim-core: 2,200 curves at one frame (MVP-SPEC §6.3 bench) | ≤ 0.3 ms | mean 0.32–0.35 ms, min 0.22 ms (loaded machine) | **Marginal miss** (M-3) |

Misses and owners. The repository has no public issue tracker yet; each miss is an issue to open with that ID when
the repository is published, tracked here until then.

| Issue | Budget | Owner | Next step |
|---|---|---|---|
| M-1 | Drag 1,000 selected keys ≤ 4 ms | WP-6 Graph Editor drag path, with WP-2 (store preview update) | Profile shows `previewUpdate` / `journalWrite` / `dropKeyGroupOfCurve` on top. Coalesce pointer moves to one preview update per animation frame; cheaper preview journaling for a uniform move; check what the frame re-evaluates for untouched curves. Fix before M2a's Dope Sheet, which drags more keys. |
| M-2 | Editor route JS ≤ 900 kB gzip | WP-8 shell and bundling | No headroom left for M2. Lazy-load the dialogs (export, import, about, preferences) and the Graph Editor menus; check that `three/examples` loaders and `@pixiv/three-vrm` are not duplicated across chunks. The M2 size gate must state its unit (kB = 1,000 B is the stricter reading). |
| M-3 | anim-core 2,200 curves ≤ 0.3 ms | WP-1 | Within noise on a loaded machine; one humanoid pose (~160–500 curves) costs 0.03–0.08 ms, so §14's pose budget is safe. Re-measure on an idle reference machine before acting. |

Not measured: the Apple M1 reference laptop, Safari and Firefox (V1), and the SwiftShader CI project (not a gate there).

M2a fixes the three misses with stated targets and mechanisms: M-1 in package A4 (M2A-SPEC §5.21.1), M-2 and M-3 in
package A5 (§5.21.2, §5.21.3, with a CI size gate at 900,000 B and an initial-route target of 800,000 B). **All three
are met on `dev` after the M2a merge** ([M2a budgets](#m2a-budgets-on-dev)).

### M6a budgets

Re-measured 2026-10-20 on `dev` right after the M6a merge (and the full local gate) with
`pnpm --filter web bench:budgets m6a-` (`apps/web/e2e/bench/m6a-{budgets,mesh-view,transform}.bench.ts`, real Chrome
with the GPU, 1440×900 at DPR 2, Apple M4 Pro shared with other agents, load average 16–25); the packages' Node
benches are in their wp-notes, and the `m6a/integration` measurements in
[wp-notes/m6a-integration.md](wp-notes/m6a-integration.md). Report-only except the gates (§5.27).

| Row | Budget | `dev` (2026-10-20) | `m6a/integration` |
|---|---|---|---|
| Idle in Model (20k tris, face mode) | 0 frames / 2 s (gate) | **0** ✓ (E2E-MOD-16, bench) | 0 ✓ |
| Enter component mode, 50k tris | ≤ 40 ms | 32.7 ms ✓ | 34.2 ms |
| Hover pick, 50k tris | ≤ 0.5 ms | p95 0.1 ms ✓ | p95 0.1 ms |
| Marquee with occlusion | ≤ 16 ms (10k vertices) | **65 ms for 4,452 vertices incl. a frame — miss** (owner item, DECISIONS-OPEN §I) | 65 ms |
| Drag 1,024 vertices / soft drag over 10k | ≤ 4 / ≤ 8 ms per frame | p95 2.4 / 6.6 ms ✓ | p95 2.5 / 6.7 ms |
| Typical topology op end to end | ≤ 16 ms | extrude 100 faces 15.7 ms ✓; loop on a 200-quad ring 16.0 ms ✓ (at the line); undo of the extrude 14.9 ms | 14.9 / 16.2 ms |
| Make editable / export one edited mesh | ≤ 150 / ≤ 50 ms | 56 / 11 ms ✓ | 64 / 15 ms |
| Leaving Model with an edited Seed-san | ≤ 300 ms | 175 ms ✓ | 189 ms |
| Editor route, first visit (`check:size`) | 900,000 B gate | **896,299 B** ✓ (headroom 3,701 B; +51,032 B over the M2a baseline 845,267 B, eager-delta gate not enforced) | 896,274 B |

### M6b MVP budgets

Measured 2026-10-22 on the integrated branch (`m6b/integration`) with `pnpm --filter web exec playwright test -c
e2e/bench/playwright.config.ts m6b-` (`apps/web/e2e/bench/m6b-{budgets,export,joints,paint}.bench.ts`, real Chrome with
the GPU, 1440×900 at DPR 2, Apple M4 Pro shared with other agents), `check:size` on a production build and the
package benches in their wp-notes. Report-only except the gates (M6B-SPEC §0.4.9, §5.25).

| Row | Budget | Measured |
|---|---|---|
| Idle in Rig & Skin (bound 3,001-point character, Skin mode; also Skeleton mode and the Test view) | 0 frames / 2 s (gate) | **0** ✓ (E2E-RIG-10, bench) |
| Switching the active influence | 0 bytes uploaded (gate) | **0** ✓ (E2E-SKIN-02; viewport DOM test of the joint overlay) |
| `/editor` route, first visit (`check:size`) | 900,000 B gate; MVP eager additions ≤ +6,144 B | **895,509 B** ✓; **+5,940 B** ✓ over the 889,569 B baseline |
| Lazy chunks `rig-workspace` / skin worker / `character-runtime` / `clip-library` (gzip) | ≤ 250 / 120 / 150 / 60 kB | 82.4 / 12.8 / 14.4 / 4.7 kB ✓ |
| Bind of a 3k-point low-poly character (33 joints), in the worker | ≤ 200 ms | 39 ms median of 3 (+ the next frame) ✓; the Cube Lad 35 ms |
| Test-pose edit (the run: test-pose write + evaluate; GPU skinning) | ≤ 4 ms per frame | 1.0 ms median, 1.4 ms p95 at 3k points ✓ |
| Paint stroke at 10k points | ≤ 4 ms per pointer frame | mean 0.66 ms, p95 1.2 ms ✓ (C6 bench) |
| Stroke commit / undo at 10k points | ≤ 5 / ≤ 10 ms (report-only until CR-1) | commit dispatch 0.8 ms; undo round trip 20 ms — **report-only miss** (CR-1 weight-only `writeData` deferred, §0.4.1) |
| Joint overlay rebuild (34 joints) | ≤ 2 ms | 0.4 ms median, 0.5 ms p95 ✓ (C3 bench, through the editor) |
| `rig.autoRig.update` inside a rest edit | ≤ 5 ms | a whole `skel.joint.move` run 4.1 ms median ✓ |
| Character export (bound Cube Lad, five clips × 60 frames, validator off) | ≤ 500 ms | 22 ms median ✓ (C10 bench) |
| Quick Rig live preview (one marker edit: fit of Standard 33 + the next frame) / Create Skeleton | report | 13.9 ms (mostly the frame wait) / 33 ms |
| Library preview start (fetch, verify, convert) / Use Clip | report | 33 ms / 23 ms (Cube Lad) |

### Auto-Rig budgets

Measured 2026-10-22 on `autorig/integration`: `check:size` on a production build; `apps/web/e2e/bench/autorig.bench.ts`
on the e2e build (real Chrome with the GPU, 1440×900 at DPR 2, Apple M4 Pro shared with other agents). Report-only
except the gates ([AUTORIG-SPEC §7](AUTORIG-SPEC.md#7-bundle-routes-and-budgets)).

| Row | Budget | Measured |
|---|---|---|
| `/editor` first visit | 900,000 B gate; Auto-Rig ≤ +2,048 B over AR-B1's 895,688 B | **896,743 B** ✓; **+1,055 B** ✓ |
| `/autorig` first visit | **660,000 B gate (enforced)**, target 620,000 B | **658,122 B** ✓ (target missed by 38 kB) |
| dockview on `/autorig` before *Open in Studio* | never (gate) | **0 files** ✓ |
| Idle in every step with no preview | 0 frames / 2 s (gate) | **0** ✓ (E2E-AR-10, six states) |
| `/autorig` first visit to an interactive ① | ≤ 1.5 s | 0.46–0.56 s ✓ |
| ② first entry (chunks + guess), Cube Lad | ≤ 1.0 s | 0.14–0.16 s ✓ |
| *Auto-rig* (commit + bind): Cube Lad / 9,408 triangles | ≤ 1.0 / ≤ 2.5 s | 0.11–0.46 / 0.22–0.58 s ✓ |
| First motion-test frame after rigging | ≤ 300 ms | sheet end → `PREVIEW` ≤ 300 ms ✓ (asserted in E2E-AR-05, AS-AR-1); the bench's "③ done" → preview 340 ms — report-only miss (AR-D7-13) |
| Export of the Cube Lad VRM | ≤ 500 ms | 14–18 ms (`autorig.export`) ✓ |
| *Straighten to T-Pose*, A-posed Polybot (1,184 points) | ≤ 200 ms | 20 ms ✓ |

### M2a budgets (on `dev`)

Re-measured 2026-10-18 on `dev` after the M2a merge (tree identical to `m2a/integration` at `9a8e3d0`):
`pnpm --filter web bench:budgets` on the e2e build (real Chrome 155 with the GPU, 1440×900 at DPR 2), run twice, and
the package benches (`anim-core` `vitest bench`, the rig, headless, doc, curve-editor and viewport bench tests), on
the same Apple M4 Pro at load average 7–41 (the first bench run started right after the SwiftShader e2e run; the
package benches ran at 9–12). Where the two bench runs differ both are given. Method as in
[wp-notes/wp-10-budgets.md](wp-notes/wp-10-budgets.md#reproduce); the integration branch's own measurements, before
and after its fix round 1, are in [wp-notes/m2a-integration.md](wp-notes/m2a-integration.md#budgets-re-measured-on-the-merged-branch)
and agree with these within run-to-run noise. Report only, except the CI size gate (`check:size`, 900,000 B) and the
idle check (E2E-00).

| Scenario | Budget | Measured on `dev` | Verdict |
|---|---|---|---|
| Idle editor | 0 WebGL frames, 0 canvas redraws | 0 / 0 over 2 s (empty; Seed-san + wave in split and quad), both runs | Met (gated by E2E-00) |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | 0.036 ms full pose in the app (51 controls, 147 curves); rig program 0.015 ms (synthetic) / 0.028 ms (Seed-san) | Met |
| Pose evaluation, 1 humanoid with 4 IK limbs (M2a) | ≤ 0.5 ms (target ≤ 0.06 ms) | 0.042 ms (Seed-san; the same rig at ikFk 0 0.028 ms, the M1 rig 0.027 ms) | Met |
| Scrub: pointer move → pose visible | same animation frame | 40 / 40, both runs | Met |
| 1 VRM, 4 panes, shaded, playback at 30 fps | ≤ 8 ms CPU/frame | rAF work mean 0.74 / 0.78 ms, p95 2.4 / 2.5 ms; task time 1.96 / 2.09 ms per frame; viewport bench 0.40 / 0.60 ms | Met |
| Graph Editor 50k keys / 10k visible, pan/zoom | ≤ 8 ms redraw | median 0.80 ms | Met |
| Graph Editor 50 curves × 200 keys, full redraw | ≤ 4 ms | median 1.10 ms | Met |
| **M-1** Drag 1,000 selected keys (gate p95 ≤ 4.0 ms) | ≤ 4 ms per pointer frame | M-1 bench (30 curves): first drag median 2.6 / 2.1 ms, p95 3.2 / 3.2 ms; warm drags median 2.3 / 2.1 ms, p95 2.7 / 2.5 ms. §14 bench (106 curves): median 2.0 / 2.1 ms, p95 3.2 / 3.2 ms (M1: 5.1 / 7.3 ms). Doc preview update 0.69 ms (≤ 1.0), commit 0.33 ms | **Met** |
| Undo/redo one gesture | ≤ 5 ms | 1,000-key drag 2.0 / 1.9 ms and 2.1 / 1.8 ms; key step 0.3 / 0.3 ms (max 1.2 ms); doc bench 1.07 / 1.25 ms | Met |
| Open Seed-san (10.9 MB VRM) to interactive | ≤ 3 s | median 130 / 138 ms from the sample click; page ready 405–414 ms after navigation | Met |
| Bake + write VRMA, 1 humanoid × 10 s @ 30 fps | ≤ 200 ms | median of runs 2–5 16.5 / 16.6 ms; the first export loads its chunk (+21–22 ms) | Met |
| Autosave write, Seed-san × 10 clips (M2a) | ≤ 50 ms main thread | median 11.5 / 11.8 ms, max 15.9 / 12.9 ms | Met |
| Dope Sheet redraw (M2a) | ≤ 4 ms | unit 450 × 200 keys: view 0.2, selection 0.3, one edited key 1.1 ms; in the editor (213 curves, 42,600 keys): zoom 0.7 ms (p95 ≤ 1.0), selection change 2.4 / 2.8 ms (p95 3.5 / 3.4) | Met |
| Dope Sheet drag, 1,000 selected keys (M2a) | ≤ 4 ms per pointer frame | 20.2 / 20.5 ms median, p95 24.2 / 24.0 ms (213 curves); unit bench 19.9 ms (450 curves: store preview 4.8 + compiling the moved curves 11.5 + the Dope Sheet's redraw 3.6 ms) | **Miss** (M-4) |
| Tween slider drag on 60 channels (M2a) | ≤ 4 ms per pointer frame | median 2.8 / 2.6 ms, p95 3.2 / 3.3 ms | Met |
| **M-2** Editor route JS (gzip -9, first visit) | ≤ 900 kB; M2a target 850 kB | clean production build 843,565 B (eager 837,033 B + First-run dialog 6,532 B); e2e build 845.0 kB, the bench's network capture equal to `check:size` (0.00 %, both visits) | **Met** (gate and the 850 kB target, M2A-INT-4) |
| **M-3** anim-core: 2,200 curves at one frame | ≤ 0.3 ms (target mean ≤ 0.20, p75 ≤ 0.25) | mean 0.171 ms, p75 0.172 ms (load 11; the integration branch 0.152–0.154 ms at load 6; M1: 0.32–0.35 ms) | **Met** |

After the acceptance fix round 1 (2026-10-19, M2A-INT-20…33) `check:size` reads 845,146 B first visit (+1.6 kB; gate
and the 850 kB target still met); the round changed no hot path the other rows measure (the per-frame foot roll does
the same work about a different pivot), so they were not re-run.

New miss and owner (no public tracker yet; the ID becomes an issue when the repository is published):

| Issue | Budget | Owner | Next step |
|---|---|---|---|
| M-4 | Dope Sheet drag of 1,000 keys ≤ 4 ms (M2A-SPEC §5.22, report only) | The shared drag path (store preview, curve cache, evaluation), with the Dope Sheet | The Graph Editor's M-1 drag moves 1,000 keys on 30 curves; the Dope Sheet drags them across 200+ curves, where recompiling every moved curve (≈ 11 ms) and the store preview (≈ 5 ms) dominate; the Dope Sheet's own redraw is 3.4–3.6 ms. M2b: recompile only the moved span of a curve, defer re-evaluating curves whose current-frame segment did not change. |

### M2a budget re-measurement (package A5, branch `m2a/platform-perf`, before the merge)

Measured 2026-10-18 with `pnpm --filter web bench:budgets` (e2e build, real Chrome 155 with the GPU, 1440×900 at DPR 2)
and the package benches, on the same Apple M4 Pro under heavier shared load than M1's record (load average 26–66 from
other agents' runs; method and raw numbers in [wp-notes/m2a-platform-perf.md](wp-notes/m2a-platform-perf.md)). This is
A5's branch before A1…A4 merge; the integration re-runs the table on the merged build (M2A-SPEC §10).

| §14 scenario | Budget | Measured | Verdict |
|---|---|---|---|
| Idle editor | 0 WebGL frames, 0 canvas redraws | 0 / 0 over 2 s (empty; Seed-san + wave in split and quad) | Met (gated by E2E-00) |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | 0.029 ms full pose in the app; rig 0.033 ms (synthetic) / 0.038 ms (Seed-san) | Met |
| Scrub: pointer move → pose visible | same animation frame | 40 / 40 moves in the same frame | Met |
| 1 VRM, 4 panes, shaded, playback at 30 fps | ≤ 8 ms CPU/frame | rAF work mean 1.23 ms, p95 2.6 ms; main-thread task time 2.16 ms per frame; viewport bench 0.42 / 0.80 ms | Met |
| Graph Editor 50k keys / 10k visible, pan/zoom | ≤ 8 ms redraw | median 1.10 ms | Met |
| Graph Editor 50 curves × 200 keys, full redraw | ≤ 4 ms | median 1.50 ms | Met |
| Drag 1,000 selected keys | ≤ 4 ms per pointer frame | median 5.1 ms, p95 7.1 ms (A5 does not touch this path) | **Miss** (M-1, package A4) |
| Undo/redo one gesture | ≤ 5 ms | 2.6 / 2.4 ms for the 1,000-key drag; 0.2 / 0.2 ms for a key step | Met |
| Open Seed-san (10.9 MB VRM) to interactive | ≤ 3 s | median 131 ms from the sample click (runs 144, 131, 105 ms; the first loads the model loader and the import pipelines); page ready 407 ms after navigation | Met (+22 ms vs M1, within §5.21.2's 100 ms) |
| Bake + write VRMA, 1 humanoid × 10 s @ 30 fps | ≤ 200 ms | median 15.0 ms (runs 2–5) incl. lints and the read-back; the first export loads its chunk: +20.5 ms | Met |
| Autosave write, Seed-san × 10 clips (M2a) | ≤ 50 ms main thread | median 11.8 ms (max 12.7 ms) task time per write, 1,800 keys | Met |
| Editor route JS (gzip, no fixtures) | ≤ 900 kB | first visit 785.2 kB (6 scripts), later visits 778.8 kB (gzip -9, production build; `check:size` equal to the byte) | **Met** (M-2: target 800 kB) |
| anim-core: 2,200 curves at one frame (MVP-SPEC §6.3 bench) | ≤ 0.3 ms | mean 0.157–0.160 ms, p75 0.162–0.164 ms, min 0.134 ms (pre-M-3 code in the same run: mean 0.371 ms) | **Met** (M-3: mean ≤ 0.20, p75 ≤ 0.25 ms) |

M-2 and M-3 are fixed on this branch. On an in-memory trial merge with A1…A4 the route's first visit measured
836.4 kB: under the gate, above the 800 kB target by the siblings' code (IK, Dope Sheet extras, tween); the
integration records the merged number and the next cuts named in the notes.

**What M1 is not** (said in the README and the app): no leg IK — feet are planted per key with Plant Feet; no Dope
Sheet; no animation layers; no facial expressions in VRMA.

**Depends on**: M0.

## M2a — Game-clip daily driver (≈ 35 agent-days with the budget fixes; ~14 working days on the critical path)

Build spec: [M2A-SPEC.md](M2A-SPEC.md) (contract deltas, normative behaviours, E2E-M2A-01…25, packages A0…A5). The
items below were planned in order; the spec builds them in parallel packages and adds the fixes for the M1 budget
misses M-1, M-2 and M-3 (M2A-SPEC §5.21).

1. **Two-bone leg IK** with pole vectors on the existing solver slot (`ik.leg.L/R`, `pole.leg.L/R`, `ik2` op from
   the M1 solver), IK/FK visibility, **IK/FK match and seamless switch**, import writing IK controls from sampled
   feet (R07 §15.4); then arm IK (FR-RIG-11). Acceptance: translating `cog` −5 cm leaves the IK foot unchanged.
2. Time-slider extras: Mod+drag copy, ripple; MMB time carry (FR-TIME-10).
3. **Dope Sheet** with summary/character/control rows, move/scale, hold bars, ripple (FR-DS-01..02).
4. Tween slider family, breakdown keys, mirror animation with half-cycle offset, cycle-aware auto tangents on loop
   clips (FR-KEY-08..09, FR-POSE-05, FR-GE-17).
5. Buffer curves, normalized/stacked views, Graph Editor scale/region (FR-GE-18..20); export-side key reduction
   (FR-EXP-12); pick-walk; Channel Box virtual slider; keying by body part; autosave + recovery (FR-PROJ-05).

**Acceptance**: a walk cycle and an attack clip with planted feet and contact are authored without Plant Feet
(E2E-M2A-23, -24); M-1, M-2 and M-3 met; public README with GIFs; `v0.2.x`.

**Status (2026-10-18)**: integrated on `m2a/integration` (A0, A4, A5, A1, A2, A3 in the M2A-SPEC §10.1 order, then
the integration and its fix round 1) and **merged into `dev`** (A0, A1, A2, A3, A4, A5, then `m2a/integration`, each
`--no-ff`; the result is the integration branch's tree byte for byte, M2A-INT-19; `pnpm run ci`, the SwiftShader e2e
project and the budget bench re-run on `dev`): every `READY`/`test.fixme` gate and package gate is a failure (the last one,
`graph.keys.scale`'s value scale, was turned on in fix round 1); E2E-00…27, E2E-M2A-01…25, the owner demo script as a
scripted walkthrough and the M1 acceptance-round specs pass in real Chrome and in the `chromium-swiftshader` CI project
(the three M1-stretch and six M2a-stretch items stay `test.fixme`, each with its fallback); the acceptance clips are
authored with real input and leg IK, and their undo history holds no Plant Feet; M-1, M-2 and M-3 are met
([budgets](#m2a-budgets-on-dev)); FR-EXP-12 is partial (≥ 3× only on linear blocking, owner item); README carries
the M2a scope, its known gaps and three GIFs. The contract PRs of A1…A5 are ratified in M2A-SPEC v0.3; deviations,
integration decisions and the owner review items are in
[DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18). Open for the release: the
owner's review of §F and the owner's own run of the demo script (M2A-SPEC §10.3); the `v0.2.0` tag is the owner's
call. **Acceptance fix round 1 (2026-10-19, on `dev`)**: the M2a acceptance round (a walk and an attack authored
through the UI, exported and sampled in Node) found two major defects — a ball roll pulled the toes joint off the foot
(bakes wrote a toes translation), and "In place" root motion slid planted IK feet sideways in the file — and twelve
minor ones; all are fixed with regression tests (M2A-INT-20…33, [notes](wp-notes/m2a-integration.md#acceptance-fix-round-1-on-dev-m2a-int-2033)),
"In place" now removes only the clip's travel (an owner item), and exports carry version 0.2.0. **M2a-stretch, not built** (M2A-SPEC §1.2, `test.fixme` in `e2e/stretch.spec.ts`; fallbacks built): ghost IK/FK
display, Dope Sheet "show all keyable channels", mesh pick → IK control, key hold and stepped preview, ankle/wrist
motion trails, `rig.ikFk.matchRange` with an automatic Simplify.

**Depends on**: M1. Leg IK uses the M1 solver and the existing solver slot; the records and tables are unchanged, but
`SCHEMA_VERSION` becomes 2 so that M1 apps open projects with enabled IK read-only (M2A-SPEC §5.7).

## M2b — Adoption: FBX/BVH/Mixamo retarget (≈ 10–15 agent-days)

FBX (Mixamo) and BVH import with humanoid bone-map retarget to curves or VRMA (FR-IO-11), humanoid inference for
generic rigs with a confirmation dialog (FR-IO-13), `.gltf` multi-file import (FR-IO-12), Bézier curve fitting on
import (FR-IO-14). **Gated by provenance**: every imported clip records its source and redistributability (FR-CLIP-09);
Mixamo-derived clips are marked non-redistributable and cannot be published under Ekza profiles.

**Acceptance**: a Mixamo walk plays on Polybot without foot inversion and carries `redistributable: 'no'`.

**Depends on**: M1 (provenance fields, import pipeline).

## M2c — Breadth and polish → V1 release (≈ 30–40 agent-days)

Spring-bone preview polish (FR-RIG-14), VRMA expressions and lookAt (FR-RIG-15, FR-EXP-07), onion skin and motion trails
(FR-VP-14..15), view history and camera bookmarks (FR-VP-13), playblast (WebCodecs), audio (FR-TIME-09), time
bookmarks → clips (FR-TIME-08), hotkey editor (FR-SHELL-10), Review workspace layout, selection sets and humanoid
picker (FR-POSE-07), History panel (FR-UNDO-06), data packs and trusted extensions (FR-EXT-03..04), "Preview as Ekza
Space" emulation (FR-EKZA-05), IO worker with an op-stream document replica, quality items (Firefox/WebKit smoke,
screenshot baselines, size budget gate, static/offline/storage/context-loss e2e, token contrast check, i18n string
table, Vite playground, docs site, Maya fixture calibration if a licence is available).

**Moved to M6a** (2026-10-18, package B9 of [MODELING-PLAN](MODELING-PLAN.md#42-work-packages)): marking menus
(FR-SHELL-09), command palette (FR-SHELL-08) and workspaces (FR-SHELL-11), which every modeling surface needs; the
Rig & Skin workspace is built in M6b, which on 2026-10-19 also took **constraints** (FR-RIG-10) and **control-shape
editing** (FR-RIG-13) from M2c ([M6B-SPEC](M6B-SPEC.md)). M2c is scheduled after M7 G1 ([recommended order](#recommended-order)), so its
polish covers the Model workspace too.

**Acceptance**: research 01's V1 exit criterion (daily-driver quality for game clips); V1 tagged release.

**Depends on**: M2a (IK), M1; M6a for the shell items above.

## M3 — Collaboration P1 (≈ 20–30 agent-days)

**Deliverables**: `doc-yjs` hardened into the production adapter (tuple key codec 06 §6.5, persistence via
`y-indexeddb`, providers); `apps/sync` (Hocuspocus 4, SQLite/Postgres persistence); one multiplexed socket;
presence (selection, scene-time markers, graph cursors, ghost drags at ~15 Hz); claims with take-over and the
exclusive claim for structural clip operations; follow and presenter playback; owner-signed share links
(edit/view); `HttpAssetStore` with presigned upload/download and hash verification; named versions and
restore-as-transaction; offline summary; `.ekzanim` merge-on-open for files with CRDT updates.

**Tasks**: (1) adapter hardening (the conformance suite already passes in M1); (2) sync service + persistence;
(3) presence UI; (4) claims; (5) versions; (6) asset service; (7) e2e with two browser contexts.

**Acceptance**: R06 P1 exit criteria — two browsers animate two characters live; claims prevent same-curve edits;
killing the server loses no committed edits; 30 min offline then reconnect merges.

**Depends on**: M1 (store boundary, IDs, partitions, merge units, scene clock); M2 not required. Owner decisions:
hosting, anonymous share links ([DECISIONS-OPEN](DECISIONS-OPEN.md) Q-COL-2, Q-COL-3).

**From the modeling plan** (ADR 0015): `HttpAssetStore` also transports mesh revision chunks (`BlobStore`, upload
dirty chunks before writing the ref, fetch by hash); entering a component mode takes an exclusive mesh claim on the
mesh record; skeleton and skin edits take the exclusive `rig` claim. No CRDT schema work for meshes. Scheduled after
M6/M7 so the sync transport covers mesh blobs once.

## M4a — Ekza T1/T3 (≈ 15–20 agent-days in this repo + ecosystem work)

**Deliverables**: Tier 1 typed asset `ekza:animation:<uuid>` with profile `universal / vrma-humanoid-v1` (registry
migration, validator, Hub UI, SDK changes, Space emote consumer — tracked in the owning repos per research 03
§7.2–7.4, with tracking issues opened during M2); Tier 3 "Publish to Ekza" (device-code login, `studio-upload`
scope, upload flow with lints and provenance); "Open from Ekza" deep link with verified download and the
`ekza-studio-embed/v1` iframe protocol with Hub; Tier 2 avatar animation sets (OMOBA aliases) if prioritized.

**Acceptance**: an animation exported from the editor is published, admitted by the registry profile check and
played as an emote in Ekza Space.

**Depends on**: M1 exports and metadata only; ecosystem changes in registry/SDKs/games; owner decisions
(Q-EKZA-3…Q-EKZA-10). Independent of collaboration.

**Early slice (modeling plan)**: T3 "Publish avatar to Ekza" for characters made in the editor (device-code login,
`POST /v1/studio/assets { assetKind: 'avatar' }`, source `.vrm`, thumbnail, submit) needs only the `studio-upload`
scope, because the registry's `avatar` kind already exists; it can ship right after M6b, in parallel with M7 G1
(≈ 2 agent-days here + the registry scope). T1 (`ekza:animation`) stays in this milestone.

## M4b — Collaboration auth and permissions (≈ 8–12 agent-days)

Collab JWT minted by the Next.js backend after Ekza session checks, role matrix, per-document permissions, review
comments (FR-COL-06). **Acceptance**: a commenter cannot change animation (server-enforced). **Depends on**: M3.

## M5 — V2: layers, IK polish, power tools (≈ 60+ agent-days)

**Deliverables**: animation layers UI + evaluation (additive/override, weights, mute/solo, merge, avatar masks);
space switching with matching; foot roll; quaternion rotation curves; non-linear clip sequencing; multi-character
clips; pose library; editable motion trails; smoothing filters; scripting console and MCP bridge over operators;
BVH/FBX export adapters; per-user animation layers + region claims for "four hands" (usage-driven); generic
constraints in collaboration.

**Acceptance**: R01 V2 feature list; collaboration scenario B (four hands) on separate layers.

**Depends on**: M2a/M2c (rig ops), M3 (collaboration for per-user layers).

## M6 — Modeling (replaced 2026-10-18: polygons first)

The old M6 ("Modeling, splines first") is replaced by a polygon-first sequence planned in
[MODELING-PLAN.md](MODELING-PLAN.md) on research 10–16, with ADRs 0014–0016 (accepted with the M6a spec) and 0017
(proposed; its provenance items accepted with M6a) and the owner decisions of
[DECISIONS-OPEN §G](DECISIONS-OPEN.md#g-modeling-iteration-m6am7-defaults-chosen-2026-10-18). The owner's goal is a
turnkey tool: model a low-poly character and a prop → rig and skin → animate → export to Ekza, with AI generation
feeding the same pipeline later. Interaction model: Maya's (component modes, marking menus, Maya keys and names) with
Blender's semantics (adjust last operation, typed numbers in tools, live preview, symmetry remembered per mesh) and
a BMesh-style kernel; no construction history (ADR 0016, ADR 0014).

### M6a — Modeling base (≈ 108 agent-days + a fix round)

Build spec: [M6A-SPEC.md](M6A-SPEC.md) v1.0 (contracts, normative behaviours, operator table, keymap, UI placement,
work packages, E2E-MOD-01…32, AS-LP-A/B); where it refines the plan, its §12.2 says why.

**Deliverables**: Model workspace tab (Model › Rig & Skin › Animate › Review) with marking menus, command palette,
viewport Scale tool and shading modes (pulled from M2c); `mesh-core` kernel (radial-edge structure of arrays, write
log, Euler operators, deterministic ops, attribute layers that keep UVs, colours, skin weights and morph deltas valid)
and `mesh-view` (overlays, CPU picking); component modes and selection (loops, rings, grow/shrink, convert, soft
selection, symmetry for every base tool, undoable selection, hide/isolate); six low-poly primitives with live
parameters; extrude as a Maya-style session (`Ctrl+E`, then the manipulator or `W`/`R` on the cap, then Divisions),
inset, bevel (≤ 3 segments), insert and offset edge loops, Multi-Cut, connect, Slide Edge/Vertex, Average Vertices,
bridge (divisions, twist, offset), fill hole, merge/Target Weld/collapse, delete and Delete Edge/Vertex, spin/flip
edge, mirror, symmetrize, combine/separate/extract, triangulate/quadrangulate, freeze transforms, MMB-drag and Tweak
moves, pivot editing and snapping; reference image planes in the ortho views; hard/soft edges with WYSIWYG normals
and one hard-flag propagation rule; per-face palette colour with palette-texture, `COLOR_0` and per-colour-material
exports; planar/box/cylindrical UV projections; Poly Count HUD with budgets and Mesh Check; Adjust Last Operation,
`G` repeat, numeric input in a narrow window; mesh storage as revision refs over content-addressed chunks with a
byte-bounded undo (ADR 0015, schema v3); "Make editable" for imported meshes, the surgeon's "replace primitives"
step with bake marker v2, edited characters re-displayed through the normal loader, an author GLB writer and the
`ekza/omoba-handheld-v1` profile.

**Packages**: B0a contracts, schema v3 and mesh-core interfaces → B0b keymap rows ‖ B1 kernel ‖ B6 mesh-view ‖ B7
runtime + blobs ‖ B8 io ‖ B9 shell → B2…B5 (selection, core ops, shape ops + Multi-Cut + slide, bevel + Mesh Check +
UV) and B10…B13 (selection UI, operators UI, B12a transform tools ‖ B12b topology tools, content) → INT → fix round
([M6A-SPEC §9](M6A-SPEC.md#9-work-packages), [status](#m6a-work-package-status)); critical path B0a → B1 → B4 → B12b → INT
≈ 31.5 working days, ≈ 35.5 with the fix round (B12b waits for B3 and B4; 27.5 / 31 if it starts on READY gates).

**Acceptance**: kernel property tests (validity, Euler characteristic, manifoldness, bit-exact undo, cross-runtime
determinism, attribute propagation, all-hard preservation, symmetric tools) and the count oracles; E2E-MOD-01…32 in
Chrome and SwiftShader; an owner feel check after B12a; AS-LP-A/B (a character from a cube against reference images
using every base tool, and a sword; static) by the owner; budgets recorded; tag `v0.3.0` (owner's call).

**Depends on**: the M2a release; M1 registries, selection, history and IO.

### M6b — Rig & Skin workspace, turnkey (≈ 70.5 agent-days + a fix round; turnkey minimum ≈ 62)

Build spec: [M6B-SPEC.md](M6B-SPEC.md) v1.1, revised after its design review (contracts and schema v4, normative behaviours, operator table, keymap, UI
placement, work packages C0…C11 + INT, E2E-SKIN/E2E-RIG/E2E-CNS scenarios, AS-LP-T); expanded on the owner's request
from "characters from own models" into a full but bounded rigging workspace (research 17, 18, 19).

**Deliverables**: the Rig & Skin workspace (modes Object/Skeleton/Skin/Shapes, pose view Bind/Test/Clip, Maya's
Skeleton/Skin/Constrain/Control menus and marking menus, a setup checklist, the Validation panel as the export gate);
characters from the user's own meshes (adoption, Import Static Model) with the control rig regenerated inside every
skeleton edit; VRM humanoid templates (Lite 17, Core 21, Standard 33 with mitten hands, Full 52) with rest flexion and
Quick Rig (markers or a One-Click guess; T- and A-posed meshes); the Joint tool with Snap to Projected Center,
symmetry and an automatic parent, Insert Joint, Split Bone, Add Chain, Duplicate Joints, Remove/Delete, Parent/Unparent,
Map Humanoid Bone, joint roles (deforming, helper, prop) and sockets, **Orient Joint** and **Mirror Joint**; test poses
that never key (IK limbs bend in FK for the test), Go to Bind Pose, a ROM clip, Apply Pose as Rest; **Bind Skin** (Auto
(low-poly), closest in hierarchy, rigid islands, bone heat; worker) and Auto Weights for Selected Joints; **Paint Skin Weights** (Maya operations, holds, mirror stroke, posed painting), the
numbers overlay, the **Component Editor**, Mirror/Copy (inpainting)/Smooth/Hammer Skin Weights, Prune, Normalize, Remove
Unused Influences, Move Weights; **constraints** parent/point/orient/aim with keyable weights, maintain offset and bake
(from M2c); **control-shape editing** (from M2c); **Attach Prop** for handhelds; the VRM 1.0 / GLB character writer with
meta, licence presets and thumbnail; weight edits on imported characters through the surgeon and Make Character
Editable; exporter-agnostic `ekza/space-avatar-v1`; T0 guide. Non-goals: set driven keys, node editor, rig scripting,
blend-shape authoring, muscle systems.

**Acceptance**: Polybot without weights auto-skins within one joint on ≥ 98 % of points (exact ≥ 85 %, calibrated);
Orient Joint leaves deformation and humanoid animation within 1e-9; constraint rest exactness and the M2a schedule
identity; validators 0 errors; byte-identical re-export; E2E-SKIN-01…14, E2E-RIG-01…10, E2E-CNS-01…04 including the
scripted turnkey walkthrough; AS-LP-T ("Lowpoly Lad and his sword" end to end); turnkey release `v0.4.0` (owner's
call).

**Depends on**: M6a's B0a (contracts) for C0; then per package B1, B7, B8, B9 (runtime), B2 (weights), B0b, B10, B11
(shell), B6, B12a (tools); M6a's release cut for INT ([M6B-SPEC §2.3](M6B-SPEC.md#23-m6a-prerequisites-per-package)).

### M6c — UV editor and texturing basics (optional, ≈ 18 agent-days)

Seams → LSCM unwrap → skyline packing (xatlas as an optional adapter), UV Editor pane on Canvas2D, image textures per
material, decal region, ramp swatches, vertex-colour painting. By demand; can run in parallel with M7.
**Depends on**: M6a.

## M7 — AI 3D generation (G1 ≈ 22, G2 ≈ 14 agent-days; G3 with M4a/M4b)

**Deliverables**: server-side gateway behind the provider-agnostic `ekza-gen/v1` contract (no keys or provider origins
in the browser; off unless enabled, auth required, server-side spend caps; the app's first CSP; self-hosted, BYO-key
and later hosted modes); Tripo (characters, VRM-named rig) and Meshy (props)
adapters with a mock provider server; Generate panel and job tray; intake operators (normalize, reduce with
meshoptimizer, cleanup, palette bake) on the modeling kernel; provider rig or own rig; provenance recorded at import
and exported in `ekza_model_v1` (ADR 0017). G2: self-hosted GPU worker (TRELLIS.2, TripoSG, UniRig), fal.ai and
Hunyuan cloud adapters, multiview, OBJ import, geodesic voxel binding. G3: hosted platform key with quotas, registry
AI fields.

**Acceptance (G1)**: from one reference image, a rigged ≤ 3,000-triangle, ≤ 16-colour humanoid is animated with the
M2a tools and exported as a VRM 1.0 that passes `ekza/space-avatar-v1` with provenance; green against the mock server;
no provider key or origin in the client bundle.

**Depends on**: M6b (rig/skin), M6a (cleanup operators, provenance contracts).

## M8 — Splines and generators (the old M6; size TBD)

**Deliverables**: renderable `curve` records registered through `TableDef` using the shared `SplineSet`
(poly/Bézier, then NURBS), viewport CV/EP/pen tools reusing the Graph Editor's Bézier editing kernel, curve component
selection, generators (sweep, loft, revolve, extrude, tube) with construction history and per-op dirty propagation
whose output is an M6 mesh, `EKZA_curves` glTF extension (vendor prefix registered first) with a `LINE_STRIP`
fallback; sandboxed third-party plugins.

**Acceptance**: a user draws a spline, sweeps a tube along it, exports a GLB that loads in three.js and Bevy.

**Depends on**: M6a (mesh kernel, Model workspace, component selection), M1 registries.

---

## Cross-milestone risks

| Risk | Milestone | Mitigation |
|---|---|---|
| Canvas2D Graph Editor misses the 50k-key budget in Safari | M1 week 1 | `CurveRenderer` interface; WebGL curve layer only |
| Spline/Clamped feel differs from Maya | M1–M2 | AnimX-exact Auto default; calibrate with Maya fixtures if a licence exists |
| Yjs cannot meet the store contract | **M1 WP-2** | `doc-yjs` runs the full suite in CI; contract changes land before the operator freeze; Loro as the named alternative |
| FK-only legs disappoint animators in the alpha | M1 | Plant Feet; say it plainly in README and app; leg IK is M2a item 1; owner may pull it into M1 (Q-RIG-5) |
| M1 scope (63 agent-days) slips | M1 | M1-stretch list; WP-7 split; test kit from day 1; integration agent owns lockfile and shell |
| Registry/game changes slip | M4a | Tier 0 already works in Space; Tier 1 tracked in owning repos from M2 |
| R3F 9 pins React minors; three.js focus on WebGPU | ongoing | Renovate groups; renderer swap isolated in `viewport` |
| Scope creep from Maya breadth | all | Requirements carry priorities; MVP-SPEC is the contract; modeling: BASE/stretch tags, bevel ≤ 3 segments, bounded Multi-Cut (MODELING-PLAN §4.5) |
| Name conflict for "Ekza Studio" | before M1 alpha | Trademark search (Q-NAME-3) |
| Mesh kernel emits invalid topology or non-deterministic results | M6a | Refusal policy, `validateMesh` after every commit in debug builds, property tests P1–P9 incl. Node vs Chromium hashes (ADR 0014) |
| Modeling edits silently break skin weights or VRM expressions | M6a/M6b | Attribute layers with propagation rules inside one revision, stable morph order, licence gate, surgeon read-back tests (ADR 0015) |
| Shared-contract ripple into shipped animation code (operators, selection, keymap scopes, schema v3) | M6a | One atomic contracts package (B0a, keymap rows in B0b); M1/M2a e2e stay green at every merge |
| Auto-skin quality on single-piece organic low-poly bodies | M6b | Bone heat with stiffness and rigidify; weight tools in the first release; gates on segmented and single-piece fixtures |
| M6b scope growth after the Rig & Skin expansion and its design review (≈ 70.5 vs 43.5 agent-days) | M6b | Work ends before M6a's release cut; a named turnkey minimum (≈ 62); stretch items as `test.fixme` (M6B-SPEC §12.3) |
| Constraint compiler changes shift shipped schedules or exports | M6b | Schedule-identity and export byte-identity gates on every M2a fixture rig (M6B-SPEC P-C3) |
| AI provider churn, terms and cost | M7 | Pinned model versions, contract tests, mock server in CI, BYO/self-host first, quotes and caps (ADR 0017) |
| Mesh undo history pins hundreds of MB (morph-heavy imports, whole-layer ops) | M6a | Derived GC roots, undo byte budget with eviction, journal cap, implicit default tail in chunks (ADR 0015) |
| Tool feel found wrong only at the final owner run | M6a | Transform and topology tools in separate packages (B12a/B12b), owner feel check after B12a, AS-LP-A requires every base tool |
| An exposed generation gateway spends the operator's credits | M7 | Off unless enabled, auth required, server-side spend caps, CSP before BYO keys (ADR 0017) |
