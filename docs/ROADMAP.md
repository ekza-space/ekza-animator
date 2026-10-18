# Ekza Animator — Roadmap

Status: v0.5 (2026-10-18, M1 integrated and accepted on `dev`, the `v0.1.0` tag pending; **M2a integrated** on
`m2a/integration` (M2A-SPEC v0.3), its `v0.2.x` tag the owner's call). Keep the [status table](#status) current: every merged milestone task updates it. Requirement IDs refer to
[REQUIREMENTS.md](REQUIREMENTS.md); the MVP build plan is [MVP-SPEC.md](MVP-SPEC.md), the M2a build plan is
[M2A-SPEC.md](M2A-SPEC.md). Sizes are rough
**agent-days** (one implementation agent working full time); calendar time depends on parallelism.

## Status

| Milestone | Scope | Status | Started | Done | Notes |
|---|---|---|---|---|---|
| D | Research + architecture + MVP spec + design review | **Done** | 2026-10-17 | 2026-10-17 | `docs/research`, `ARCHITECTURE.md`, ADRs 0001–0013, `MVP-SPEC.md` v0.2 |
| M0 | Scaffold, contracts, stubs, math, toolchain, test kit | **Done** (on `dev`) | 2026-10-17 | 2026-10-17 | WP-0a + WP-0b; local gates green, CI runs on the first push |
| M1 | MVP → public alpha `v0.1.0` | **Done** (on `dev`); tag `v0.1.0` pending | 2026-10-17 | 2026-10-18 | WP-1…WP-10 done; E2E-00…E2E-27 green in Chrome and SwiftShader; owner demo script passes (acceptance round 3); [budgets](#m1-budgets-architecture-14) recorded, 3 misses with owners. The tag waits for the owner's review of [DECISIONS-OPEN](DECISIONS-OPEN.md) |
| M2a | Game-clip daily driver | **Done** (integrated on `m2a/integration`, to merge into `dev`); tag `v0.2.x` pending | 2026-10-18 | 2026-10-18 | [M2A-SPEC](M2A-SPEC.md) v0.3: A0…A5 + integration ([status](#m2a-work-package-status)); E2E-00…27 and E2E-M2A-01…25 green in Chrome and SwiftShader, the acceptance walk and attack authored without Plant Feet; M-1, M-2, M-3 [met](#m2a-budgets-integrated); one new report-only miss (M-4, Dope Sheet drag); owner items in [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18) |
| M2b | Adoption: FBX/BVH/Mixamo retarget | Planned | — | — | gated by provenance |
| M2c | Breadth and polish → V1 release | Planned | — | — | |
| M3 | Collaboration P1 | Planned | — | — | `doc-yjs` already passes the suite (M1) |
| M4a | Ekza T1/T3 (typed animation assets, publish, open from Ekza) | Planned | — | — | depends on M1 + other repos |
| M4b | Collaboration auth and permissions | Planned | — | — | after M3 |
| M5 | V2: layers, IK polish, power tools | Planned | — | — | |
| M6 | Modeling: splines first | Planned | — | — | |

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
| A0 | `contracts-foundation` | §4 contracts, stubs and working baselines, schema v2 (atomic), attribute channels in the compiler and kernel, frame scheduler, key gesture, cycle-aware loop clips, layout v2, keymap, menus, test API | Integration | 3.5 | Done (merged into `m2a/integration` first) | [notes](wp-notes/m2a-contracts-foundation.md) |
| A1 | `rig-ik` | `ik2` op with foot roll in the foot frame, mesh-based foot pivots, limb IK records, hyperextension-safe matching, import to IK with fidelity fallback, Plant Feet on IK legs | A1 | 6.5 | Done (merged; contract PR C-1…C-7 ratified) | FR-RIG-11; [notes](wp-notes/m2a-rig-ik.md) |
| A2 | `ik-editor` | IK operators and UI (Channel Box, Attributes with foot fields, viewport), visibility, pick-walk, virtual slider (rows and viewport MMB), body-part keying | A2 | 6 | Done (merged; IK tests and E2E-M2A-01…07, 25 run ungated) | [notes](wp-notes/m2a-ik-editor.md) |
| A3 | `dopesheet-timing` | Dope Sheet, time-slider copy/ripple/MMB carry/nudge, insert/remove time, global-region ripple, breakdown retiming | A3 | 5.5 | Done (merged; E2E-M2A-10b and -14 run ungated) | FR-DS-01..02, FR-TIME-10; [notes](wp-notes/m2a-dopesheet-timing.md) |
| A4 | `graph-posing` | Tween family (status line too), breakdown display, half-cycle mirror animation, buffer curves, normalized/stacked views, scale/region tool, M-1 (frame profile first) | A4 | 5.5 | Done (merged; M-1 met on the merged build, p95 3.1–3.4 ms; E2E-M2A-15 ungated) | [notes](wp-notes/m2a-graph-posing.md); FR-KEY-08..09, FR-GE-18..20 |
| A5 | `platform-perf` | M-2 lazy loading + size gate, M-3 curve evaluation, autosave + recovery, export key reduction | A5 | 5 | Done (merged; M-2 gate in CI, M-3 met) | FR-PROJ-05, FR-EXP-12; [notes](wp-notes/m2a-platform-perf.md) |
| INT | `integration` | Acceptance E2E-M2A-23/24 (walk and attack with leg IK), budgets, README/ROADMAP/REQUIREMENTS/DECISIONS | Integration | 3 | Done (branch `m2a/integration`) | [notes](wp-notes/m2a-integration.md); gates turned into failures, M2A-INT-1…14 |

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
are met on the integrated M2a build** ([M2a budgets](#m2a-budgets-integrated)).

### M2a budgets (integrated)

Measured 2026-10-18 on the integrated branch `m2a/integration` (all six packages merged): `pnpm --filter web
bench:budgets` on the e2e build (real Chrome 155 with the GPU, 1440×900 at DPR 2), the A3/A4 benches and the package
benches, on the same Apple M4 Pro at load average 5.8–10.8 (the host's own services; no other agent build ran).
Method and raw numbers in [wp-notes/m2a-integration.md](wp-notes/m2a-integration.md). Report only, except the CI size
gate (`check:size`, 900,000 B) and the idle check (E2E-00).

| Scenario | Budget | Measured | Verdict |
|---|---|---|---|
| Idle editor | 0 WebGL frames, 0 canvas redraws | 0 / 0 over 2 s (empty; Seed-san + wave in split and quad) | Met (gated by E2E-00) |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | 0.035 ms full pose in the app (51 controls, 147 curves) | Met |
| Pose evaluation, 1 humanoid with 4 IK limbs (M2a) | ≤ 0.5 ms (target ≤ 0.06 ms) | 0.042 ms (Seed-san; the same rig at ikFk 0 0.028 ms, the M1 rig 0.027 ms) | Met |
| Scrub: pointer move → pose visible | same animation frame | 40 / 40 | Met |
| 1 VRM, 4 panes, shaded, playback at 30 fps | ≤ 8 ms CPU/frame | rAF work mean 0.75 ms, p95 2.4 ms; task time 1.94 ms per frame | Met |
| Graph Editor 50k keys / 10k visible, pan/zoom | ≤ 8 ms redraw | median 0.80 ms | Met |
| Graph Editor 50 curves × 200 keys, full redraw | ≤ 4 ms | median 1.10 ms | Met |
| **M-1** Drag 1,000 selected keys (gate p95 ≤ 4.0 ms) | ≤ 4 ms per pointer frame | median 2.5 ms; p95 3.1, 3.2, 3.4, 3.3 ms in four runs (M1: 5.1 / 7.3 ms); doc preview update 0.69 ms (≤ 1.0) | **Met** |
| Undo/redo one gesture | ≤ 5 ms | 2.1 / 1.8 ms for the 1,000-key drag; 0.3 / 0.3 ms for a key step | Met |
| Open Seed-san (10.9 MB VRM) to interactive | ≤ 3 s | median 116 ms from the sample click; page ready 410 ms after navigation | Met |
| Bake + write VRMA, 1 humanoid × 10 s @ 30 fps | ≤ 200 ms | median 16.3 ms; the first export loads its chunk (+24 ms) | Met |
| Autosave write, Seed-san × 10 clips (M2a) | ≤ 50 ms main thread | median 11.5 ms, max 12.6 ms | Met |
| Dope Sheet redraw (M2a) | ≤ 4 ms | 450 × 200 keys: 0.2–1.0 ms; in the editor (213 curves): zoom 0.4 ms, selection change 2.7 ms (p95 3.9) | Met |
| Dope Sheet drag, 1,000 selected keys (M2a) | ≤ 4 ms per pointer frame | 21.2 ms median, p95 26.1 ms (213 curves); unit bench 19.0 ms (450 curves) | **Miss** (M-4) |
| Tween slider drag on 60 channels (M2a) | ≤ 4 ms per pointer frame | median 2.7 ms, p95 3.2 ms | Met |
| **M-2** Editor route JS (gzip -9, first visit) | ≤ 900 kB; M2a target 850 kB | 843,270 B production (eager 836,738 B); the bench's network capture equals `check:size` (0.00 %) | **Met** (target set to 850 kB with the attribution: A1…A4 add ≈ 58 kB eager; M2A-INT-4) |
| **M-3** anim-core: 2,200 curves at one frame | ≤ 0.3 ms (target mean ≤ 0.20, p75 ≤ 0.25) | mean 0.154 ms, p75 0.159 ms (M1: 0.32–0.35 ms) | **Met** |

New miss and owner (no public tracker yet; the ID becomes an issue when the repository is published):

| Issue | Budget | Owner | Next step |
|---|---|---|---|
| M-4 | Dope Sheet drag of 1,000 keys ≤ 4 ms (M2A-SPEC §5.22, report only) | The shared drag path (store preview, curve cache, evaluation), with the Dope Sheet | The Graph Editor's M-1 drag moves 1,000 keys on 30 curves; the Dope Sheet drags them across 200+ curves, where recompiling every moved curve (≈ 11 ms) and the store preview (≈ 5 ms) dominate; the Dope Sheet's own redraw is 3.4 ms. M2b: recompile only the moved span of a curve, defer re-evaluating curves whose current-frame segment did not change. |

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
the integration): every `READY`/`test.fixme` gate is a failure; E2E-00…27, E2E-M2A-01…25 and the M1 acceptance-round
specs pass in real Chrome and in the `chromium-swiftshader` CI project (the stretch items stay `test.fixme`); the
acceptance clips are authored with real input and leg IK, and their undo history holds no Plant Feet; M-1, M-2 and
M-3 are met ([budgets](#m2a-budgets-integrated)); README carries the M2a scope, its known gaps and three GIFs. The
contract PRs of A1…A5 are ratified in M2A-SPEC v0.3; deviations, integration decisions and the owner review items
are in [DECISIONS-OPEN §F](DECISIONS-OPEN.md#f-m2a-build-deviations-2026-10-18). Open for the release: merge into
`dev`, the owner's review of §F and the owner demo script (M2A-SPEC §10.3); the `v0.2.0` tag is the owner's call.

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

Constraints (parent/point/orient/aim) (FR-RIG-10), control shape editing in a Rig workspace (FR-RIG-13), spring-bone
preview polish (FR-RIG-14), VRMA expressions and lookAt (FR-RIG-15, FR-EXP-07), onion skin and motion trails
(FR-VP-14..15), view history and camera bookmarks (FR-VP-13), playblast (WebCodecs), audio (FR-TIME-09), time
bookmarks → clips (FR-TIME-08), marking menus (FR-SHELL-09), command palette (FR-SHELL-08), hotkey editor
(FR-SHELL-10), Rig/Review workspaces (FR-SHELL-11), selection sets and humanoid picker (FR-POSE-07), History panel
(FR-UNDO-06), data packs and trusted extensions (FR-EXT-03..04), "Preview as Ekza Space" emulation (FR-EKZA-05),
IO worker with an op-stream document replica, quality items (Firefox/WebKit smoke, screenshot baselines, size
budget gate, static/offline/storage/context-loss e2e, token contrast check, i18n string table, Vite playground,
docs site, Maya fixture calibration if a licence is available).

**Acceptance**: research 01's V1 exit criterion (daily-driver quality for game clips); V1 tagged release.

**Depends on**: M2a (IK), M1.

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

## M4a — Ekza T1/T3 (≈ 15–20 agent-days in this repo + ecosystem work)

**Deliverables**: Tier 1 typed asset `ekza:animation:<uuid>` with profile `universal / vrma-humanoid-v1` (registry
migration, validator, Studio UI, SDK changes, Space emote consumer — tracked in the owning repos per research 03
§7.2–7.4, with tracking issues opened during M2); Tier 3 "Publish to Ekza" (device-code login, `studio-upload`
scope, upload flow with lints and provenance); "Open from Ekza" deep link with verified download and the
`ekza-animator-embed/v1` iframe protocol with Studio; Tier 2 avatar animation sets (OMOBA aliases) if prioritized.

**Acceptance**: an animation exported from the editor is published, admitted by the registry profile check and
played as an emote in Ekza Space.

**Depends on**: M1 exports and metadata only; ecosystem changes in registry/SDKs/games; owner decisions
(Q-EKZA-3…Q-EKZA-10). Independent of collaboration.

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

## M6 — Modeling, splines first (size TBD after M5)

**Deliverables**: renderable `curve` records registered through `TableDef` using the shared `SplineSet`
(poly/Bézier, then NURBS), viewport CV/EP/pen tools reusing the Graph Editor's Bézier editing kernel, component
selection mode, generators (sweep, loft, revolve, extrude, tube) with construction history and per-op dirty
propagation, `EKZA_curves` glTF extension (vendor prefix registered first) with a `LINE_STRIP` fallback, Model
workspace; later mesh editing and weight painting; sandboxed third-party plugins.

**Acceptance**: a user draws a spline, sweeps a tube along it, exports a GLB that loads in three.js and Bevy.

**Depends on**: M1 registries and selection model; M5 not required for splines.

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
| Scope creep from Maya breadth | all | Requirements carry priorities; MVP-SPEC is the contract |
| Name conflict for "Ekza Animator" | before M1 alpha | Trademark search (Q-NAME-3) |
