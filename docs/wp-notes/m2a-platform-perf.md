# M2a A5 — platform: bundle (M-2), anim-core (M-3), autosave and recovery, export key reduction: build notes

Branch `m2a/platform-perf` (from `dev`, with `m2a/contracts-foundation` merged first). Scope:
[M2A-SPEC §8 A5](../M2A-SPEC.md#a5--platform-bundle-m-2-anim-core-m-3-autosave-export-reduction). The spec names
this file `m2a-a5.md` (§3 rule 6); the work package's task asked for `m2a-platform-perf.md`, as A0's did, so the notes
live here and the spec's A5 references point here. Decision IDs below are `M2A-A5-<n>` for DECISIONS-OPEN §F.

## What landed (by spec responsibility)

| A5 item | Where |
|---|---|
| §5.21.2 chunk attribution (first deliverable) | `apps/web/scripts/attribute-chunks.mjs` (`pnpm --filter web size:attribute` on a build made with `ANIMATOR_SOURCE_MAPS=1`), the route's script set in `scripts/lib/route-scripts.mjs`; the report is [below](#m-2-chunk-attribution-and-the-cuts) |
| §5.21.2 lazy boundaries | (1) model loader: `editor/src/services/models.ts` (`import('@ekza-animator/io/three')`); (2) export path: `editor-core/src/workflows/export.ts` (`loadWritePath`, `import('@ekza-animator/io/write')`) and the pipeline `workflows/exportRun.ts`; (3) every dialog and the confirm prompt: `editor/src/dialogs/DialogHost.tsx` (`React.lazy`), the e2e test API (`shell/EditorRoot.tsx`); (4) the Dope Sheet panel: A3's `React.lazy` boundary, verified on a trial merge (M2A-A5-6); (5) the project archive and fflate: the new subpath `@ekza-animator/io/project`, loaded by `workflows/project.ts`; plus the import pipelines (`workflows/importLoader.ts`, M2A-A5-2) |
| §5.21.2 intent prefetch | `editor/src/shell/prefetch.ts`: a file dragged over the window (model loader, import pipelines, Import dialog, archive), a sample button hovered or pressed and the Open dialog (model loader, import pipelines), an opened menu (the chunks its items need), the Export dialog (`preloadExportPath`); never at idle |
| §5.21.2 `check:size` gate | `apps/web/scripts/check-size.mjs` (gate 900,000 B, target 800,000 B, boundary markers, lazy group list), CI step in `.github/workflows/ci.yml` after the build, fixture-build tests in `apps/web/test/check-size.test.ts` |
| §5.21.3 anim-core fast paths | `anim-core/src/curve/{evaluate.ts,compile.ts,animx/evaluate.ts,animx/bezier.ts}`: the segment hint and once-bound hot-path bindings (M2A-A5-7) |
| §5.20 autosave | scheduler `editor-core/src/app/autosave.ts`; operators `file.recover`, `file.discardRecovery`, `file.autosaveNow` in `operators/builtin/autosave.ts`; IndexedDB store with Web Locks / heartbeat `editor/src/services/autosave.ts`; `createBrowserServices` wiring (`services/browser.ts`); shell start, prompt and `beforeunload` (`shell/autosave.ts`); `dialogs/RecoveryDialog.tsx` |
| §5.16 export reduction | `io/src/bake/reduce.ts` (`reduceBakedClip`, `trackLeverArms`), `BakeOptions.reduce` in `bake/bake.ts`, `stats.reduction` and the read-back against the reduced clip in `writers/artifact.ts`; `ExportRequest.reduce` through `editor-core/src/workflows/{export,exportRun}.ts`; the Export dialog's `export-reduce` checkbox (`dialogs/ExportDialog.tsx`); the toast "N → M samples" |
| bench | `apps/web/e2e/bench/budgets.bench.ts`: the first export's lazy chunk reported apart, the autosave write bench, the route JS of a first and a later visit cross-checked with `check:size` |
| e2e | `apps/web/e2e/m2a-20-autosave-recovery.spec.ts`, `m2a-21-export-reduction.spec.ts`, `m2a-22-lazy-loading.spec.ts` |

## Interpretations and decisions

| # | What | Why |
|---|---|---|
| M2A-A5-1 | **The measured route is a first visit.** `check:size` measures the eager scripts (the prerendered HTML's scripts and script preloads, never `noModule`, plus the route's `next/dynamic` files) **plus** the lazy groups a fresh profile opens before the empty state can be used: the First-run dialog (`FIRST_VISIT` in `check-size.mjs`, 6.5 kB). The gate and the target apply to that total; the eager total (every later visit) is printed too. The budget bench measures both visits from the network (a fresh profile, then a new page of the same profile after "Done", with the HTTP cache off). | The spec's set is "the scripts `/editor` requests until the empty state". A fresh profile (the bench's, and every new user's) shows the First-run dialog over the empty state, so its chunk loads before anything can be done; a set without it measured 0.82 % less than the bench's capture, with different files. With it, both visits match the bench byte for byte (M-2 table below). |
| M2A-A5-2 | **The import pipelines are a lazy chunk** (a sixth boundary beyond the five required): `importModel.ts`, `importAnimation.ts` and what only they use (rig import and retargeting, io input budgets, the VRMA and animation readers) load through `workflows/importLoader.ts`, in the import operators' `prepare` (their `apply` then finds them loaded) or on the model loader's intents. The helpers polls and other operators need synchronously (`animationTargetProblem`, `importTarget`, `isAnimationOnlyGlb`, `clipNamesOf`, `clipNameTaken`) moved to `workflows/importChecks.ts`; the pipeline modules re-export them. | The attribution showed the import path as the largest cut left in the eager scripts (17.9 kB). It keeps the 800,000 B target without a contract change, and leaves headroom for A1…A4, whose code adds ≈ 53 kB to the eager scripts on a trial merge (M2A-A5-6). Two of the moved helpers sat in A2's files; the move is the smallest change that keeps the chunk lazy (see merge notes). |
| M2A-A5-3 | **The ≥ 3× gate of §5.16 is asserted on linear blocking, not on the wave clip.** With R02 §6.4's tolerances (`ε_pos` = 0.2 mm × H/1.7 = 0.186 mm for Seed-san's H = 1.58 m; the forearm's lever L = 0.40 m gives θ_tol = 0.027°), the wave's 60° swing in 15 frames keeps nearly every one of its 31 samples: reconstructing by slerp across a gap of k frames errs by ≈ |θ''|·k²/8, and |θ''| ≈ 0.023 rad/frame² near the extremes, so k = 2 already errs by ≈ 25× the tolerance. E2E-M2A-21 and the headless test keep every other wave assertion (0 validator errors, never more samples, every integer frame within the per-node tolerances, the toast) and assert the shrink ≥ 3× on a clip keyed with linear tangents on 18 controls (holds and linear spans keep only their ends; R02's "hand-keyed 3–10×" case). | The spec's gate and its tolerances contradict each other on that clip; loosening R02's tolerances would break the bound the reduction promises (and that E2E-M2A-23 relies on). Owner review item. |
| M2A-A5-4 | **Keep set without A1:** `influenceKeepFrames` (`workflows/export.ts`) calls rig `computeInfluenceKeyTimes` and treats its `not-implemented` stub as an empty map, so until A1 merges the keep set is the ends, the loop closure, the contact frame and both sides of every step discontinuity; the influence-term test is `it.skipIf(!READY_A1)` in `headless-tests/test/ops.export-reduce.test.ts`. On the trial merge with A1 the term is live. | §8 A5 `READY.a1`; E2E-M2A-21 does not need the term. |
| M2A-A5-5 | **Autosave details the spec leaves open:** E2E-M2A-20 uses `ns=r1-<worker>-<time>` rather than the literal `r1`, so reruns and parallel workers start from an empty database; e2e pages without `ns` get a fresh IndexedDB database per page load (`ekza-animator-autosave-v1:page-<random>`), with `ns` the namespace's (`…-v1:<ns>`), so E2E-M2A-20's reload finds its slot and parallel workers never see each other's; without Web Locks a slot whose heartbeat is older than 20 s (4 missed beats) is an orphan; the orphan list is read again 3 s after start (a reloaded page's lock may outlive the reload briefly); a claim with nothing saved yet is pruned, never listed; `prefs.autosave.enabled` false keeps the controller silent (no toast) and `file.autosaveNow` poll-fails "Autosave is off"; a quota error pauses until the document stops being dirty (save, new, open). Recovery reads the slot through the `file.openProject` path (migrations, read-only rule); models missing from the slot are named in a warning. | §5.20 and §4.5 leave these to the implementation. |
| M2A-A5-6 | **Sibling check on trial merges** (in-memory `git merge-tree`, built in a scratch copy; no branch touched): A3's Dope Sheet boundary holds (its `DopeSheetView` is a 14.1 kB lazy group, nothing of it eager); with A1…A4 merged the route's first visit was 855,481 B before M2A-A5-2 and 836,444 B after it (gate 900,000 B; the 800,000 B target is then missed by the siblings' code, see the budget section). | §8 A5 "verify A3's Dope Sheet boundary"; the integration agent re-measures after the merge (§10). |
| M2A-A5-7 | **M-3 mechanisms:** a per-compiled-curve segment hint (`hint` on the compiled object; `evaluateAnimCurve` tries the hinted segment and the next one before the binary search; a cache, not state: any frame order returns bit-identical values, tested); the hot-path imports are bound once at module load (module wrappers turn each imported-binding access into a getter call); span kinds compared as local literals. AnimX goldens and the property tests are unchanged. | §5.21.3 allowed mechanisms. The coefficients were already on the compiled object since M1. |
| M2A-A5-8 | **The export pipeline is a lazy chunk of its own** (`workflows/exportRun.ts`, 2.6 kB), loaded with the io write path: the Export dialog and an open File menu prefetch both (`preloadExportPath`). `export.ts` keeps what polls need synchronously (request checks, `resolveExport`, names, the read-back lint). | Same boundary as (2); the pipeline only runs with the write path. |
| M2A-A5-9 | **Without `reduce` the bytes are M1's:** `io/test/m1-bytes.test.ts` pins the SHA-256 of the three exporters' outputs on the three fixtures (recorded on the merge base before any A5 change), and the headless test checks `reduce` absent and `null` byte-identical on every exporter; an unreduced export's stats carry no `reduction` field. | §5.16, §9.2 io gate. |

## M-2: chunk attribution and the cuts

Production build (`next build`, Turbopack, Next 16.3.8), gzip -9 per file, decimal bytes. Attribution through the
browser source maps (`ANIMATOR_SOURCE_MAPS=1`); a package's gzip share is its code compressed per chunk, scaled so a
chunk's groups add up to the chunk's real gzip size.

**Before** (the merge base with A0, attributed on the commit that added the report): 9 scripts, **926,514 B**
(3,247 kB raw). The M1 record of 917.2 kB (ROADMAP) was the bench's network capture with M1's script set.

| Package (before) | gzip -9 | Top-level module (before) | gzip -9 |
|---|---:|---|---:|
| three | 218.9 kB | three/build | 172.6 kB |
| next (React, router) | 136.4 kB | dockview-core | 83.0 kB |
| dockview-core | 83.0 kB | next/dist/compiled | 82.0 kB |
| @ekza-animator/editor | 75.5 kB | @react-three/fiber | 49.1 kB |
| @ekza-animator/editor-core | 52.4 kB | three/examples/jsm (GLTF/Draco/KTX2/meshopt loaders) | 46.3 kB |
| @react-three/fiber | 49.1 kB | next/src/client | 43.5 kB |
| @ekza-animator/io | 34.2 kB | @ekza-animator/editor/src/panels | 42.3 kB |
| @pixiv/three-vrm | 32.3 kB | @pixiv/three-vrm/lib | 32.3 kB |
| @ekza-animator/rig | 28.0 kB | editor-core/src/operators | 21.2 kB |
| @ekza-animator/viewport | 26.3 kB | editor/src/shell | 14.1 kB |
| @ekza-animator/curve-editor | 22.1 kB | editor-core/src/workflows | 11.8 kB |
| @gltf-transform/core | 17.1 kB | fflate | 9.9 kB |
| @ekza-animator/doc | 16.9 kB | @gltf-transform/core/src/io | 8.4 kB |
| react-resizable-panels | 13.5 kB | editor/src/dialogs | 8.3 kB |
| @ekza-animator/anim-core | 11.9 kB | rig/src/import | 6.6 kB |
| fflate | 9.9 kB | | |

The plan from it: the model loader (three/examples loaders + three-vrm ≈ 79 kB with their share of `three`), glTF
Transform and the io writers (≈ 25 kB), fflate and the archive (≈ 12 kB), the dialogs (≈ 8 kB plus Radix parts), the
test API (≈ 5 kB); then the import pipelines (≈ 18 kB, M2A-A5-2). Two build-level findings: Turbopack's default split
of the route into many chunks cost ≈ 13 kB of gzip context (three.js alone, split out of the editor chunk: +12 kB),
so `next.config.ts` merges each chunk group into one chunk (`experimental.turbopackChunking`); and the clip metadata
helpers moved out of the bake (`io/src/bake/meta.ts`) so the bake stays off the route. Tried and not used:
`turbopackRemoveUnusedExports`/`RemoveUnusedImports` (already the production default: no change) and
`turbopackModuleFragments` (the build panics in `module_fragments/graph.rs` on this code).

**After** (this branch): eager scripts **777,838 B** (5 scripts), first visit **784,325 B** (6 scripts, + the
First-run dialog 6,487 B): target 800,000 B met with 15.7 kB to spare, 115.7 kB under the gate.

| Lazy chunk group (on demand) | gzip -9 |
|---|---:|
| model loader (io/three, three-vrm, GLTF/Draco/KTX2/meshopt loaders) | 88.8 kB |
| export path (io/write, glTF Transform) | 41.0 kB |
| import pipelines (importModel/importAnimation, rig import, io readers) | 17.9 kB |
| project archive (io/project, fflate) | 12.6 kB |
| dialogs: Export 8.7, Import 8.5, First run 6.5, Shortcuts 6.3, Preferences 6.2, Open 4.0, Recovery 3.9, About 3.8, Confirm 2.9 | 50.8 kB |
| e2e test API (only with `?e2e=1` in an e2e build) | 4.7 kB |
| export pipeline (exportRun) | 2.6 kB |
| path-browserify (loaded by the export path) | 1.9 kB |

**One measurement** (§5.21.2): the bench's network capture (`editor route JS`) against `check:size` on the same
production build, served by `next start`, 2026-10-18:

| Visit | Bench capture | `check:size` | Difference | Scripts |
|---|---:|---:|---:|---|
| First (fresh profile) | 784,325 B | 784,325 B | 0.00 % | the same 6 files |
| Later (choices stored, HTTP cache off) | 777,838 B | 777,838 B | 0.00 % | the same 5 files |

Before M2A-A5-2 the same check gave 802,372 B / 795,885 B (0.00 %, same files); before M2A-A5-1 the eager-only set
(795,885 B) differed from the bench's first-visit capture (802,372 B) by 0.82 % with different files. The e2e build
(`NEXT_PUBLIC_EKZA_E2E=1`, what the rest of the bench runs on) measures 789.0 kB / 782.5 kB, also 0.00 %.

## Autosave (§5.20) in short

- **Store** (`createIndexedDbAutosaveStore`): database `ekza-animator-autosave-v1` (+ `:<namespace>`), stores `slots`
  (info, snapshot JSON, referenced asset ids, heartbeat) and `assets` (bytes by SHA-256, written once, collected when
  no slot references them, in the same transaction). A slot id is `as_` + 16 base62 characters from the CSPRNG. Live
  pages hold the Web Lock `ekza-animator:autosave:<slot>` (or beat every 5 s); orphans are the slots with a snapshot
  whose lock is free (or whose beat is stale).
- **Scheduler** (`startAutosave`): every committed batch but `preview` and `load` marks the document unsaved; the write
  runs `delayMs` after the last such batch, at most `maxIntervalMs` after the first, in an idle callback, never during
  a preview (it runs at the gesture's commit, or at its cancel), one at a time. Start: claim, housekeeping (> 14 days
  removed, at most 5 kept), the list into `session.recovery`. Clean ends: when the document stops being dirty the
  slot's snapshot goes; `beforeunload` while not dirty removes it (best effort).
- **Recovery**: the dialog opens once per page load after the first-run dialog (Recover, Discard with a confirm,
  Later); `file.recover` opens the slot the `file.openProject` way, then dirty, empty history, the toast "Recovered
  '<name>' from <time>. Save it to keep it."; the recovered slot goes after this page's first successful write.
- **Storage blocked** (`storage=blocked`, private mode without IndexedDB, a refused claim): `services.autosave` null or
  the claim fails, autosave off, one info toast "Autosave is off: this browser blocks storage.", no dialog.

## Merge notes for the integration

- `editor-core/src/workflows/importModel.ts`: a one-line conflict with A2 at the `./names` import (A2 inserts
  `import { importLimbWarnings } from './ik';` above it; A5 drops `nameKey` from it). Take A2's lines without `nameKey`.
  `importAnimation.ts` merges cleanly.
- `apps/web/e2e/m2a-00-foundation.spec.ts`, `editor-core/test/builtin/m2a-operators.test.ts`: A4 and A5 each removed
  their own rows from the stub lists; keep both removals.
- A1's `computeInfluenceKeyTimes` turns on `READY_A1` in `headless-tests/test/ops.export-reduce.test.ts` by itself.

## Minimal edits in files other packages own

`editor-core/src/workflows/{importModel,importAnimation}.ts` (A2: the five sync helpers moved to `importChecks.ts`
and re-exported, M2A-A5-2), `editor-core/src/operators/builtin/{clip,importers}.ts` (their helper import path),
`editor-core/src/index.ts` (exports of the loaders and the autosave API), `io/package.json` and `io/src/project.ts`
(the `./project` subpath), `apps/web/next.config.ts` and `apps/web/package.json` (chunking, source maps,
`size:attribute`), `.oxlintrc.json` (the `no-restricted-imports` rule that keeps `editor-core` and `editor` off the
main-entry write and archive names, owed by A5 per M2A-A0-15), `.github/workflows/ci.yml` (the `check:size` step),
the root `tsconfig.json` (the `apps/web/test` project), `apps/web/e2e/helpers/g4-export.ts` (`reduce` in the request
type), `ARCHITECTURE.md` §14 (how the route JS is measured; the autosave budget row).

## Literal updates (§3 rule 8)

| Test | Literal | Contract row |
|---|---|---|
| `editor-core/test/builtin/m2a-operators.test.ts` | `file.recover`, `file.discardRecovery`, `file.autosaveNow` leave the stub list | §4.9 (A5 implements them) |
| `apps/web/e2e/m2a-00-foundation.spec.ts` | `file.autosaveNow` leaves the stub list; `autosave()` reports the page's claimed slot instead of A0's `off` | §4.9, §5.20 |
| `editor/test/dialogs.test.tsx` | the Export dialog's `export-reduce` field and request | §5.16 |
| `editor/test/shell.test.tsx` | waits for the lazy test API and the lazy About dialog before asserting on them | §5.21.2 |

## Tests added

| Package | File | What |
|---|---|---|
| anim-core | `test/curve/segment-hint.test.ts` | any frame order bit-identical to a fresh curve, monotonic playback, scrubbing back and jumps, frames within 1e-10 of keys and segment ends, no field added to foreign curves, non-finite frames |
| io | `test/reduce.test.ts` | tolerances (height scaling, θ cap, lever arms raw and humanoid), linear motion to its ends, the bound at every sample on 150 seeded clips, the keep set, STEP/two-sample/single tracks untouched, determinism, purity, zero tolerance, `bakeClip` with `reduce`, writers with reduced clips (stats, read-back) |
| io | `test/m1-bytes.test.ts` | the M1 bytes without `reduce` (SHA-256 on three fixtures × three exporters) |
| editor-core | `test/kernel/autosave.test.ts` | start, blocked store, refused claim, the enabled preference, housekeeping, the recheck; cadence (debounce, max interval, previews and their cancel, ignored origins, serialized writes), clean ends, quota pause, `beforeunload`, dispose; the three operators |
| editor-core | `test/builtin/import-loader.test.ts` | the import pipelines load once, `apply` without `prepare` is an internal error, the moved helpers are one implementation, no eager module imports the pipelines statically |
| editor | `test/autosave-store.test.ts` (browser mode, real IndexedDB and Web Locks) | database names per namespace, slot ids, write/read, assets written once and collected, orphans with Web Locks and with heartbeats, claims without content, namespaces apart, no IndexedDB, a database that cannot open; `createBrowserServices` with `storage=blocked`, a namespace and a fresh e2e namespace |
| editor | `test/recovery.test.tsx` | the dialog's list, Recover, Discard with its confirm, Later; the shell prompt once per page load after the first-run dialog; a host without storage |
| headless-tests | `test/ops.export-reduce.test.ts` | `reduce` absent/null = M1 bytes on every exporter; Seed-san wave VRMA validates, reads back, toast N → M, every integer frame within tolerance; byte-identical re-exports; linear blocking ≥ 3×; malformed specs refused; the influence term (`READY.a1`) |
| apps/web | `test/check-size.test.ts` | route scripts from HTML and the loadable manifest, Turbopack chunk-list loaders, lazy group labels, the first-visit groups, gate failures (budget, first visit, missing script, broken boundary) |
| apps/web | `e2e/m2a-20…22` | E2E-M2A-20 autosave and recovery (and blocked storage), -21 export reduction through the Export dialog, -22 lazy loading (plus 22b, A3's boundary: `test.fixme` until A3's panel is on the branch) |

## M-3 and the §14 budgets (re-measured)

Same machine as wp-10-budgets.md (Apple M4 Pro, 14 cores, Chrome 155 with the GPU, Node 25.6.1, Vitest 4.1.11),
2026-10-18. **Load:** other agents' builds and test runs kept the load average at 12–66 for the whole session; a
script that waited for a load below 4 (§5.21.3 asks for an idle re-measurement) did not get one. The numbers below
are therefore loaded-machine numbers, like M1's; for M-3 the pre-M-3 code (the merge base's anim-core,
in a scratch copy with the same dependencies) ran interleaved with this branch's in the same minutes.

**M-3** (`packages/anim-core`, `pnpm exec vitest bench --run`, "evaluate 2,200 curves at one frame (playback step)"):

| Code | Load (1 min) | mean | p75 | min | rme |
|---|---|---:|---:|---:|---:|
| merge base (M1 + A0) | 47.7 | 0.371 ms | 0.352 ms | 0.233 ms | ±7.3 % |
| this branch | 44.3 | **0.157 ms** | **0.162 ms** | 0.134 ms | ±0.5 % |
| this branch (package bench run) | 65.3 | 0.160 ms | 0.164 ms | 0.137 ms | ±1.0 % |

Target mean ≤ 0.20 ms, p75 ≤ 0.25 ms: **met** on a loaded machine (2.4× faster than the merge base in the same
minutes; a second interleaved round was disturbed by load bursts on both sides, rme ±55–70 %, and is not used). The
other anim-core lines of the same run: random frame incl. infinities mean 0.190 ms; compile one 40-key curve 0.009
ms; reduce a 1,000-key import 4.09 ms. AnimX goldens and the property tests are unchanged.

**§14 table** (browser bench on the e2e build at DPR 2, load 26–43; package benches, load 26–66):

| §14 scenario | Budget | Measured | Source | Verdict |
|---|---|---|---|---|
| Idle editor | 0 / 0 | 0 / 0 over 2 s: empty; Seed-san + wave, split and quad | bench `idle` | Met |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | rig 0.033 ms (synthetic, 60 controls), 0.038 ms Seed-san (92 controls / 147 nodes); in the app 0.029 ms (53 controls, 159 curves) | rig, headless-tests, bench | Met |
| Scrub | same frame | 40 / 40 | bench `scrub` | Met |
| Playback, 1 VRM, 4 panes | ≤ 8 ms CPU/frame | rAF work mean 1.23 ms, p95 2.6 ms; task time 2.16 ms per rendered frame (243 frames in 4 s); viewport bench mean 0.42 ms, p95 0.80 ms | bench, viewport | Met |
| Graph Editor 50k keys / 10k visible | ≤ 8 ms | median 1.10 ms | curve-editor | Met |
| Graph Editor 50 × 200 full redraw | ≤ 4 ms | median 1.50 ms | curve-editor | Met |
| Drag 1,000 selected keys | ≤ 4 ms | median 5.10 ms, p95 7.10 ms; doc bench preview update 2.71 ms, commit 1.59 ms | bench, doc | Miss (M-1, A4) |
| Undo/redo one gesture | ≤ 5 ms | 1,000-key drag 2.60 / 2.40 ms; key step 0.20 / 0.20 ms (max 1.0 / 0.5); doc bench 1,000-key commit 2.62, undo 1.56, redo 1.88 ms | bench, doc | Met |
| Open Seed-san to interactive | ≤ 3 s | runs 144.4, 130.9, 104.9 ms, median 130.9 ms (M1: 109 ms; the first run loads the model loader and the import pipelines); page ready 407 ms after navigation | bench | Met; +22 ms ≤ §5.21.2's 100 ms |
| Bake + write VRMA, 10 s @ 30 fps | ≤ 200 ms | runs 35.5, 17.2, 14.8, 15.0, 13.6 ms; median of runs 2–5 15.0 ms; first run +20.5 ms (the export chunk) | bench | Met |
| Autosave write, Seed-san × 10 clips | ≤ 50 ms main thread | task time median 11.8 ms, max 12.7 ms per `flushAutosave` after one edit (1,800 keys; the model was stored by the first write); wall 11.1 ms | bench `autosave write` | Met |
| Editor route JS | ≤ 900 kB (target 800 kB) | first visit 784.3 kB, later 777.8 kB (production); e2e build 789.0 / 782.5 kB | bench + `check:size` | Met |

**After the siblings merge.** A trial merge with A1…A4 (M2A-A5-6) puts the route's first visit at ≈ 836 kB. Cuts
left for the integration, by raw size of what the empty editor does not need yet: the IK operators and workflows
(`operators/builtin/ik.ts` 10.5 kB, `workflows/ik.ts` 7.7 kB: polls stay eager, the work could load in `prepare` like
the import pipelines), Next's client navigation (`segment-cache`, `ppr-navigations`, ≈ 47 kB raw; the editor is one
route), `camera-controls` (44.7 kB raw, ≈ 9.5 kB gzip; needed at the first tumble), and panel bodies that have no
content in the empty state (Attributes, the Clip Settings form).

## Gates

PENDING
