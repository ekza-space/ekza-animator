# WP-1 notes — `@ekza-animator/anim-core` curve engine, reduction, shapes

Builder notes for the integration agent: what landed, interpretations of MVP-SPEC v0.2, deviations, requested
contract changes and hand-offs to other work packages. Branch `wp/wp-1`.

## What landed

| Responsibility (§7 WP-1) | Where | Tests |
|---|---|---|
| AnimX port: Hermite (incl. AnimX's straight-line short-circuit), weighted Bézier with the monotonic-X correction and AnimX's polynomial root finder, Auto/AutoMix/AutoEase with the clamp and flat end keys, infinity mapping | `src/curve/animx/` (Apache-2.0, per-file change notes) | `test/curve/animx-goldens.test.ts` |
| Span rules, Spline/Clamped approximations, linear/flat/fixed/step sides, handle resolution | `src/curve/resolve.ts`, `compile.ts` | `span-rules.test.ts`, `tangents.test.ts` |
| Evaluation, slopes, sampling, control points, span kinds, infinity map, key queries | `src/curve/evaluate.ts` | `evaluate.test.ts` |
| `resolveKeyHandles`, `makeKeyData` | `src/curve/handles.ts`, `keys.ts` | `tangents.test.ts` |
| Shape-preserving insert with neighbour freezing | `src/curve/insert.ts` | `insert.test.ts` (property, 1e-12) |
| Numeric tangent fields | `src/curve/fields.ts` | `tangents.test.ts` |
| `reduceKeys` | `src/reduce/` | `test/reduce/` |
| Curve-level Euler filter | `src/euler/` | `test/euler/` |
| Control-shape library, registry, tessellation | `src/spline/` | `test/spline/` |
| AnimX oracle + committed goldens | `tooling/animx-oracle/`, `test/goldens/` | — |
| Licence | `packages/anim-core/NOTICE`, `LICENSE-APACHE-2.0` (official text) | — |
| M1-stretch: Plateau, cycle-aware auto | engine side done (see below) | `tangents.test.ts`, `insert.test.ts` |

AnimX oracle (inside the one-day timebox, so no hand-derived fallback): 408 curves, 16,245 values and 1,048 auto
slopes; the port matches to 8.2e-12 (values) and 4.4e-16 (slopes); `generate.mjs --check` reproduces the committed
file byte for byte. Details in `tooling/animx-oracle/README.md`.

Bench (`pnpm exec vitest bench --run` in `packages/anim-core`; Apple M4 Pro, Node 25.6, other agents building in
parallel, load average 6–9): evaluating 2,200 compiled curves (80 % auto, 10 % weighted fixed, 5 % linear, 5 % step,
mixed infinities) at one playback frame: **mean 0.26–0.32 ms, min 0.21 ms** (gate ≤ 0.3 ms, report only); with random
frames incl. infinities 0.32 ms mean. Compile a 40-key curve: 9.4 µs. Reduce a 1,000-key dense import at 0.1°: 4.4 ms.
Weighted (Bézier) evaluation costs ≈ 270 ns per call (AnimX root finder), Hermite ≈ 60 ns. Re-run after the resume
(load average 4–7): mean 0.32 ms, min 0.20 ms; a timed loop's best pass is 0.13 ms, so the mean is mostly machine load.

## Interpretations and deviations (proposed DECISIONS-OPEN entries)

| # | What | Why |
|---|---|---|
| W1-1 | **Additive optional parameter** `opts?: { readonly cycleAwareAuto?: boolean }` on `resolveKeyHandles(curve, index, opts?)` and `insertKeyPreservingShape(curve, frame, opts?)` (same shape as `compileAnimCurve`'s). | Under cycle-aware auto the first/last keys' tangents depend on wrapped neighbours, so insert must resolve with the same option to freeze them (§4.11.4 rule 3 names "the wrapped first/last keys under cycle-aware auto"). Callers that pass nothing get the default engine. **Contract change request**: add the optional parameter to the §7 WP-1 block. |
| W1-2 | `insertKeyPreservingShape(...).frozen` lists every pre-existing key whose data changed: computed sides frozen as `fixed`, the weighted split's sub-handles on the two neighbours, and an old end key fixed to the infinity slope (out-of-range insert). | A consumer that patches only `frozen` keys must not miss a resized weighted handle that was already `fixed`. Superset of "keys whose computed sides became fixed". |
| W1-3 | Step / step-next / linear inserts still run rule 3. | "No neighbour changes" holds for the span itself, but the span's start key can have e.g. an `auto` in side whose slope depends on its next neighbour (now the new key). Rule 3 freezes only sides that changed **and** still shape the curve (a side of a Hermite/Bézier span, or an end key's outer side under linear infinity), so linear spans stay linear. Exactness gate holds for every type. |
| W1-4 | Insert outside the key range: the key takes the infinity's value and slope; the old end key's outer side becomes `fixed` with the infinity slope. Constant and linear infinities are preserved exactly; cyclic ones cannot be (the cycle range changes). A key within 1e-6 of the frame is returned unchanged (`frozen: []`). An empty curve throws `EkzaError('unsupported')` (its value is the channel's static value, unknown to anim-core): `insertKeyOnCurve` (WP-7a) should create the first key from `staticValue` itself. | §4.11.4 does not define these cases. |
| W1-5 | `plateau` (M1-stretch) = AnimX legacy auto. | Research 01 §5.4 defines Plateau as "spline-like, flat at extrema, flat between equal keys, flat first/last key, never overshoots, implemented with the Auto (legacy) clamp" — exactly legacy auto. FR-GE-08's acceptance (never overshoots, flat at extrema) is tested. WP-6/WP-7b may enable key `7` / the menu item; still a documented approximation until Maya fixtures exist (Q-ANIM-4/6). |
| W1-6 | Cycle-aware auto (M1-stretch) is implemented for `auto`/`autoMix`/`autoEase`/`plateau` when `pre` and `post` are both `cycle`/`cycleOffset` (research 01 §5.4.4, offset per side), behind `compileAnimCurve(curve, { cycleAwareAuto: true })`. `curveEngine.compile` uses the defaults (off). | The engine part of FR-GE-17 (C¹ seam, tested ≤ 1e-9). To use it, the evaluation path must compile with the option, e.g. `createCurveCache(store, { compile: (c) => compileAnimCurve(c, { cycleAwareAuto }), evaluate: evaluateAnimCurve })` (WP-3/WP-7a), and edits must pass it to insert/resolve (W1-1). |
| W1-7 | Spline and Clamped (documented approximations, ADR 0003): spline = (ny − py)/(nx − px), one-sided chord at end keys, 0 for a single key; clamped = spline but 0 when a neighbour's value is within `1e-5·max(1, |range|)` of the key, with `range` = max − min of the curve's key values. | §4.11.4 leaves "range" unnamed. Calibrate with Maya `.anim` fixtures later (Q-ANIM-4). |
| W1-8 | A `linear` side on an end key's outer side (first key in, last key out) uses the other side's chord, so a linear end key continues its span into linear infinity. A step type on an in side behaves as flat. | Missing neighbour; Maya behaviour for linear infinity of linear keys. |
| W1-9 | Non-weighted `fixed` handles: slope = dv / dt with dt clamped to ≤ −1e-6 (in) / ≥ 1e-6 (out); a zero or backwards handle becomes a very steep (not flat) tangent. AnimX gives slope 0 when x = 0. Weighted fixed handles go to AnimX's Bézier correction unchanged (it clamps backwards handles to the key). | ADR 0003 "`|dt| ≥ 1e-6`". |
| W1-10 | Single-key curves with a non-constant infinity evaluate to the key value (linear: value + slope·Δt). AnimX returns 0 there (`range == 0`). | 0 is an artifact; documented in the oracle README. |
| W1-11 | Infinity times are not rounded to Maya ticks (`toTickDoubleTime`). | Ticks model Maya's seconds; frames have no such quantum. |
| W1-12 | Document content is repaired, never rejected: unsorted keys are sorted, duplicate times keep the later key, non-finite keys are dropped, unknown tangent types read as `auto`, unknown infinities as `constant`, non-finite handle numbers as 0. Indices returned by `resolveKeyHandles`/`insertKeyPreservingShape` refer to the repaired order (identical for valid curves). | Convention 6. |
| W1-13 | `compileAnimCurve` returns a `CompiledAnimCurve` with two extra fields (`coef`: per-segment AnimX coefficients; `cycleAwareAuto`). Evaluation also accepts `CompiledAnimCurve` objects built elsewhere (e.g. the test kit's naive engine): their coefficients are derived from the contract arrays once and cached in a `WeakMap`. Compiled curves are immutable. | Evaluation is a binary search plus a polynomial; no allocation per call. |
| W1-14 | `evaluateAnimCurveSlope` is the right derivative at a key (the left one at the last key), 0 on step spans and constant infinity, negated where oscillation plays backwards; near-vertical Bézier tangents are limited (dx ≥ 1e-12), not infinite. | Painters' tangent lines and insert need a finite slope. |
| W1-15 | `segmentControlPoints` gives the exact evaluated cubic for Hermite segments (from the polynomial, including AnimX's straight-line short-circuit) and the corrected handles for Bézier segments (handle times at the thirds where AnimX evaluates the span linear in time, so the drawn cubic is always the evaluated one; ≤ 3e-12 in a 30,000-curve stress run); linear spans give the line at thirds; step spans give their horizontal run (step: v_i to t_{i+1}; step-next: v_{i+1} from t_i) and the painter adds the vertical jump. | The contract does not define step spans. |
| W1-16 | `visibleKeyRange(c, f0, f1)` = the smallest inclusive key range covering every segment that intersects the window (last key ≤ f0 … first key ≥ f1, clamped); painters draw keys lo…hi and segments lo…hi−1; an empty curve gives `[0, −1]`. `keyIndexAt` defaults to ε = 1e-6 and returns the nearest key. `spanKindAt` returns the span starting at a key's time (the last span at the last key). | Not specified. |
| W1-17 | Numeric fields: `tangentFields` clamps to ±90° and returns ±90° for \|dt\| < 1e-6; `handleFromFields` clamps typed angles to ±(90 − 1e-6)° so the handle stays finite, keeps \|dt\| of `current` (at least 1e-6) for angle-only input, scales along the current angle for weight-only input, and builds the handle from both otherwise. Non-finite angles, negative weights, non-positive fps or display scale throw `EkzaError('unsupported')`. | §4.11.4 formulas; edge cases unspecified. |
| W1-18 | `reduceKeys`: `keep` frames without a key within 1e-6 are ignored (the result is always a subset of the input keys); curves with ≤ 2 keys are returned unchanged; ties go to the earlier sample, then the earlier key. A non-finite or negative tolerance throws `EkzaError('unsupported')`. | §4.11.4. |
| W1-19 | `eulerFilterCurves`: key times within 1e-6 share one union sample; a channel without keys samples as 0 and comes back empty (callers should pass a one-key curve holding the static value); where a sample took the alternate triple (a + π, π − b, c + π), the middle axis' `fixed` handles have their `dv` negated so the motion keeps its direction; unchanged keys are returned as the same objects. | §4.11.5 says tangent *types* are unchanged; negating the fixed handles keeps fixed tangents correct on the flipped branch. |
| W1-20 | Error codes: invalid caller arguments → `unsupported`; malformed shape data and non-finite `makeKeyData` input → `invalid-record`; duplicate/built-in shape kinds → `unsupported` (like the other registries). | Closest codes in §4.11.0. |
| W1-21 | AnimX's straight-line short-circuit (both tangents within 2e-7 of the chord) is part of the evaluated curve. An exact glTF `CUBICSPLINE` export of such a span must use the chord slope as both tangents (tested ≤ 1e-9). | For WP-4 if it ever exports cubic splines exactly (research 01 §5.11). |
| W1-22 | **Insert exactness at AnimX's snapping thresholds.** The 1e-12 gate holds on random curves (2,000 runs per CI pass; 100,000 weighted-fixed runs in a stress check, worst 9.8e-14). AnimX snaps a span at three thresholds, and a half of a split span can land on the other side of one even when the span did not: (1) Hermite tangents within 2e-7 (relative) of the chord are drawn as a straight line — halves that snap deviate by ≤ ~5e-8 of their value change; (2) Bézier handle times within 1e-6 of the thirds are evaluated linear in time — a span inside the band is now split on its effective linear X polygon, so it stays exact (≤ 1e-12, regression-tested); a span just outside it (2e-6 … 1e-5 off the thirds) can yield a half inside the band, ≤ 1e-6 off; (3) the monotonic-X correction keeps a `kDblEpsilon` (1e-10) margin — halves of a span whose handles exceed the span lie on the monotonic boundary and AnimX re-corrects ~5 % of them, measured ≤ 3.3e-8 (30,000 cases, values ±8), otherwise ≤ 1e-11 (rounding on the near-vertical stretch). The halves' exact sub-curves reproduce the span to 1e-14; only AnimX's re-snap moves them, so exactness there needs a deviation from AnimX, which the goldens forbid. Visually irrelevant (E2E-11 checks 1e-6). | §4.11.4 rule 4 assumes exact splits; AnimX's thresholds make a few narrow bands unsplittable. Tests: `insert.test.ts` "insert at AnimX snapping thresholds". |

## Control shapes

Unit size (radius / half-extent 1), planar shapes in XY with normal +Z; circular arcs are 45° Bézier spans, so the
default tessellation (6 segments per span) gives 48 segments per circle. `circle`; `halfCircle` (open +Y half,
+X → −X); `square` (±1); `cube` (12 edges of [−1, 1]³); `sphere` (circles in XY, YZ, ZX); `diamond` (octahedron as
three rhombi); `arrow4` (tips at ±1, shafts 0.2 wide, heads 0.5 wide and 0.4 long); `star` (8 points, inner radius
0.55, a point on +Y); `cross` (plus outline, arms 2/3 wide); `lollipop` (stick from the origin to (0, 3, 0), unit head
circle centred at (0, 4, 0)). Built-ins are deep-frozen and always available; `custom` is not a registry entry
(`ControlShape.custom` carries the data). Extensions register new kinds (validated, copied, frozen); the disposer
removes only its own registration.

**For WP-3 (auto-rig):** §4.11.15's finger lollipop has a stick of `(0.02 + 0.008·joint)·H` and a head of radius
`size`, a ratio the unit `lollipop` (3 : 1) cannot match for every joint; build a `custom` SplineSet per finger (stick
plus a `circle` scaled and moved), or use `lollipop` with an offset scale. The root's "arrow4 + circle on the floor"
is likewise a `custom` set of the two built-ins (concatenate their `splines`).

## Hand-offs

- **WP-0b / integration (shared test kit):** the kit's naive engine (B-19) can now delegate to the real
  `curveEngine`; the fake app's evaluation would then match the editor exactly.
- **WP-3:** `reduceKeys` + `eulerFilterCurves` for import; `createCurveCache(store, engine?)` should take the
  cycle-aware option (W1-6) if the preference exists.
- **WP-6 (Graph Editor):** draw segments with `segmentControlPoints` (exact `bezierCurveTo`), infinity with
  `infinityMap` (`mirrored` flips direction), cull with `visibleKeyRange`, hit keys with `keyIndexAt`; non-weighted
  handles come from `inDt/inDv/outDt/outDv` (a third of the span; draw at 40 px per §4.11.4).
- **WP-7a:** `insertKeyOnCurve` = `insertKeyPreservingShape` → put the new key, patch the keys in `frozen` (W1-2,
  W1-4); `graph.tangent.set fixed` / handle drags use `resolveKeyHandles`; `graph.keys.setFields` uses
  `tangentFields` / `handleFromFields` with the side's resolved handle as `current`.

## Gates run in this worktree

`pnpm run format:check`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:deps`, `pnpm run check:licenses`,
`pnpm run check:fixtures`, `pnpm run test` (all packages; the package's `vitest.config.ts` sets a 30 s test timeout
because the property tests exceeded vitest's 5 s default at load average 45), `node tooling/animx-oracle/generate.mjs --check` (fresh
AnimX clone and build, byte-identical goldens). No UI package or `apps/web` was touched, so `build` and e2e are not
affected by this WP.

Resume review (second builder): stress runs beyond the CI property counts found no defect in the tested domains —
insert on random curves of every type incl. cycle-aware auto and out-of-range frames (60,000 runs; the only
differences were samples that rounding put past the last key, where cyclic infinity cannot be preserved, W1-4),
`reduceKeys` bound and exact `maxError` (20,000 runs), weighted fixed handles within the span (100,000 runs). It did
find the AnimX snapping-threshold cases of W1-22; the linear-time Bézier one is fixed.
