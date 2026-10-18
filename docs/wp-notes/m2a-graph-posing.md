# M2a A4 — Graph Editor features, tween family, half-cycle mirror animation, M-1: build notes

Branch `m2a/graph-posing` (from `dev` with `m2a/contracts-foundation` merged). Scope:
[M2A-SPEC §8 A4](../M2A-SPEC.md#a4--graph-editor-features-tween-breakdown-display-mirror-animation-m-1). The spec
names this file `m2a-a4.md` (§3 rule 6, §5.21.1); the work package's task asked for `m2a-graph-posing.md`, so the
notes (and the M-1 frame profile) live here. Decision IDs below are `M2A-A4-<n>` for DECISIONS-OPEN §F.

## M-1 frame profile (first deliverable, before any optimisation)

Measured on `m2a/graph-posing` at the A0 merge (59b36e8), before any A4 change: production e2e build
(`NEXT_PUBLIC_EKZA_E2E=1 next build`), real Chrome 155 (Playwright `channel: 'chrome'`, headless), Apple M4 Pro, DPR 2,
1440×900. Load average 12–16 (1 min) from other agents' builds on the machine. Bench
`apps/web/e2e/bench/m2a-a4.bench.ts` (`M-1: …`): the `budgets.bench.ts` scenario (UAL `Idle_Loop` imported without
reduction, 1,000 keys of the first visible curves selected, vertical drag in the Graph Editor, one pointer move per
animation frame), 3 rounds × 40 moves after a warm-up drag; per move = the pointermove listeners plus every
requestAnimationFrame callback of the frame that renders it.

| | median | p95 |
|---|---|---|
| Baseline (3 runs) | 4.7–5.5 ms | 5.3–6.0 ms |

Frame split per move from a CPU profile of a fourth, identical drag (DevTools Profiler at 100 µs; only samples under
the editor's frame callbacks and pointermove listeners; categories by method name, innermost first):

| Category | ms per move | What it is |
|---|---|---|
| Store preview update (`previewUpdate`, `journalWrite`, `put`, query/reference `onWrite`, `revert`) | 1.95–1.98 | doc: revert 1,000 records, re-put 1,000 records (normalize, validate, journal), every storage write drops the curve's key group and relinks references, then deep-compares each record for the preview batch |
| Graph Editor redraw (`renderBase`/`renderOverlay`) | 1.03–1.11 | every curve, key and handle of the 30 visible curves repainted per frame |
| Other | 0.98–1.02 | the Graph panel's React re-render on every preview batch (key fields, toolbar and channel-tree doc queries, react-resizable-panels re-sorting its handles: 0.27 ms), the time slider's tick set (`tickSet`, 0.30 ms, A3's file), the curve cache's per-change invalidation (0.16 ms) |
| Viewport GL render | 0.18–0.23 | three.js draws of the panes (the pose changes: keys at the current frame move) |
| Pose evaluation | 0.13–0.24 | sampling + rig of the edited character |
| Graph Editor curve set | 0.14–0.16 | rebuilding the 30 edited curve entries |
| Viewport pose sync | 0.08–0.09 | |
| Curve compile | 0.04–0.06 | the 30 edited curves |

So the 1,000-key drag costs ≈ 2 ms in the store, ≈ 1 ms in the Graph Editor painters and ≈ 1 ms in React and the
time slider; the viewport and the evaluation are small because only one character's 30 curves change. The plan
follows: store and query fast paths (mechanisms 2–3), the cached static-curve layer (5), the curve cache's
once-per-batch invalidation (4), and no Graph panel re-render for a preview batch that changes nothing it shows.
