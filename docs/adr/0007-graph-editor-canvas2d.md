# ADR 0007 — Graph Editor and time slider on Canvas2D

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [04](../research/04-web-stack.md) §5, [09](../research/09-ui-ux-spec.md) §4.7, §4.9, §5.1, §13.3,
  [01](../research/01-maya-animation-features.md) §3.2, §3.5, §5.2, [05](../research/05-landscape.md) §3.5,
  [08](../research/08-extensibility-modeling.md) §9.3.

## Context

The Graph Editor is the owner's highest-priority interaction surface (pen-like handle editing, soften/harden
tangents). SVG degrades with dense curves (Babylon ACE); WebGL makes text, dashes and hit-testing harder. 04
proposes adaptive per-pixel sampling; 01 and 09 note that both segment kinds are exact cubic Béziers in the
`(t, v)` plane under an affine view transform. The design review found that the MVP had no practical way to
retime poses (no Dope Sheet, a display-only time slider) and that several Maya Graph Editor habits were missing.

## Decision

1. **Canvas2D on the main thread**, framework-free in `@ekza-studio/curve-editor` (painters, view transform,
   hit-testing, interaction controllers). The editor package wraps it in React panels; the channel list is
   virtualized DOM.
2. **Two stacked canvases per editor**: *base* (grid, labels, infinity, curves, keys, handles; redrawn on view or
   data change) and *overlay* (playhead, hover, marquee, drag preview; redrawn on pointer moves and playback).
   hi-DPI backing stores via `ResizeObserver` (`devicePixelContentBoxSize` with a `contentRect ×
   devicePixelRatio` fallback for Safari).
3. **Exact segment drawing**: each segment is drawn with `ctx.bezierCurveTo` from the compiled curve's control
   points (non-weighted handles at Δ/3; weighted after the monotonic-X correction); linear and step segments use
   `lineTo`. Curves with more than one key per pixel fall back to a per-pixel sampled polyline through the same
   evaluator. Infinity regions are drawn dotted by repeating/offsetting the segment sequence (cycle,
   cycle-offset, oscillate) or straight lines (constant, linear).
4. **Culling and batching**: keys are time-sorted per curve, so a binary search gives the visible index range; one
   `Path2D` per (curve × state) for lines and one per state for key squares.
5. **Hit-test order**: selected handle > key > handle > curve segment > empty (marquee). Tolerances 6 px for keys,
   5 px for handles, 4 px for curves.
6. **Interaction controller** per editor: `idle → pressed → (dragKeys | dragHandle | marquee | pan | zoom |
   insert) → commit | cancel`. Drags run in a document preview session through the editor-core edit kernel (one
   history step, Esc cancels). Shift-drag locks to the dominant axis after 4 px. Key times snap to integer frames
   by default. **Maya habits**: MMB-drag anywhere moves the current key/handle selection (Shift constrains);
   double-click on a curve selects all its keys; `F`/`A` frame selection/all; Space tap maximizes the Graph
   Editor's dockview group. **Navigation follows the navigation profile**, not the keymap: Maya — wheel zoom
   (Shift value axis, Alt time axis), Alt+MMB pan, Alt+RMB zoom; Trackpad — two-finger scroll pan, Ctrl+wheel
   (pinch) zoom with Alt/Shift for one axis.
7. **The time slider** reuses the culling and painter modules and is an editing surface, not only a display:
   ruler, key ticks of the selected controls (the MVP "summary row"), playhead, scrub, playback range, auto-key
   red border, and **Maya range editing** — Shift+click selects a frame, Shift+drag a range band (selecting the
   keys of the target controls in it); dragging the band's middle moves those keys, dragging its ends scales them;
   RMB offers delete, copy, paste and tangent types. Each drag is one history step. This is the M1 retiming tool;
   the full Dope Sheet stays V1.
8. A `CurveRenderer` interface separates painting from interaction so a WebGL curve layer can replace the base
   painter if the benchmark fails.
9. **Benchmark (M1 week 1, reported)**: 50k loaded keys, ~10k visible, pan/zoom redraw ≤ 8 ms in Chrome on the
   reference laptop; 50 curves × 200 keys full redraw ≤ 4 ms.

## Alternatives

| Alternative | Why not |
|---|---|
| SVG/DOM | Tens of thousands of nodes; layout cost on pan/zoom. |
| WebGL curves | Text, dashes, hit-testing, second context; only if the benchmark fails. |
| OffscreenCanvas in a worker | Needs synchronous access to document and input state (04 §5.1). |
| Full Dope Sheet in M1 | Larger surface; time-slider range editing covers the core retiming loop (pose, key, slide timing) at about 2 agent-days. |

## Consequences

- The same `anim-core` evaluator draws, evaluates and bakes; the drawn curve is the exported motion.
- The curve-editor package has no React dependency and is testable in Vitest browser mode (pixel probes at DPR 1
  and 2).
- The Bézier-editing kernel (anchor/handle selection, break/unify, weighted handles, shape-preserving insertion)
  is shared later with 3D spline editing (research 08 §9.3).
