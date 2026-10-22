# M6b MVP integration — merges, gates, AS-MVP-1, budgets, docs: build notes

Branch `m6b/integration` (from `m6b/mvp` at `22b0e11`, the v1.3 spec with §0.10). Scope:
[M6B-SPEC §9.0 INT](../M6B-SPEC.md#int--integration-integration-agent-after-every-package) and the MVP definition of
done ([§0.7](../M6B-SPEC.md#07-acceptance-as-mvp-1-and-the-mvp-e2e-scenarios)). Decision IDs are `M6B-INT-<n>` for
[DECISIONS-OPEN §L](../DECISIONS-OPEN.md#l-m6b-mvp-deviations-2026-10-22).

## Merge (M6B-INT-1)

`--no-ff` in the §9.0 order: C0 `m6b/rig-contracts` (`ea3bbc3`), C1 `m6b/character-runtime` (`fdab6b1`), C2
`m6b/skeleton-kernel` (`e7527cb`), C4 `m6b/auto-skin` (`d4da1e1`), C7 `m6b/rig-shell` (`ff7efd2`), C12
`m6b/clip-library` (`6c511cf`), C10 `m6b/character-writer` (`05f7075`), C3 `m6b/skeleton-ui` (`b93cb6e`), C6
`m6b/skin-ui` (`898a4d1`). No package had merged back into `m6b/mvp`; each had merged its dependencies into itself, so
C1 + C2 met here for the first time (their mutual `c1` ↔ `c2` gates ran on this branch first). No package branch was
changed. The conflicts were the shared test tables and registration blocks:

| File | Resolution |
|---|---|
| the four `test/m6b-ready.ts` | the union of the flags (every flag `true` after C6) |
| `editor-core/test/m6b/foundation.test.ts`, `apps/web/e2e/m6b-00-foundation.spec.ts` | one `LANDED` table with every owner's poll reasons (C1, C2's list, C3, C4, C6, C7, C10, C12) |
| `editor-core/test/m6b/keys-hash.test.ts` | the union of the rows and fixtures; C10's `modelCharacter(app)` (a cube character) renamed `cubeCharacter` beside C2's `modelCharacter` (records) |
| `rig/src/index.ts`, `editor-core/src/index.ts`, `viewport/src/rig/index.ts` | the union of the export blocks |
| `editor-core/src/rig/chunk/services.ts` | C6's resolution (the C4 skin service with C7's validation and controller) |
| `editor/src/dialogs/DialogHost.tsx` | C6's `unbindSkin`/`rebindSkin` dialogs and C10's `vrmMeta` |
| `io/test/m6b/contracts.test.ts` | every io stub landed: the stub cases go, C10's `VRM_LINT_RULES` case stays |
| `viewport/src/manager/contributions.ts` | both hooks, then one (M6B-INT-3) |

## Gates turned into failures (M6B-INT-2)

Every `READY` flag is `true`; every `test.fixme` gate of the MVP scenarios is a test (E2E-JNT-01, E2E-QR-02 ×2,
E2E-RIG-01/-02/-04/-05/-08, E2E-SKIN-01 ×2/-02/-03/-05/-06/-10 ×2, E2E-LIB-03) and so is the C10 export bench. The one
`test.fixme` left is `c6-ce` (E2E-SKIN-03's Component Editor step): the Component Editor is optional in the MVP (§0.3,
§9.0 C6) and was not built (the panel is C0's stub), so the scenario stays as the spec of that later work.

## Problems found by running the integrated branch (all fixed, with tests)

| # | Problem | Fix | Tests |
|---|---|---|---|
| M6B-INT-3 | `check:size`: the MVP eager delta **+6,151 B** over the +6,144 B allowance: C3's `attachViewportRig` and C6's `attachRigSkin` were two eager copies of one "load on the first Rig & Skin entry" hook | one hook: the Skin mode runtime starts inside the viewport-rig chunk (`rig/runtime.ts`); `rigSkinOf` reads the same map. **+5,940 B** | `check:size`; viewport `m6b-paint`, `m6b-skeleton-ui` |
| M6B-INT-4 | The first `skin.bind` wrote the mesh data before the record named its skeleton, so the revision's `MeshRef.joints` (the reference copy of the palette) was `[]` | the record's `skin` is patched first | C2's gated refit test asserts `joints` |
| M6B-INT-5 | Polybot's guessed **spine sat 0.08 H forward** (E2E-SKIN-01 "joints within 0.05 H"): the centre-line ray at the spine's height crosses the belt (an unclosed shell over the torso: front, front, back), the depth counter never closed and the projected centre fell back to the surface hit | `slabs()` closes a slab left open at its last exit | `rig/test/m6b-skeleton/quickrig.test.ts` (a box with an open plate; Polybot's spine ray) |
| M6B-INT-6 | E2E-SKIN-02's **0-byte influence switch** uploaded 25–50 kB: C3's viewport rig runtime rebuilt the joint overlay on every `session.rig`, prefs and evaluation change, and the overlay rewrote its (pane-dependent) instance matrices and line geometries on every pane render | the runtime rebuilds only on the fields its scene reads (mode, character, pose view, Quick Rig, hidden/locked joints; `jointSize`; an evaluation while the joints are posed); the overlay keeps per-pane instance matrices and line geometries and flags an upload only when values change | viewport DOM test "an idle pane and an active-influence switch upload no joint buffer" (fails without the fix); E2E-SKIN-02 |
| M6B-INT-7 | E2E-RIG-10: C1's `SkinnedCharacterDisplay.sync()` invalidated the viewport on every session, store, character and mesh event (an autosave status change drew a frame) | invalidate only when an entry is added, removed or updated or the hidden source meshes change | E2E-RIG-10, the budget bench's idle row |
| M6B-INT-8 | Checklist ⑤ stayed ◐ after a `library.preview` run that loaded the clip-library chunk: C7's watcher attached on the next session change only | evaluation notifications (the preview's frames) attach it too | E2E-RIG-01 |
| M6B-INT-9 | **`skel.tpose` vs §0.4.2**: the lint measured each arm bone and shin within 5° in 3D, so the minimum bend plus any elbow or knee depth set in the side pane (which §0.4.2 makes survive Create Skeleton bit-equal) failed the export gate; AS-MVP-1's own side drags did | the front-plane (XY) direction keeps 5°; out of the plane — the hinge direction — 15° is allowed (`SKELETON_CHECKS.tposeDepthDegrees`); a forward-reaching arm (30°) is still caught | `rig/test/m6b-skeleton/validate.test.ts` |
| M6B-INT-10 | AS-MVP-1 step 3's front elbow drag of **0.03 m** bends the T-posed arm 6° in the front plane, which `skel.tpose` (5°) rightly refuses at step 11 | the scripted twin drags **0.02 m** (4°); M6B-SPEC §0.7 step 3 amended | E2E-MVP-01 |

## Scenario readings (M6B-INT-11 … 16)

- **M6B-INT-11 — "Validation clean" = no error or warning row.** With C6 merged, `skin.joint-without-weights` (info)
  lists the joints an automatic bind leaves unweighted (the Cube Lad's box hands leave the fingers empty). Info rows
  never gate (§0.4.5), so the Export dialog's "clean" line does not show, and the scenarios assert no error or warning
  row instead: C10's `characterExportRows` test and its Export dialog browser test (now on a bound generated body:
  with C2/C4/C7 merged the Validation rows join the gate, so a two-joint test skeleton is no longer exportable),
  E2E-SKIN-05, E2E-MVP-01.
- **M6B-INT-12 — Create Skeleton and Skeleton Template leave Skeleton mode** (§0.2 step 5): the scenarios written
  before C2/C3 merged expected Object mode. C6's `boundCubeLad()` (documented "Object mode") now switches back;
  E2E-RIG-02, -05 and -08 switch with `rig.mode`; E2E-LIB-03 switches to Skeleton mode for its joint test pose (the
  §5.7 `E` drag on the joint, not a control ring).
- **M6B-INT-13 — the character adopts the scene mesh under a new id** (§5.1): E2E-SKIN-01 and E2E-RIG-01 read the
  bound mesh from the character. Other literal updates: E2E-SKIN-01's `rtk-step-3-btn`, its Polybot import passes the
  bytes as a `Uint8Array` (base64 into the page), its forearm boxes are found by their corners; E2E-RIG-01 sets the VRM
  meta before ⑥ (meta rows are export errors), drags the knee in the side pane (a front x drag tilts the shin past
  5°), opens the collapsed `Setup 6/6 · ●` line before ⑥'s button and re-shows the Rig Toolkit after the Paint
  Weights tab; E2E-RIG-08 binds and sets the meta so that the required-bones Fix leaves Export enabled, and A-poses
  with `skel.joint.rotateRest`'s real arguments; C2's refit-and-rebind test asserts the rebind by the revision and by
  equality with a fresh Bind Skin (C4's solver binds the Cube Lad's boxes rigidly, so a knee nudge can leave the
  weights unchanged); C12's keys-hash rows refuse on the naive kit with their reasons; C3's DOM test waits up to 15 s
  for the lazy rig chunk under a parallel run.
- **M6B-INT-14 — E2E-RIG-10's "stable"**: a model character's display container is rebuilt debounced on idle (C1:
  500 ms, then idle within 2 s) after a skin change, and its display model loads after that. The gate waits until no
  frame and no container rebuild happened for 2.6 s and nothing is in flight in the character registry, then expects
  no frame over 2 s, in Skin mode, Skeleton mode and the Test view, on a bound 3,001-point character (the generated
  body plus a 50 × 56 sphere). 12/12 under four workers.
- **M6B-INT-15 — INT's test-API group** (`editor/src/test-api/m6b/integration.ts`): `charactersSettled()` (the
  registry's `settled()`), reached through `window.__EKZA_STUDIO_TEST__` with its own type because
  `EkzaStudioTestApi` is closed (§9.1). No store-version reading exists in the test API, so "store version unchanged"
  in AS-MVP-1 step 8 is asserted as C12 does: history, keys hash, record counts and the dirty flag.
- **M6B-INT-16 — E2E-MVP-01 readings**: drags are pixels from metres with the ortho pane's scale (head-top and pelvis
  markers; within 5 mm of the asked distance); step 5 zooms the side pane (wheel) before the 0.01 m `D`+`W` drag
  (at the body framing 0.01 m is under a pixel); "the shoulder box's outer points" are the torso box's top outer
  (shoulder) corner on the left, reached with a 40 px constant brush from inside the front face (the weight labels
  list visible points only); "`E` on the left elbow (30°)" is the §5.7 joint drag, not an exact angle; step 10's
  "Validation clean" is the rig rows (the VRM meta rows are step 11's).

## Shared-file touches (M6B-INT-17)

INT owns manifests, `tooling/**` and the lint config (§9.1): `vrm-validator` (pinned `2.0.0-dev.3.10`, already in
io and headless-tests) is a web devDependency for E2E-MVP-01, allowed in `tooling/check-deps.mjs` and in the e2e
`no-restricted-imports` list of `.oxlintrc.json`, with `apps/web/e2e/vrm-validator.d.ts`. Package files changed by
the fixes above are named in their rows.

## AS-MVP-1 and the OMOBA validator (M6B-INT-18)

E2E-MVP-01 (`apps/web/e2e/m6b-mvp-01-cube-lad.spec.ts`, helpers `helpers/m6b-mvp-script.ts`) replays steps 1–11 in
≈ 13 s and writes `apps/web/test-results/m6b-mvp/cube-lad.vrm` (61,996 B; glTF-Validator and vrm-validator 0 errors,
every `vrm.*` lint clean, read-back equal, three-vrm plays a VRMA idle, two exports byte-identical). Step 12:

```
$ node tooling/omoba-validate.mjs cube-lad.vrm
Compatible local humanoid: VRM 1.0, 35 nodes, 33 semantic bones, 2 scene-0 roots.
Embedded clips are optional for this local capability; Studio admission is unchanged.
exit 0
```

(omoba-bevy read-only, its shared `target/`, no clean; cargo printed a harmless "failed to clean entries from the
global cache" permission warning.) **The owner's run of AS-MVP-1 by hand is open** (§0.7: not gating, times
recorded).

## Budgets (§0.4.9, §5.25)

Recorded in [ROADMAP "M6b MVP budgets"](../ROADMAP.md#m6b-mvp-budgets). Gates: idle 0 frames ✓, influence switch
0 bytes ✓, `/editor` 895,509 B ✓ with the MVP eager delta +5,940 B ✓ (final run). Per-package eager shares against §0.4.9
(measured by the packages, re-split by INT): C0 ≈ 1,535 B (2,048), C1 ≈ 376 B (512), C7 ≈ 1,886–2,481 B with its fix
rounds (2,560), C12 ≈ 267 B (1,024), C10 ≈ 261 B and C3 ≈ 508 B (0 each: **approved by INT** from the headroom C0, C1
and C12 left, as their notes asked), C6 0 B after M6B-INT-3, C2/C4 0 B. One report-only miss: stroke undo at 10k
points 20 ms (≤ 10 ms until CR-1's weight-only `writeData`, deferred by §0.4.1). The INT bench is
`apps/web/e2e/bench/m6b-budgets.bench.ts`.

## Gate results

Final run on `m6b/integration` after merging `dev` (the Auto-Rig spec, docs only), local Chrome with the GPU, port
3169: **`EKZA_E2E_PORT=3169 pnpm run ci` green** — format:check (1,883 files), lint (`oxlint --type-aware`), typecheck,
check:deps (15 packages), check:fixtures (25), check:licenses (176); `test`: 15/15 turbo tasks (editor-core 1,464,
mesh-core 976, anim-core 671, editor 552 + 1 skipped, io 340, rig 314, viewport 269 + 1 skipped, doc 263,
curve-editor 209 + 3 skipped, headless 201, ui 94, doc-yjs 85, mesh-view 81, web 24, tooling 26); build; check:size
**895,509 B** (gate 900,000 B), MVP eager delta **+5,940 B** (allowance +6,144 B, enforced), lazy `rig-workspace`
82.4 kB, `character-runtime` 14.4 kB, skin worker 12.8 kB, `clip-library` 4.7 kB; `test:e2e` **254 passed**, 24
skipped (the M1/M2a/M6a stretch `test.fixme`s and `c6-ce`). Before that, an earlier full run had two kinds of
failures, both fixed: browser-mode unit tests that failed to import their file under the parallel turbo run (they pass
alone and in the final run: a load flake of vitest's browser mode, not code), and E2E-SKIN-02's 0-byte window catching
the seed's deferred display rebuild (scenario fixed, `65725da`). Repeated runs under load: E2E-MVP-01 2/2, E2E-RIG-10
12/12 (four workers), E2E-SKIN-02 + RIG-10 + MVP-01 12/12 (six workers). Benches as in "Budgets".

## Into `dev`

`m6b/integration` was fast-forwarded into `m6b/mvp` and `m6b/mvp` merged into `dev` (`daec252`, `--no-ff`); the
merged tree is byte-identical to the `m6b/integration` tree the final gate passed on (`dev` was merged into the
integration branch first). Not pushed, not tagged (the release tag is the owner's call).
