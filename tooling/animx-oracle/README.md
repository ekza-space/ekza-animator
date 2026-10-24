# AnimX oracle

Golden-value generator for the curve engine of `@ekza-studio/anim-core` (MVP-SPEC §6.3, ADR 0003). It compiles
AnimX (from the upstream repository pinned in `generate.mjs`) — the C++ library that evaluates animation curves in
the exact same way as the desktop DCC it was written for (the host application below) — together with a small
adapter, runs deterministic curves through it and writes the results to
`packages/anim-core/test/goldens/animx-goldens.json`. The unit test `test/curve/animx-goldens.test.ts` compares the
TypeScript port against those values. The oracle is a maintainer tool, not part of CI: the goldens are committed.

| File | Purpose |
|---|---|
| `oracle.cpp` | Curve generator, `adsk::ICurve` adapter and JSON writer (MIT). |
| `generate.mjs` | Fetches AnimX at the pinned commit, compiles, runs, writes and formats the goldens. |
| `.cache/` | AnimX checkout and the compiled binary (git-ignored). |

## Regenerating

```sh
node tooling/animx-oracle/generate.mjs            # fetch + build + write the goldens
node tooling/animx-oracle/generate.mjs --check    # exit 1 when the committed goldens differ from a fresh run
node tooling/animx-oracle/generate.mjs --animx ~/src/animx --seed 7 --curves 1000   # local checkout, other set
```

Requirements: git, a C++11 compiler (`$CXX`, default `clang++`) and network access for the first fetch. AnimX is
pinned to `11c31ac74e526b599031414866db639383c9a5e0` (Apache-2.0; it is compiled, never vendored).

Build flags, and why:

- The library's 64-bit time-precision define (passed by `generate.mjs`): AnimX's `seconds` type becomes `double`,
  like the TypeScript engine's frames.
- `-ffp-contract=off`: no fused multiply-adds, so AnimX's arithmetic rounds exactly like JavaScript's.
- `-include limits`: `animx/src/internal/math.h` uses `std::numeric_limits` without including `<limits>`.

## What the goldens contain

`animx-goldens.json` holds the AnimX commit, the seed and a list of curves. Keys use a compact form
`[t, v, inType, outType, inDt, inDv, outDt, outDv]` (the `KeyData` fields; handles are offsets in frames/values).
Per curve:

- `samples`: `[frame, value]` from `adsk::evaluateCurve` at every key, every span midpoint and random frames on a
  1/64-frame grid across `[first − 2.6·R − 1, last + 2.6·R + 1]` (negative and multi-cycle times included).
- `autoSlopes`: `[key, side, slope]` from `adsk::autoTangent` for every `auto` / `autoMix` / `autoEase` side.

The set (seed `20261017`, 450 curves, 20,129 samples, 1,088 auto slopes):

- every computed tangent type × weighted/non-weighted × every infinity mode on one asymmetric 4-key curve with two
  equal neighbours;
- the synthetic wave clip (30° / −30° / 30° at 0 / 15 / 30) with the E2E-08 tangent edits, constant and cycle;
- a step / step-next / linear span-rule curve;
- weighted handles beyond the span (both `constrainInsideBounds` branches), negative out-`dt`, positive in-`dt`,
  near-vertical handles and the monotonic ellipse edge;
- 320 random curves: 2–7 keys on a 1/8-frame grid, values on a 1/16 grid (sometimes repeated or 1/1024 apart), any
  tangent types, any infinities, fixed handles on a 1/64 grid (weighted handles up to 1.6× their span).
