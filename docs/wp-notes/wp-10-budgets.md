# WP-10 — performance budgets (ARCHITECTURE §14): measurements

Status: 2026-10-18, branch `e2e-g4` (on `dev` at 67d0a1b). Scope: ARCHITECTURE §14 budgets plus the MVP-SPEC §6.3
bench lines they rest on, measured on the integrated M1 editor. Report only: no budget gates CI (§14), except the
idle check, which E2E-00 already gates. Misses are listed at the end with an owner; the integration agent files the
issues and copies the table into ROADMAP (MVP-SPEC §8.2).

## Machine

| | |
|---|---|
| CPU / GPU | Apple M4 Pro, 14 cores (10P + 4E), integrated GPU; 48 GB RAM |
| OS | macOS 26.6 (25G72) |
| Browser | Google Chrome 155.0.8059.80 (Playwright `channel: 'chrome'`, headless), WebGL `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro)`, i.e. the real GPU, not SwiftShader |
| Display | 1440×900 CSS px at DPR 2 (the §14 reference); the Graph Editor package bench draws 1440×400 at DPR 2 |
| Tooling | Node 25.6.1, Playwright 1.63.0, Vitest 4.1.11, Next.js 16.3.8 (Turbopack) production build |

The §14 reference is a 2020-class laptop (Apple M1 or GTX 1650 class). An M4 Pro core is roughly 1.5–2× an M1 core,
so a result here needs about that much headroom to hold on the reference; the verdicts below say where it is thin.

**Load.** Other agents' builds and test runs shared the machine: the load average was 130 at the start and 7–50
during the final runs (14 cores). The numbers below come from the final runs (load 7–50); the earlier runs at load
60–130 are given as ranges where they differ. Timer resolution in the page is 0.1 ms (no cross-origin isolation).

## Method

- **Browser bench** — `apps/web/e2e/bench/budgets.bench.ts`, run with `EKZA_E2E_PORT=<port> pnpm --filter web
  bench:budgets` (own Playwright config, `e2e/bench/playwright.config.ts`: the e2e web server, DPR 2, one worker; not
  part of `pnpm test:e2e`). It drives the production `/editor?e2e=1` build with real pointer and keyboard input
  and reads state through the §4.8 test API. An init script counts Canvas 2D drawing calls, times every
  `requestAnimationFrame` callback per frame and every `pointermove` listener; main-thread task time comes from the
  DevTools `Performance.getMetrics` `TaskDuration`. Each test writes `.acceptance/budgets/<name>.json` (git-ignored),
  an annotation and a `[budget]` line on stdout.
- **Package benches** (Vitest, already in the packages; run here unchanged):
  `packages/rig/test/bench.test.ts`, `packages/headless-tests/test/rig.fixtures.test.ts` ("evaluation time"),
  `packages/doc/test/bench.test.ts`, `packages/anim-core/test/bench/evaluate.bench.ts` (`pnpm exec vitest bench
  --run`), `packages/curve-editor/test/bench.test.ts` and `packages/viewport/test/bench.test.ts` (browser mode, the
  same Chrome). Run each with `pnpm exec vitest run <file> --reporter=verbose` in its package; results are the `↳`
  annotation lines.
- **Route JS** — the bench's last test against a **production** build without `NEXT_PUBLIC_EKZA_E2E` (no test API,
  no dev or e2e routes; `/e2e/vrma-check` answers 404 there): every script response of `/editor` until the empty
  state shows and the network is idle, gzip-compressed in Node (levels 9 and 6). Samples and decoders are not
  fetched on that path.

## Results

