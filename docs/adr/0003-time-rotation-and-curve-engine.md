# ADR 0003 — Time units, scene clock, rotation representation and curve engine

- Status: Accepted (2026-10-17); revised 2026-10-17 after the design review (rev. 2)
- Inputs: research [01](../research/01-maya-animation-features.md) §5, [02](../research/02-formats-gltf-vrm.md)
  §6.1–6.4, [06](../research/06-collaboration.md) R5–R6, §1, §6.3, [07](../research/07-rig-controls-math.md) §1.3,
  §14, [08](../research/08-extensibility-modeling.md) §3.3/§3.5, [09](../research/09-ui-ux-spec.md) §4.7,
  [05](../research/05-landscape.md) §3.1–3.2.

## Context

Research disagrees on four storage details that every package depends on:

| Topic | Positions |
|---|---|
| Time unit | 01/02: frames (float64) + document fps (02: rational). 06 R6: integer flicks. 08: seconds. 04: undecided. |
| Tangent encoding | 01: per-side handle `{dt, dv}` + types. 02: slopes + weight fractions. 04: `inX/inY/outX/outY` arrays. 06 R5: store only `fixed` handles, compute the rest. |
| Rotation storage | 01/02/07: Euler radians per control with a DCC rotate order. 08: Euler degrees. 06: rotate-order names in three.js-like capitals. |
| Auto-tangent math | 01: port Autodesk AnimX (Apache-2.0, "same way as Maya"). 09: Catmull-Rom + Fritsch–Carlson clamp. 05: default "clamped auto". |

The design review added two questions: several characters in one scene need one exact clock (06 §1 scenario A,
§6.3 puts `fps` and `range` on the scene), and inserting a key without changing the curve requires writing
neighbour tangents, which R5 forbids.

## Decision

### Time

- **Key times are float64 frames of the owning clip's frame rate.** `Clip.fps` is rational `{num, den}`
  (30/1 default; 24, 25, 48, 50, 60 and custom, including 30000/1001). Integer frames by default (snap), sub-frame
  allowed. Seconds exist only at the IO boundary: `seconds = frame · den / num`.
- Slopes are **value units per frame**; handle `dt` is in frames.
- Changing a clip's fps is an explicit operator with two modes: *keep timing in seconds* (rescales `t` and handle
  `dt` of every key, range and contact, one transaction) or *keep frame numbers*. Both modes, and rotate-order
  changes, are **structural clip operations** (ADR 0002 §8): in M3 they need an exclusive claim on the clip.
- Flicks (06 R6) are rejected: they make handle math and Maya-convention tangent angles awkward, and float64
  already represents integer frames exactly. Because the fps operator rewrites stored times, flicks would not
  remove the concurrency issue either; the exclusive claim does.

### Scene clock

- `ProjectRecord.sceneFps` (default 30/1, also the default for new clips) and `sceneRange` define the **shared
  scene clock**. Session time is `sceneFrame` (U state). Each clip has `sceneStart` (scene frames, default 0).
- `clipFrame = (sceneFrame − sceneStart) · (clip.num · scene.den) / (clip.den · scene.num)`; every character
  evaluates its own active clip at its own clip frame (looping clips wrap inside their range, others hold).
- **The UI shows the active clip's frames** (ruler, frame field, ticks, Graph Editor axis, snapping), plus scene
  seconds in the HUD. The reviewer proposed scene frames on the ruler; we keep clip frames there because keys must
  sit on integer ticks of the clip being edited (a 24 fps clip in a 30 fps scene would otherwise show keys at
  fractional ruler positions). The shared exact clock — what scenario A and presence need — is `sceneFrame`.
- With one character, matching fps and `sceneStart = 0`, every mapping is the identity.

### Curve engine (`@ekza-animator/anim-core`)