- 42 stepped curves under cyclic infinities (appended after the random set with their own random stream, so adding
  them left the curves above unchanged): the keys 3 / 10 / 19 / 27 with step-next and with step out sides under
  cycle, cycle-with-offset and oscillate, plus 36 random curves (2–6 keys, mostly step / step-next out sides, any
  cyclic mode on each side, half on whole frames and half on the 1/8 grid). They are sampled at every time whose
  cyclic mapping lands exactly on a key (t_k + n·R and first + last − t_k + n·R, |n| ≤ 3–4) and, for whole-frame keys,
  at every whole frame across ±2.6–3.5 cycles. A step-next span jumps right after its start key, so these samples
  catch any rounding error left in the mapped time (see the deviations below).

Tolerances checked by the unit test: values ≤ 1e-9, auto slopes ≤ 1e-12. At generation the port matched AnimX to
8.2e-12 (values) and 4.4e-16 (slopes). A wider check with the oracle binary (`--seed 1 … 13, 99, 12345 --curves
3000`: 46,950 curves, 1.75 M samples) found no value off by more than 1.8e-10 and no slope off by more than 1.8e-15.

## Adapter conventions

AnimX evaluates a curve from per-key tangents `(x, y)` (the host application's `3 · (control point − key)`, x
pointing forward in time for both sides). The adapter converts Ekza keys exactly as the TypeScript engine resolves
them (MVP-SPEC §4.11.4):

- `auto`, `autoMix`, `autoEase`: computed by `adsk::autoTangent` (end keys flat via AnimX's `flatTangent`). These
  are what the slope goldens check.
- `fixed`: `out = (3·dt, 3·dv)`, `in = (−3·dt, −3·dv)`. Handles sit on a 1/64 grid so that AnimX's `x · (1/3)`
  gives back exactly `dt` (asserted).
- `linear`, `spline`, `clamped`, `flat`, `step`, `stepNext`, and `plateau` (= legacy auto): AnimX does not compute
  these, so the adapter applies the engine's rules (`x` = span to the neighbour, `y` = slope · span). Their goldens
  validate segment evaluation and infinities, not the tangent rules; the rules have their own unit and property
  tests (`test/curve/tangents.test.ts`, `span-rules.test.ts`).
- Span flag: a span is linear iff the start key's out side and the end key's in side are both linear. (AnimX's
  host-application test plugin also marks a span linear when the start key's *in* side and its previous key's out
  side are linear; MVP-SPEC §4.11.4 does not, and neither does the adapter.)
- `isStatic()` is always false (a static curve in the host application evaluates the same values).

## Known deviations of the port from AnimX (not covered by the goldens)

| AnimX | Port | Why |
|---|---|---|
| Single-key curve with a non-constant infinity evaluates to 0 (`range == 0`). | The key value, or value + slope·Δt for linear infinity. | 0 is an artifact of the zero range; the key value is the limit. |
| Mapped cyclic infinity times are rounded to the host application's ticks (`toTickDoubleTime`). | A mapped time within the mapping's rounding-error bound (1e-12 · max(1, \|time\|, \|first\|, \|last\|)) of a key is snapped onto the key; otherwise no rounding. | Ticks model the host application's seconds; the engine works in frames. The rounding matters where the exact mapped time is a key: left unrounded, it can come out a hair past the key (58 → 10.000000000000002 for keys 3…27), and a step-next span then returns the next key's value. The snap reproduces AnimX there, and on tick-aligned times (all goldens) both agree. Off the tick grid, on smooth spans the port differs from AnimX by at most the slope times half a tick (3.5e-9 frames) and is the more exact of the two; within half a tick after a step-next key AnimX still returns the key's value, the port (like in-range evaluation, in both) the next key's. |
| A non-weighted tangent with `x = 0` has slope 0. | Fixed handles keep at least 1e-6 frames of `dt`, so a vertical handle is very steep. | MVP-SPEC §4.11.4 (`|dt| ≥ 1e-6`). |
| Slopes are derived from control points as `ty / tx`. | Slopes are resolved directly. | Same value up to rounding (≤ 1e-14 relative). |

Generation stays inside the one-day timebox of MVP-SPEC §6.3, so no hand-derived fallback goldens were needed.