| §14 scenario | Budget | Measured | Source | Verdict |
|---|---|---|---|---|
| Idle editor | 0 WebGL frames, 0 canvas redraws | **0 / 0** over 2 s in each state: empty editor; Seed-san with the wave clip and its curve in the Graph Editor (split); the same in quad | bench `idle` (+ E2E-00 gate) | Met |
| Pose evaluation, 1 humanoid | ≤ 0.5 ms | rig program: **0.016 ms** (synthetic, 60 controls / 63 nodes), **0.028 ms** Seed-san (92 controls / 147 nodes); full pose in the app (Seed-san, 53 controls, 159 keyed rotation curves: curve sampling + rig + a fresh pose buffer per call): **0.029 ms** | rig, headless-tests, bench `pose evaluation` | Met (×17) |
| Scrub: pointer move → pose visible | same animation frame | **40 / 40** time-slider moves rendered the new pose in the same animation frame (checked after that frame's rAF callbacks: a WebGL frame was rendered and `clipFrame` is the frame under the pointer) | bench `scrub` | Met |
| 1 VRM, 4 panes, shaded, playback at 30 fps | ≤ 8 ms CPU/frame | in the app (Seed-san + wave, quad, shaded, DPR 2, 4 s, 242 WebGL frames): rAF callbacks per frame mean **0.95 ms**, p95 **2.0 ms** (0.97–1.47 / 2.0–5.1 at higher load); main-thread task time per rendered frame **1.73 ms** (1.74–2.40). Viewport package bench (4 panes, Seed-san meshes): mean 0.42 ms, p95 0.80 ms | bench `playback`, viewport | Met (×4) |
| Graph Editor 50k keys loaded / 10k visible, pan/zoom | ≤ 8 ms redraw | median **1.00 ms** (0.90) | curve-editor | Met |
| Graph Editor 50 curves × 200 keys, full redraw | ≤ 4 ms | median **1.30 ms** (1.20) | curve-editor | Met |
| Drag 1,000 selected keys | ≤ 4 ms per pointer frame | in the app (UAL `Idle_Loop` imported without reduction, 1,000 keys on the first visible curves selected, 30 vertical drag moves in the Graph Editor, one frame each): pointermove handlers + the rendered frame per move median **5.1 ms**, p95 **7.3 ms** (5.2–5.6 / 6.8–8.8 at higher load). About 2.9 ms is the pointermove handler (store preview update), 2.5 ms the frame (Graph Editor and viewport redraw). Store alone (doc bench): preview update 2.20 ms, commit 0.60 ms | bench `Graph Editor drag`, doc | **Miss** (+28 %), M-1 |
| Undo/redo one gesture | ≤ 5 ms | in the app, `edit.undo` / `edit.redo` of the 1,000-key drag: **2.4 / 2.2 ms** (median; 2.2–3.0 across runs); of a key step (rotate + S on Seed-san): **0.3 / 0.2 ms** (max 1.2 ms). Store (doc bench, 1,000-key commit): undo 1.27 ms, redo 1.73 ms | bench, doc | Met (thin on the reference for the 1,000-key case) |
| Open Seed-san (10.9 MB VRM) to interactive | ≤ 3 s | sample button click → character imported and `fk.head` projected in the right pane: **106–172 ms** (median 109 ms; the first run includes the HTTP fetch from localhost). The editor page itself is ready **410 ms** after navigation (median), so a cold open is ≈ 0.5 s | bench `open Seed-san` | Met (×6 cold) |
| Bake + write VRMA, 1 humanoid × 10 s @ 30 fps | ≤ 200 ms | `file.export` VRMA of a Seed-san clip 0–300 at 30 fps (12 controls keyed, 77 KiB file), **including** lints and the read-back check: **14.5–25.1 ms**, median **15.6 ms** | bench `bake + write VRMA` | Met (×12) |
| Editor route JS (gzip, no fixtures) | ≤ 900 kB | production build: 9 scripts, 3,220.7 kB raw; gzip -9 **917.2 kB = 895.7 KiB**, gzip -6 **919.5 kB = 898.0 KiB** (the e2e build: 939.0 kB gzip -9) | bench `editor route JS` | **At the limit**: over by 1.9 % in decimal kB, 0.2–0.5 % under in KiB; M-2 |

MVP-SPEC §6.3 bench lines measured on the way:

| Bench | Budget (report) | Measured | Verdict |
|---|---|---|---|
| anim-core: evaluate 2,200 curves at one frame | ≤ 0.3 ms | mean **0.32–0.35 ms**, min 0.22–0.23 ms, p75 0.34–0.37 ms (at load 7–65; 0.77 ms mean at load 130) | **Marginal miss**, M-3 |
| anim-core: 2,200 curves at a random frame incl. infinities | — | mean 0.37–0.42 ms | — |
| rig: evaluate | ≤ 0.5 ms | 0.016 ms synthetic, 0.028 ms Seed-san | Met |
| doc: 1,000-key commit / undo | ≤ 4 ms / ≤ 5 ms | 1.58–2.76 ms / 1.20–1.60 ms | Met |

## Misses and owners

| # | Budget | Gap | Owner | Where the time goes / suggestion |
|---|---|---|---|---|
| M-1 | Drag 1,000 selected keys ≤ 4 ms per pointer frame | 5.1 ms median, 7.3 ms p95 on an M4 Pro: more on the M1 reference | WP-6 (Graph Editor drag path), with WP-2 (store preview update) | Split per move: ≈ 2.9 ms in the pointermove handler, ≈ 2.5 ms in the frame it renders. A CPU profile of the drag puts the store's preview path (`previewUpdate`, `journalWrite`, `dropKeyGroupOfCurve`) at the top of the handler; the frame is the Graph Editor and viewport redraw. Candidates (not tried): at most one preview update per animation frame (coalesced pointer moves), cheaper preview journaling for a large uniform move, and checking what the frame re-evaluates for curves the drag did not touch. |
| M-2 | Editor route JS ≤ 900 kB gzip | 917.2 kB (895.7 KiB) gzip -9; the budget's unit decides pass or fail | WP-8 (shell, bundling) | No headroom for M2 work before the M2 CI gate. Candidates: lazy-load the dialogs (export, import, about, preferences) and the Graph Editor's menus; check that `three/examples` loaders and `@pixiv/three-vrm` are not duplicated across chunks. The gate should state its unit (kB = 1,000 B is the stricter reading). |
| M-3 | anim-core 2,200 curves ≤ 0.3 ms (MVP-SPEC §6.3) | 0.32–0.35 ms mean, minimum 0.22 ms | WP-1 | Within noise of the budget on a loaded machine; the means were taken at load 7–65. A pose of one humanoid is ~160–500 curves (≈ 0.03–0.08 ms), so §14's pose budget is not at risk. Re-measure on an idle reference machine before acting. |

## Not measured, caveats

- No §14 number was taken on the M1 reference, in Safari or Firefox (V1), or in the CI SwiftShader project (§14:
  not a gate there).
- The app has no in-app CPU counter (§14 says "in-app counter"); the bench instruments `requestAnimationFrame` and
  the DevTools task time instead. Main-thread task time includes the harness's own evaluate calls, so it is an
  upper bound; the rAF and listener times are the editor's own work.
- Redraw benches time the main-thread canvas commands; GPU raster runs asynchronously and is not included.
- "Open to interactive" starts at the click on the sample button with the editor already loaded; the page's own
  load (≈ 0.4 s here) is reported next to it.
- The 1,000-key drag uses UAL's dense keys (reduction off), so many curves are fully selected; a drag over a
  sparse 1,000-key selection spread over more curves may cost more (more curves recompiled per move).

## Reproduce

```sh
# browser budgets (builds and serves the e2e build on the port)
EKZA_E2E_PORT=3124 pnpm --filter web bench:budgets
# route JS of a production build: build without NEXT_PUBLIC_EKZA_E2E, serve it on the port, then
EKZA_E2E_PORT=3124 pnpm --filter web exec playwright test -c e2e/bench/playwright.config.ts -g "route JS"
# package benches
pnpm --filter @ekza-studio/rig exec vitest run test/bench.test.ts --reporter=verbose
pnpm --filter @ekza-studio/headless-tests exec vitest run test/rig.fixtures.test.ts -t "evaluation time" --reporter=verbose
pnpm --filter @ekza-studio/doc exec vitest run test/bench.test.ts --reporter=verbose
pnpm --filter @ekza-studio/anim-core exec vitest bench --run
pnpm --filter @ekza-studio/curve-editor exec vitest run test/bench.test.ts --reporter=verbose
pnpm --filter @ekza-studio/viewport exec vitest run test/bench.test.ts --reporter=verbose
```

## Export scenarios E2E-16…E2E-18 (same branch)

- Specs: `apps/web/e2e/16-17-export-bake-vrma.spec.ts` (serial: E2E-17 exports E2E-16's clip, one shared page) and
  `apps/web/e2e/18-export-animation-glb.spec.ts`; helpers in `apps/web/e2e/helpers/g4-export.ts` (export through
  the test API with the download and `lastExport()` cross-checked, io's `validateGltf`/`compareValidation` with
  gltf-validator in Node, GLB chunks, a small quaternion kit and the VRM humanoid parent map).
- `/e2e/vrma-check` (`apps/web/app/e2e/vrma-check/page.dev.tsx`, e2e builds only, like `/dev/panels`, DECISIONS B-15)
  loads Seed-san and Polybot with three.js + `@pixiv/three-vrm` and plays a VRMA with `@pixiv/three-vrm-animation`;
  `window.__EKZA_VRMA_CHECK__.play(bytes, times)` returns the normalized bone rotations.
- E2E-17 derives the editor's `humanLocal` from `boneWorld` (§4.11.9: `D_b = q(W_b)·q(W⁰_b)⁻¹`,
  `N_b = D_hp⁻¹·D_b`; rest from the character's empty default clip) at 10 frames (0, 3, …, 27). Measured max error
  **5.2e-8 rad** on Seed-san (51 bones) and on Polybot against `flipYaw` (30 bones), budget 1e-3.
- E2E-18 compares raw rotation locals re-read with `readAnimations` with `W_parent⁻¹·W_node` from `boneWorld` at
  frame 10: 53 rotation tracks (38 animated), max error **7.1e-8 rad**, budget 1e-4.
- E2E-16: the bake keeps `BIN[0, 10,783,036)` byte-identical and `extensions.VRMC_vrm` deep-equal; no new validator
  errors; the baked `.vrm` re-imported in a fresh editor gives `wave` with rz(15) = −30° within 1e-4 rad.
- No product bug surfaced and no §6.2 text changed: the three scenarios passed as specified once written.