- **Port Autodesk AnimX to TypeScript** (Apache-2.0, keep NOTICE and per-file headers) for segment evaluation
  (Hermite non-weighted, Bézier weighted with Maya's monotonic-X correction, linear, step, step-next),
  Auto/AutoMix/AutoEase tangents with the AnimX clamp, flat tangents and all infinity modes.
- **Span rules (normative, AnimX)**: a span is linear only if the start key's out side **and** the end key's in
  side are linear; `step`/`stepNext` are read from the start key's out side and affect only the following span;
  a linear side alone contributes its one-sided chord slope to a Hermite span; auto end keys are flat. Tests and
  UI expectations follow these rules (MVP-SPEC §4.11.4).
- Spline and Clamped follow research 01 §5.4 and are *documented approximations* until Maya fixtures exist;
  Plateau is M1-stretch ([DECISIONS-OPEN](../DECISIONS-OPEN.md) Q-ANIM-4, Q-ANIM-6).
- **Default tangent type for new keys: `auto`** (AnimX legacy Auto with clamp, Maya 2025 default). It never
  overshoots, so it also satisfies the "clamped auto" recommendation of 05. The Fritsch–Carlson variant in 09 is
  rejected because it diverges from Maya and has no oracle.
- Cycle-aware auto tangents (Blender behaviour, 01 §5.4.4) apply when `pre` and `post` are both `cycle` or
  `cycleOffset` (M1-stretch).
- **Key reduction** (`reduceKeys`, top-down error-bounded insertion re-checked against the original curve) is in
  M1 for import and the Graph Editor *Simplify* command; the export-side reducer for sampled tracks stays V1.
- Golden tests: an AnimX C++ CLI in `tooling/animx-oracle/` generates committed JSON fixtures (random curves × all
  segment kinds and infinity modes, tolerance 1e-9), timeboxed to one agent-day with hand-derived goldens as the
  fallback.

### Key and tangent encoding (stored)

```ts
interface Handle { dt: number; dv: number }   // offset from the key in (frames, value); in: dt <= 0, out: dt >= 0
interface KeyData {
  t: number; v: number;
  inType: TangentType; outType: TangentType;
  inHandle: Handle; outHandle: Handle;        // meaningful only when the side's type is 'fixed' (R5)
  broken: boolean;                            // false = unified: in/out stay collinear when edited
  weightLocked: boolean;                      // weighted curves: drag changes angle only
  breakdown?: boolean;                        // V1 (stored now, ignored by MVP UI)
}
// per curve: weighted: boolean; pre/post: InfinityMode
```

(Illustrative; the contract is MVP-SPEC §4.1.)

- Computed types (`auto`, `autoEase`, `autoMix`, `spline`, `clamped`, `plateau`, `linear`, `flat`) are recomputed
  from neighbours at compile time and **not written back** (06 R5). Dragging a handle converts the side(s) to
  `fixed` with the resolved values (Maya behaviour); on a unified key both sides become `fixed`.
- **Explicit exception — shape-preserving insert.** Inserting a key changes its neighbours' computed tangents, so
  "never write computed tangents" and "insert without changing the curve" cannot both hold. The insert operation
  freezes every computed side whose resolved handle would change (both sides of the neighbours for
  auto/spline/clamped, adjacent linear chord sides, wrapped first/last keys under cycle-aware auto) as `fixed`
  with its pre-insert value, and gives the new key `fixed` handles from the curve derivative (non-weighted) or the
  de Casteljau split (weighted). Step, step-next and linear spans need no freezing. It is one local transaction by
  the editing user, so it creates no false conflicts elsewhere. Gate: `|Δ| ≤ 1e-12` on random curves of every
  tangent type.
- Non-weighted fixed handles: only the direction is used (`slope = dv/dt`, `|dt| ≥ 1e-6`). Weighted curves: handle
  length is used; `dt` is clamped to the segment.
- `weighted` is **per curve** (Maya). `weightLocked` defaults to `true` (Maya locks tangent weights by default).
- **Numeric fields** use Maya's convention with time in seconds: out-angle `atan2(dv·k, dt/fps)`, in-angle
  `atan2(−dv·k, −dt/fps)` (measured on the forward-pointing vector), `k` = 180/π for rotation channels; weight
  `3·hypot(|dt|/fps, dv·k)` on weighted curves. The weight unit is pinned with a Maya `.anim` fixture when
  available.
- The **compiled form** is struct-of-arrays typed arrays per curve (`CompiledAnimCurve`: times, values, resolved
  slopes and handles, segment kinds) built from the stored keys and cached by `(curveId, version)`. This is where
  04's typed-array performance lives.

### Rotation

- Rotation channels `rx ry rz` are **Euler angles in radians**, one scalar curve each, per control, with a
  **per-control rotate order in DCC (Maya/Blender) semantics**: `'xyz'` = X applied first (`R = Rz·Ry·Rx` for
  column vectors) ≡ three.js `Euler.order = 'ZYX'`. One tested function maps orders; the table in research 07
  §1.3 is pinned by a unit test. The UI displays degrees.
- Evaluation converts Euler → quaternion immediately after sampling. Constraints, solvers, blending, bake and
  export use quaternions only. Euler never leaves the project file.
- **Euler filter** (07 §14.2) runs on import and on demand; **`eulerNear(q, order, reference)`** is used for every
  quaternion → channel conversion (manipulator in object/world space, import, paste, mirror, plant feet) with the
  control's current values as reference. Gimbal-mode manipulation writes one Euler channel directly.
- Rotate-order change (M1-stretch) samples the three curves at the union of their key times, converts with
  `eulerNear`, filters and writes synchronized keys on all three curves.
- Quaternion curves (Maya "Synchronized Quaternion") are a V2 per-control option.

### Channel identifiers

`tx ty tz rx ry rz sx sy sz` (Maya short names) and `@<attr>` for custom attributes (e.g. `@ikFk`, V1).
Values: metres, radians, unitless.

## Alternatives

See the context table. Seconds as float64 were rejected because frame multiples are inexact (0.1 s ≠ 3/30 s in
binary), which breaks snapping and "key on this frame" tests. Storing resolved tangents for all keys was rejected
(R5); only the insert exception above writes them. Per-key weighted flags (06 sketch) were rejected in favour of
Maya's per-curve flag. Scene frames on the ruler (review proposal) were rejected for the reason above.

## Consequences

- `anim-core` has zero runtime dependencies and is shared by evaluation, drawing (exact `bezierCurveTo`
  segments), reduction and baking, so what you see is what you export.
- A Maya `.anim` importer (later) maps 1:1: Maya tangent x in seconds = `3 · dt / fps`.
- Import detects the source frame rate (24/25/30/48/50/60) and keeps keys on integer frames by default; sub-frame
  keys appear only when the user forces source times on an irregular source.
- Apache-2.0 port files live under `packages/anim-core/src/curve/animx/` with headers and a package `NOTICE`
  (ADR 0009).
